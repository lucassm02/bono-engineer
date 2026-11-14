import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Session, SessionEvent } from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS } from './schema.ts';
import { Gt7Store } from './store.ts';

const dirs: string[] = [];
const stores: Gt7Store[] = [];
function open(dir: string): Gt7Store {
  const s = Gt7Store.open(dir);
  stores.push(s);
  return s;
}
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'gt7-kind-'));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const s of stores.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function session(patch: Partial<Session> = {}): Session {
  return {
    id: 's1',
    trackId: null,
    carCode: 3253,
    startedAt: 1000,
    endedAt: 2000,
    format: '~',
    mode: 'live',
    lapCount: 0,
    bestLapMs: null,
    recordingFile: null,
    ...patch,
  };
}

describe('migration v9: session kinds', () => {
  it('marks every existing live session as qualifying (migrated) and leaves replay captures alone', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'traces'));
    mkdirSync(join(dir, 'recordings'));
    // a database as it was before spec 21 (schema v8) with three sessions
    const db = new DatabaseSync(join(dir, 'sessions.db'));
    for (let v = 0; v < 8; v++) db.exec(MIGRATIONS[v]!);
    db.exec('PRAGMA user_version = 8');
    const ins = db.prepare(
      'INSERT INTO sessions (id, track_id, car_code, started_at, ended_at, format, mode) VALUES (?, NULL, 1, 1, 2, ?, ?)',
    );
    ins.run('old1', '~', 'live');
    ins.run('old2', '~', 'live');
    ins.run('cap', '~', 'replayCapture');
    db.close();

    const store = open(dir);
    expect(store.getSession('old1')).toMatchObject({ kind: 'qualifying', kindSource: 'migrated' });
    expect(store.getSession('old2')).toMatchObject({ kind: 'qualifying', kindSource: 'migrated' });
    expect(store.getSession('cap')).toMatchObject({ kind: null, kindSource: null });
    expect(store.listSessions({ kind: 'qualifying' })).toHaveLength(2);
    expect(store.listSessions({ kind: 'none' }).map((s) => s.id)).toEqual(['cap']);
    // the database was copied before anything was rewritten
    expect(existsSync(join(dir, 'sessions.db.before-v8.bak'))).toBe(true);
  });

  it('does not take a snapshot for a brand new database', () => {
    const dir = tmp();
    open(dir);
    expect(existsSync(join(dir, 'sessions.db.before-v0.bak'))).toBe(false);
  });
});

describe('session kind in the store', () => {
  it('saves and reads the race fields', () => {
    const store = open(tmp());
    store.saveSession(
      session({
        kind: 'race',
        kindSource: 'auto',
        raceTotalLaps: 4,
        fieldSize: 15,
        startPosition: 4,
        finishPosition: 5,
      }),
    );
    expect(store.getSession('s1')).toMatchObject({
      kind: 'race',
      kindSource: 'auto',
      raceTotalLaps: 4,
      fieldSize: 15,
      startPosition: 4,
      finishPosition: 5,
    });
  });

  it("the driver's choice is not overwritten when the engine saves the session again", () => {
    const store = open(tmp());
    store.saveSession(session({ kind: 'race', kindSource: 'auto' }));
    expect(store.setSessionKind('s1', 'practice')).toBe(true);
    // the engine still holds the old copy and saves it at the end of the session
    store.saveSession(session({ kind: 'race', kindSource: 'auto', finishPosition: 5 }));
    expect(store.getSession('s1')).toMatchObject({
      kind: 'practice',
      kindSource: 'user',
      finishPosition: 5,
    });
  });

  it('changes several sessions at once, clears with null, and filters', () => {
    const store = open(tmp());
    for (const id of ['a', 'b', 'c'])
      store.saveSession(session({ id, startedAt: id.charCodeAt(0) }));
    expect(store.setSessionsKind(['a', 'b'], 'qualifying')).toBe(2);
    expect(
      store
        .listSessions({ kind: 'qualifying' })
        .map((s) => s.id)
        .sort(),
    ).toEqual(['a', 'b']);
    expect(store.listSessions({ kind: 'none' }).map((s) => s.id)).toEqual(['c']);
    store.setSessionKind('a', null);
    expect(store.getSession('a')).toMatchObject({ kind: null, kindSource: null });
    expect(store.setSessionKind('missing', 'race')).toBe(false);
  });
});

describe('session events in the store', () => {
  const ev = (id: string, at: number, kind: SessionEvent['kind']): SessionEvent => ({
    id,
    sessionId: 's1',
    at,
    kind,
    lap: 2,
    distanceM: kind === 'impact' ? 1234.5 : null,
    data:
      kind === 'impact'
        ? { dvMs2: 240, speedBeforeKmh: 104, speedAfterKmh: 93 }
        : { from: 4, to: 5 },
  });

  it('keeps them in order, ignores a repeated id, and removes them with the session', async () => {
    const store = open(tmp());
    store.saveSession(session());
    store.addSessionEvents([ev('e2', 200, 'impact'), ev('e1', 100, 'position')]);
    store.addSessionEvents([ev('e1', 100, 'position')]);
    const list = store.listSessionEvents('s1');
    expect(list.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(list[1]).toMatchObject({ kind: 'impact', distanceM: 1234.5, lap: 2 });
    expect(list[1]!.data.dvMs2).toBe(240);
    expect(await store.deleteSession('s1')).toBe(true);
    expect(store.listSessionEvents('s1')).toEqual([]);
  });
});
