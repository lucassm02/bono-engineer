import type { EngineerCue, EngineerRadioLog, LapCompletedEvent, LiveFrame } from '@gt7/shared';
import { ApiError, api } from '../analysis/api.ts';
import { loadJson, saveJson } from '../lib/storage.ts';

const KEY = 'gt7.engineer.journal';
const pending = new Map<string, EngineerRadioLog>();
const saved = loadJson<[string, { lapId: string; log: EngineerRadioLog }][]>(KEY);
const queue = new Map(Array.isArray(saved) ? saved : []);
let flushing: Promise<void> | null = null;

export function recordEngineerCall(
  frame: LiveFrame,
  cue: EngineerCue,
  text: string,
  deviceId: string,
): void {
  const { sessionId, distanceM, engineer } = frame;
  const startedAt = frame.lap.startedAt;
  const length = frame.track?.lengthM;
  if (
    !sessionId ||
    startedAt == null ||
    distanceM == null ||
    !length ||
    !cue.cornerId ||
    engineer?.status !== 'ready'
  )
    return;
  const key = `${sessionId}|${startedAt}`;
  let log = pending.get(key);
  if (!log) {
    log = { deviceId, referenceLapId: engineer.referenceLapId, calls: [] };
    pending.set(key, log);
    if (pending.size > 8) pending.delete(pending.keys().next().value!);
  }
  if (log.calls.length >= 256) return;
  const wrap = (meters: number) => ((meters % length) + length) % length;
  log.calls.push({
    cornerId: cue.cornerId,
    kind: cue.kind,
    text,
    distanceM: wrap(distanceM),
    actionDistanceM: wrap(distanceM + cue.aheadM),
  });
}

export function completeEngineerJournal(event: LapCompletedEvent): void {
  const key = `${event.sessionId}|${event.startedAt}`;
  const log = pending.get(key);
  if (!log) return;
  pending.delete(key);
  queue.set(`${event.lapId}|${log.deviceId}|${log.referenceLapId}`, { lapId: event.lapId, log });
  if (queue.size > 25) queue.delete(queue.keys().next().value!);
  saveJson(KEY, [...queue]);
  void flushEngineerJournal();
}

export function flushEngineerJournal(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    for (const [key, { lapId, log }] of queue) {
      try {
        await api.saveEngineerRadio(lapId, log);
        queue.delete(key);
      } catch (error) {
        // Unsaved or deleted laps have no comparison to attach the calls to.
        if (error instanceof ApiError && (error.status === 404 || error.status === 400))
          queue.delete(key);
        else break;
      }
    }
    saveJson(KEY, [...queue]);
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
