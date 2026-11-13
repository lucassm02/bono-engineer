/**
 * Chooses the data source and wires it to the stores:
 * - `?mock=1` → in-browser mock only (no server);
 * - otherwise the server WebSocket at `/ws`; in dev, if no server answers after a couple of attempts
 *   the mock starts automatically (and stops as soon as the server comes up).
 */

import { type ClientMessage, type ServerMessage, WS_PATH, WS_PROTOCOL_VERSION } from '@gt7/shared';
import { showSessionSaved } from '../components/CaptureStatus.tsx';
import { mockConsoleConnection, parseMockConn } from '../lib/consoleLink.ts';
import { t as uiText } from '../lib/i18n.ts';
import { reconcileProfiles } from '../lib/profile.ts';
import { live } from '../live/liveStore.ts';
import { MockSession } from '../live/mock.ts';
import { trackGeometry } from '../live/trackGeometry.ts';
import { goToView, showLapPopup } from '../state/actions.ts';
import { completeEngineerJournal, flushEngineerJournal } from '../state/engineerJournal.ts';
import { completeEngineerTrainingLap } from '../state/engineerTraining.ts';
import { noteTrackMismatch } from '../state/liveContext.ts';
import {
  recordLap,
  resetSessionLaps,
  type SessionLapsState,
  setSessionId,
  useSessionLaps,
} from '../state/sessionStore.ts';
import { noteTaskProposals } from '../state/tasks.ts';
import { offerHint } from '../state/tourHints.ts';
import { addNotice, loadLocalProfile, setProfile, useUi } from '../state/uiStore.ts';
import { setSender } from './transport.ts';
import { WsClient, wsUrlFor } from './wsClient.ts';

let ws: WsClient | null = null;
let mockTimer: ReturnType<typeof setInterval> | null = null;
let mock: MockSession | null = null;
let mockLinkTimer: ReturnType<typeof setInterval> | null = null;

/** Failed attempts before the dev build falls back to the mock automatically. */
const AUTO_MOCK_AFTER_ATTEMPTS = 2;

function handleServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'welcome':
      useUi.setState({ serverVersion: msg.serverVersion });
      void flushEngineerJournal();
      break;
    case 'frame':
      if (useUi.getState().source === 'server') live.push(msg.frame);
      break;
    case 'lapCompleted':
      recordLap(msg.event);
      completeEngineerJournal(msg.event);
      completeEngineerTrainingLap(msg.event);
      showLapPopup(msg.event);
      if (msg.event.valid && msg.event.deltaMs === null) offerHint('lapWithoutReference');
      // The server may have just built the track centerline: retry the map geometry.
      trackGeometry.retry();
      break;
    case 'sessionChanged':
      useUi.setState({ session: msg.session });
      setSessionId(msg.session?.id ?? null, true);
      break;
    case 'sessionSaved':
      showSessionSaved(msg);
      offerHint('sessionSaved');
      break;
    case 'tasksChanged':
      noteTaskProposals(msg.proposals);
      break;
    case 'trackMismatch':
      noteTrackMismatch(msg.info);
      break;
    case 'status':
      useUi.setState({ serverStatus: msg.status });
      // Without frames the status is the only source of the console state.
      if (!live.frame) useUi.setState({ liveState: msg.status.connection });
      break;
    case 'deviceProfile': {
      const { profile, pushToServer } = reconcileProfiles(loadLocalProfile(), msg.profile);
      setProfile(profile);
      if (pushToServer) ws?.send({ type: 'setDeviceProfile', profile });
      break;
    }
    case 'showView':
      goToView(msg.view, 'remote');
      break;
    case 'notice':
      addNotice(msg.level, msg.message, msg.ttlMs ?? 5000);
      break;
    case 'pong':
      useUi.setState({ latencyMs: Math.max(0, Date.now() - msg.t) });
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------------------------

function handleMockClientMessage(msg: ClientMessage): boolean {
  if (msg.type === 'setDeltaReference') mock?.setReference(msg.kind);
  // Profile and current view need no server in mock mode (profile is persisted locally).
  return true;
}

export function startMock(auto: boolean): void {
  if (mockTimer) return;
  const params = new URLSearchParams(location.search);
  const speed = Math.min(20, Math.max(0.1, Number(params.get('mockSpeed')) || 1));
  live.clear();
  mock = new MockSession({ seed: Date.now() % 100000, startAt: Date.now() });
  mock.setReference(useUi.getState().profile.deltaReference);
  trackGeometry.setMock(mock.geometry());
  resetSessionLaps();
  setSessionId('mock', false);
  useUi.setState({ source: 'mock', mockAuto: auto });
  setSender(handleMockClientMessage);
  startMockLink(params.get('mockConn'));
  let last = performance.now();
  mockTimer = setInterval(() => {
    const now = performance.now();
    const dt = (now - last) * speed;
    last = now;
    // Big steps (tab in background) are split so the physics stays stable.
    let remaining = dt;
    while (remaining > 0 && mock) {
      const step = Math.min(remaining, 50);
      remaining -= step;
      const { frame, lapCompleted } = mock.step(step);
      if (remaining <= 0) live.push(frame);
      if (lapCompleted) {
        recordLap(lapCompleted);
        showLapPopup(lapCompleted);
      }
    }
  }, 1000 / 60);
}

