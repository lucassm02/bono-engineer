/** Monitor GT7 replays or live races via the local dashboard stream. Only aggregates go to stdout. */
import { parseArgs } from 'node:util';
import type { LiveFrame, ServerMessage } from '../packages/shared/src/index.ts';
import {
  isTyreCompound,
  TYRE_COMPOUNDS,
  TyreWearTracker,
} from '../packages/shared/src/tyre-wear.ts';
import { DEFAULT_HTTP_PORT, WS_PATH, WS_PROTOCOL_VERSION } from '../packages/shared/src/ws.ts';

const { values, positionals } = parseArgs({
  options: { help: { type: 'boolean' }, live: { type: 'boolean' }, port: { type: 'string' } },
  allowPositionals: true,
});
if (values.help) {
  console.log('node scripts/watch-replay-tyre-wear.ts [--live] [--port 8770] [composto...]');
  console.log(`Compostos (padrão: todos): ${TYRE_COMPOUNDS.join(', ')}`);
  console.log(
    'Reproduza em 1×. Saia para o menu entre replays. Enter ou Ctrl+C encerra a leitura.',
  );
  process.exit(0);
}
const port = Number(values.port ?? DEFAULT_HTTP_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Porta inválida.');
const compounds = positionals.length
  ? [...new Set(positionals)].filter(isTyreCompound)
  : TYRE_COMPOUNDS;
if (positionals.some((compound) => !isTyreCompound(compound)))
  throw new Error('Composto inválido. Use --help.');

const url = new URL(`ws://127.0.0.1:${port}${WS_PATH}`);
if (process.env.GT7_TOKEN) url.searchParams.set('token', process.env.GT7_TOKEN);
const socket = new WebSocket(url);
const live = values.live === true;

const PACKETS_PER_SECOND = 60;
const MAX_FRAME_GAP_MS = 500;
const END_AFTER_SILENCE_MS = 8000;
const PROGRESS_INTERVAL_S = 30;

interface Replay {
  n: number;
  carCode: number;
  startedAt: number;
  lastAt: number;
  seconds: number;
  lastProgressS: number;
  frames: number;
  gaps: number;
  track: string | null;
  firstLap: number;
  firstLapMs: number;
  lastLap: number;
  trackers: ReturnType<typeof createTrackers>;
}

let replay: Replay | null = null;
let previous: LiveFrame | null = null;
let number = 0;
let captureIdle = false;
let ready = false;
let ending = false;
let lastFrameAt = Date.now();

function createTrackers() {
  return compounds.map((compound) => ({ compound, tracker: new TyreWearTracker() }));
}

function report(kind: 'progress' | 'lap' | 'end', current: Replay, reason?: string) {
  const wearAt1xPct = Object.fromEntries(
    current.trackers.map(({ compound, tracker }) => {
      const { wear } = tracker.snapshot(compound, null);
      return [compound, wear.map((value) => Number((value * 100).toFixed(4)))];
    }),
  );
  console.log(
    JSON.stringify({
      kind,
      replay: current.n,
      track: current.track,
      ...(live && {
        firstLap: current.firstLap,
        firstLapMs: current.firstLapMs,
        lap: current.lastLap,
      }),
      carCode: current.carCode,
      startedAt: new Date(current.startedAt).toISOString(),
      lastSampleAt: new Date(current.lastAt).toISOString(),
      replaySeconds: Number(current.seconds.toFixed(1)),
      km: Number((current.trackers[0]?.tracker.distKm ?? 0).toFixed(3)),
      frames: current.frames,
      gaps: current.gaps,
      wearAt1xPct,
      reason,
    }),
  );
}

function endReplay(reason: string) {
  if (replay) report('end', replay, reason);
  replay = null;
  previous = null;
}

function stop(reason: string, failure = false) {
  if (ending) return;
  ending = true;
  endReplay(reason);
  console.log(reason);
  process.exitCode = failure ? 1 : 0;
  socket.close();
  process.stdin.pause();
}

function observe(frame: LiveFrame) {
  lastFrameAt = Date.now();
  if (!ready) return;
  if (live && frame.sessionId && frame.state === 'paused') {
    previous = null;
    return;
  }
  if (
    live &&
    frame.sessionId &&
    frame.state === 'onTrack' &&
    (frame.lap.finished ||
      frame.race?.state === 'finished' ||
      (frame.lap.totalLaps && frame.lap.lap > frame.lap.totalLaps))
  ) {
    endReplay('bandeirada');
    return;
  }
  if (
    live
      ? !frame.sessionId || frame.state !== 'onTrack'
      : frame.sessionId || frame.state !== 'replay'
  ) {
    if (live) {
      endReplay('saída da pista');
      return;
    }
    endReplay(frame.sessionId ? 'sessão de pilotagem ativa' : 'saída do replay');
    return;
  }

  const track = frame.trackContext;
  const trackName =
    track?.name && (live || track.basis === 'path')
      ? [track.name, track.layout].filter(Boolean).join(' / ')
      : live
        ? (frame.track?.name ?? null)
        : null;
  if (replay && trackName) replay.track = trackName;

  const before = previous;
  previous = frame;
  if (!before) return;
  // A track confirmation can give the current race a new session ID at a lap boundary.
  if (live && frame.lap.lap < before.lap.lap) {
    endReplay('nova corrida');
    previous = frame;
    return;
  }
  if (frame.car.carCode !== before.car.carCode || frame.packetId < before.packetId) {
    endReplay('mudança de carro ou reinício do fluxo');
    previous = frame;
    return;
  }
  const packets = frame.packetId - before.packetId;
  if (packets === 0) return;
  const dt = packets / PACKETS_PER_SECOND;
  const elapsedMs = frame.t - before.t;
  const speedMps = frame.car.speedKmh / 3.6;
  const distanceM = (before.car.speedKmh / 3.6 + speedMps) * 0.5 * dt;
  const movementM = Math.hypot(
    frame.position.x - before.position.x,
    frame.position.y - before.position.y,
    frame.position.z - before.position.z,
  );
  if (movementM > Math.max(20, distanceM * 2.5)) {
    endReplay('salto de posição');
    previous = frame;
    return;
  }
  if (frame.flags.paused || frame.flags.loadingOrProcessing || movementM <= 0 || speedMps < 1)
    return;
  const tempC = frame.tyres.tempC;
  const slip = frame.tyres.slip;
  const { brake } = frame.car;
  const gLat = frame.g.lateral;
  if (
    elapsedMs < 0 ||
    elapsedMs > MAX_FRAME_GAP_MS ||
    dt * 1000 > MAX_FRAME_GAP_MS ||
    ![distanceM, movementM, brake, gLat, ...tempC, ...slip].every(Number.isFinite)
  ) {
    if (replay) replay.gaps++;
    return;
  }

  if (!replay) {
    replay = {
      n: ++number,
      carCode: frame.car.carCode,
      startedAt: before.t,
      lastAt: frame.t,
      seconds: 0,
      lastProgressS: 0,
      frames: 0,
      gaps: 0,
      track: trackName,
      firstLap: before.lap.lap,
      firstLapMs: before.lap.currentLapMs,
      lastLap: frame.lap.lap,
      trackers: createTrackers(),
    };
    console.log(
      JSON.stringify({ kind: 'start', replay: number, carCode: replay.carCode, track: trackName }),
    );
  }
  for (const { compound, tracker } of replay.trackers) {
    tracker.add(compound, { distM: distanceM, speedMps, tempC, slip, gLat, brake, wearRate: 1 });
  }
  replay.seconds += dt;
  replay.frames++;
  replay.lastAt = frame.t;
  if (live && frame.lap.lap > replay.lastLap) {
    replay.lastLap = frame.lap.lap;
    if (replay.lastLap > 1) report('lap', replay, 'passagem pela linha');
  }
  if (replay.seconds - replay.lastProgressS >= PROGRESS_INTERVAL_S) {
    report('progress', replay);
    replay.lastProgressS = replay.seconds;
  }
}

const timer = setInterval(() => {
  if (!ready && Date.now() - lastFrameAt > 5000) stop('O Bono não respondeu ao watcher.', true);
  if (replay && Date.now() - lastFrameAt > END_AFTER_SILENCE_MS)
    endReplay('fluxo do PS5 interrompido');
}, 1000);

socket.addEventListener('open', () => {
  socket.send(
    JSON.stringify({
      type: 'hello',
      protocolVersion: WS_PROTOCOL_VERSION,
      deviceId: 'tyre-test-local',
    }),
  );
});
socket.addEventListener('message', ({ data }) => {
  if (ending) return;
  const message = JSON.parse(String(data)) as ServerMessage;
  if (message.type === 'status') {
    captureIdle = message.status.capture.state === 'idle';
    if (!captureIdle)
      stop('A captura de referência do Bono está ativa. Encerre-a antes do teste.', true);
  }
  if (message.type === 'sessionChanged' && captureIdle && !ready) {
    if (message.session && !live) {
      stop('Há uma sessão ativa no Bono. Aguarde o fechamento antes de iniciar o watcher.', true);
      return;
    }
    ready = true;
    console.log(
      `Watcher pronto. Aguardando ${live ? 'corridas ao vivo' : 'replays'} no GT7. Ordem das rodas: DE, DD, TE, TD.`,
    );
  }
  if (message.type === 'frame') observe(message.frame);
});
socket.addEventListener('error', () => stop('Falha na conexão com o Bono local.', true));
socket.addEventListener('close', () => {
  clearInterval(timer);
  if (!ending) stop('Conexão com o Bono encerrada.', true);
});
process.on('SIGINT', () => stop('Leitura encerrada.'));
process.stdin.setEncoding('utf8');
process.stdin.on('data', () => stop('Leitura encerrada.'));
