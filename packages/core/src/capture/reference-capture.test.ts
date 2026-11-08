import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateLaps } from '@gt7/protocol';
import type { ReferenceCaptureStatus, TelemetryPacket } from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { LiveEngine } from '../live/live-engine.ts';
import { Gt7Store } from '../store/store.ts';
import { StoreEngineContext } from '../store/store-context.ts';
import { ReferenceCapture } from './reference-capture.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

let clock = 1_700_000_000_000;
function feed(engine: LiveEngine, packets: TelemetryPacket[]): void {
  for (const p of packets) {
    clock += 1000 / 60;
    engine.push(p, clock);
  }
}
const tick = () => new Promise((r) => setImmediate(r));

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'gt7-capture-'));
  dirs.push(dir);
  const store = Gt7Store.open(dir);
  const engine = new LiveEngine({ context: new StoreEngineContext(store) });
  const capture = new ReferenceCapture({ engine, store });
  // a live session first, so the track is known
  feed(engine, generateLaps({ profile: 'amateur', seed: 3, laps: 1, format: 'B' }).packets);
  engine.endSession();
  return { store, engine, capture };
}

describe('ReferenceCapture', () => {
  it('captures one replay lap, validates, stores it and makes it selectable as reference', async () => {
    const { store, engine, capture } = setup();
    const statuses: ReferenceCaptureStatus[] = [];
    capture.on('status', (s) => statuses.push(s));
    const replay = generateLaps({ profile: 'pro', seed: 9, laps: 2, format: 'B', replay: true });
    await capture.start({ driverName: 'Líder Mundial', rankingTimeMs: replay.laps[0]!.timeMs });
    expect(engine.replayMode).toBe(true);
    expect(capture.status.state).toBe('waitingLapStart');
    feed(engine, replay.packets);
    await tick();
    const st = capture.status;
    expect(st.state).toBe('idle');
    expect(st.issues).toEqual([]);
    expect(st.lapId).not.toBeNull();
    expect(statuses.map((s) => s.state)).toEqual(
      expect.arrayContaining([
        'switchingFormat',
        'waitingLapStart',
        'recording',
        'validating',
        'idle',
      ]),
    );
    expect(engine.replayMode).toBe(false); // exit restored live mode

    const lap = store.getLap(st.lapId!)!;
    expect(lap.isReference).toBe(true);
    expect(lap.flags).toContain('replay');
    expect(lap.timeMs).toBe(replay.laps[0]!.timeMs);
    expect(lap.fuelUsedL).toBeNull();
    expect(lap.referenceMeta).toMatchObject({
      driverName: 'Líder Mundial',
      source: 'replayCapture',
    });
    expect(store.getSession(lap.sessionId)!.mode).toBe('replayCapture');
    expect(store.listReferenceLaps(lap.trackId!).map((l) => l.id)).toEqual([lap.id]);
    // replay laps never become personal bests
    expect(store.getPersonalBestLap(lap.trackId!, lap.carCode)?.id).not.toBe(lap.id);

    // selectable as delta reference (explicit id and "best reference of the track")
    for (const lapId of [lap.id, null]) {
      engine.setDeltaReference('reference', lapId);
      let refSeen: string | null = null;
      let deltas = 0;
      const onFrame = (f: import('@gt7/shared').LiveFrame) => {
        refSeen = f.lap.delta.referenceLapId;
        if (f.lap.delta.ms !== null) deltas++;
      };
      engine.on('frame', onFrame);
      feed(engine, generateLaps({ profile: 'amateur', seed: 4, laps: 1, format: 'B' }).packets);
      engine.off('frame', onFrame);
      engine.endSession();
      expect(refSeen).toBe(lap.id);
      expect(deltas).toBeGreaterThan(1000);
    }
    await store.close();
  });

  it('rejects a lap that does not match the ranking time and keeps waiting', async () => {
    const { store, engine, capture } = setup();
    const invalid: string[][] = [];
    capture.on('invalid', (issues) => invalid.push(issues));
    const replay = generateLaps({ profile: 'pro', seed: 10, laps: 2, format: 'B', replay: true });
    await capture.start({ driverName: 'X', rankingTimeMs: replay.laps[1]!.timeMs + 2000 });
    feed(engine, replay.packets);
    await tick();
    expect(invalid).toHaveLength(2);
    expect(invalid[0]).toContain('timeMismatch');
    expect(capture.status.state).toBe('recording');
    expect(capture.status.issues).toContain('timeMismatch');
    expect(store.listReferenceLaps()).toHaveLength(0);
    await capture.stop(false);
    expect(capture.status.state).toBe('idle');
    expect(engine.replayMode).toBe(false);
    await store.close();
  });
});