/** Simulated console link for the demo: `?mockConn=searching|found|receiving|lost|idle|cycle`. */
function startMockLink(param: string | null): void {
  const mode = parseMockConn(param);
  const t0 = Date.now();
  const tick = () =>
    useUi.setState({ mockConnection: mockConsoleConnection(mode, Date.now() - t0) });
  tick();
  if (mockLinkTimer) clearInterval(mockLinkTimer);
  // Only the cycle (and the searching counter) change over time.
  mockLinkTimer = setInterval(tick, 1000);
}

export function stopMock(): void {
  if (mockLinkTimer) clearInterval(mockLinkTimer);
  mockLinkTimer = null;
  useUi.setState({ mockConnection: null });
  if (mockTimer) clearInterval(mockTimer);
  mockTimer = null;
  mock = null;
  live.clear();
  trackGeometry.clear();
  resetSessionLaps();
}

// ---------------------------------------------------------------------------------------------
// Tour demo (spec 04 RF4)
// ---------------------------------------------------------------------------------------------

/** Laps of the real session, kept while the tour runs on the demo. */
let tourDemoSaved: { laps: SessionLapsState } | null = null;

/**
 * Switches to the in-browser demo for the guided tour. Nothing reaches the server: the sender is
 * the mock's, the frames of the server are ignored and no session is recorded. No-op when the demo
 * already runs (`?mock=1`, dev fallback): then there is nothing to restore either.
 */
export function enterTourDemo(): void {
  if (tourDemoSaved || useUi.getState().source === 'mock') return;
  tourDemoSaved = { laps: useSessionLaps.getState() };
  startMock(false);
}

/** Back to the real source, with the laps of the session as they were. */
export function leaveTourDemo(): void {
  const saved = tourDemoSaved;
  if (!saved) return;
  tourDemoSaved = null;
  stopMock();
  useUi.setState({ source: 'server', mockAuto: false });
  setSender((m) => ws?.send(m) ?? false);
  useSessionLaps.setState(saved.laps);
  trackGeometry.retry();
}

// ---------------------------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------------------------

function startServer(allowAutoMock: boolean): void {
  const url = wsUrlFor(location, WS_PATH);
  ws = new WsClient(
    url,
    () => {
      const { profile } = useUi.getState();
      return {
        type: 'hello',
        protocolVersion: WS_PROTOCOL_VERSION,
        deviceId: profile.deviceId,
        deviceName: profile.name,
        userAgent: navigator.userAgent,
      };
    },
    {
      onMessage: handleServerMessage,
      onStatus: (status, info) => {
        const s = useUi.getState();
        if (status === 'open') {
          if (s.source === 'mock') {
            stopMock();
            addNotice('info', uiText('Servidor encontrado: saindo da demonstração.'));
          }
          useUi.setState({
            source: 'server',
            mockAuto: false,
            wsStatus: 'open',
            wsAttempt: 0,
            wsRetryAt: null,
            wsEverOpened: true,
          });
          setSender((m) => ws?.send(m) ?? false);
          const v = useUi.getState().currentView;
          ws?.send({ type: 'currentView', view: v });
          return;
        }
        if (status === 'closed' && s.wsStatus === 'open') {
          live.clear();
          useUi.setState({ serverStatus: null, latencyMs: null });
        }
        useUi.setState({
          wsStatus: status,
          wsAttempt: info.attempt,
          wsRetryAt: info.retryInMs === null ? null : Date.now() + info.retryInMs,
        });
        if (
          allowAutoMock &&
          status === 'closed' &&
          !s.wsEverOpened &&
          info.attempt >= AUTO_MOCK_AFTER_ATTEMPTS &&
          s.source !== 'mock'
        ) {
          startMock(true);
        }
      },
    },
  );
  setSender((m) => ws?.send(m) ?? false);
  ws.start();
}

export function retryServerNow(): void {
  ws?.retryNow();
}

/** Entry point, called once at startup. */
export function startConnection(): void {
  const params = new URLSearchParams(location.search);
  if (params.get('mock') === '1') {
    startMock(false);
    return;
  }
  startServer(import.meta.env.DEV);
}
