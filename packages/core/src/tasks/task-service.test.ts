import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Track } from '@gt7/shared';
import { TASK_LIMITS } from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { Gt7Store } from '../store/store.ts';
import { newId } from '../util/ids.ts';
import { TaskError, TaskService } from './task-service.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const d = mkdtempSync(join(tmpdir(), 'gt7-tasks-'));
  dirs.push(d);
  const store = Gt7Store.open(d);
  const track: Track = {
    id: 'trk',
    name: 'Pista',
    fingerprint: {
      start: { x: 0, z: 0 },
      startHeadingRad: 0,
      lengthM: 3000,
      bbox: { min: { x: 0, z: 0 }, max: { x: 1, z: 1 } },
      shape: [],
    },
    lengthM: 3000,
    centerline: null,
    sectorGates: [
      { index: 0, distanceM: 0 },
      { index: 1, distanceM: 1000 },
      { index: 2, distanceM: 2000 },
    ],
    corners: [
      {
        id: 'T1',
        index: 0,
        name: null,
        entryM: 400,
        apexM: 480,
        exitM: 560,
        direction: 'left',
        kind: 'slow',
      },
      {
        id: 'T2',
        index: 1,
        name: null,
        entryM: 900,
        apexM: 960,
        exitM: 1020,
        direction: 'right',
        kind: 'fast',
      },
    ],
    source: 'auto',
    createdAt: 1,
    updatedAt: 1,
  } as unknown as Track;
  store.insertTrack(track);
  return { store, track };
}

const BRAKE = { action: 'brake', amount: 'm20', comparator: 'later' };

describe('TaskService', () => {
  it('keeps what an agent proposes waiting for the driver, already composed', async () => {
    const { store, track } = setup();
    let changes = 0;
    const svc = new TaskService(store, () => changes++);
    const { task, composition } = svc.propose({
      trackId: track.id,
      carCode: 7,
      where: { corner: 1, phase: 'entry' },
      say: BRAKE,
      why: 'perde 0,12 s na entrada da T1',
      source: 'agent',
      agent: 'claude-code',
    });
    expect(composition.text['pt-BR']).toBe('Foco. Na T1, entrada. Freie vinte metros mais tarde.');
    expect(task).toMatchObject({
      status: 'proposed',
      approvedAt: null,
      source: 'agent',
      agent: 'claude-code',
      carCode: 7,
    });
    expect(task!.ids).toEqual(composition.ids);
    expect(task!.spoken.en).toBe('Focus. At turn one, entry. Brake twenty meters later.');
    expect(svc.proposalsCount()).toBe(1);
    // nothing is spoken before the approval
    expect(svc.liveTasks(track, 7)).toEqual([]);
    expect(changes).toBe(1);
    await store.close();
  });

  it('turns a position in metres into the place it falls on, and lists the live task after approval', async () => {
    const { store, track } = setup();
    const svc = new TaskService(store);
    const { task } = svc.propose({
      trackId: track.id,
      where: { atM: 700 },
      say: { action: 'gearUp', gear: 4 },
      source: 'agent',
    });
    expect(task!.where).toEqual({ between: [1, 2] });
    expect(task!.spoken['pt-BR']).toBe('Foco. Da T1 à T2. Suba para a quarta marcha.');
    svc.setStatus(task!.id, 'active');
    const live = svc.liveTasks(track, 99);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({
      id: task!.id,
      atM: [560],
      keys: ['Foco.', 'da T1', 'à T2.', 'Suba para a', 'Quarta marcha.'],
    });
    // a task for another car is not live for this one
    const other = svc.propose({
      trackId: track.id,
      carCode: 5,
      where: { corner: 2 },
      say: { action: 'dose' },
      source: 'driver',
    });
    expect(other.task!.status).toBe('active');
    expect(svc.liveTasks(track, 99).map((t) => t.id)).toEqual([task!.id]);
    expect(
      svc
        .liveTasks(track, 5)
        .map((t) => t.id)
        .sort(),
    ).toEqual([task!.id, other.task!.id].sort());
    await store.close();
  });

  it('refuses what the dictionary cannot say, counts the miss and tells what is valid', async () => {
    const { store, track } = setup();
    const svc = new TaskService(store);
    const ask = () =>
      svc.propose({
        trackId: track.id,
        where: { corner: 1 },
        say: { action: 'dance' },
        source: 'agent',
      });
    expect(ask).toThrow(TaskError);
    try {
      ask();
    } catch (e) {
      expect((e as TaskError).code).toBe('invalid');
      expect((e as TaskError).valid).toContain('brake');
    }
    expect(store.listTaskMisses()[0]).toMatchObject({ group: 'invalidAction', count: 2 });
    // a dry run counts nothing and creates nothing
    const dry = svc.propose({
      trackId: track.id,
      where: { corner: 1 },
      say: BRAKE,
      source: 'agent',
      dryRun: true,
    });
    expect(dry.task).toBeNull();
    expect(svc.list()).toHaveLength(0);
    expect(() =>
      svc.propose({ trackId: 'nope', where: { corner: 1 }, say: BRAKE, source: 'agent' }),
    ).toThrow('Pista não encontrada');
    await store.close();
  });

  it('lets the driver decide and keeps the agent out of decided tasks', async () => {
    const { store, track } = setup();
    const svc = new TaskService(store);
    const { task } = svc.propose({
      trackId: track.id,
      where: { corner: 2 },
      say: BRAKE,
      source: 'coach',
    });
    const id = task!.id;
    // the agent may still edit and withdraw an open proposal
    expect(
      svc.agentUpdate(id, { say: { action: 'brake', comparator: 'earlier' }, why: 'mais cedo' })
        .spoken['pt-BR'],
    ).toBe('Foco. Na T2. Freie mais cedo.');
    svc.setStatus(id, 'active');
    expect(svc.store.getTask(id)!.approvedAt).not.toBeNull();
    expect(() => svc.agentUpdate(id, { note: 'x' })).toThrow(TaskError);
    expect(() => svc.withdraw(id)).toThrow(TaskError);
    // active → paused → done → active again
    svc.setStatus(id, 'paused');
    expect(svc.liveTasks(track, null)).toEqual([]);
    svc.setStatus(id, 'done');
    svc.setStatus(id, 'active');
    expect(() => svc.setStatus(id, 'proposed')).toThrow('não pode passar');
    // the driver edits: the sentence is composed again
    expect(
      svc.update(id, { say: { action: 'gearDown', gear: 3, focus: 'none' } }).spoken['pt-BR'],
    ).toBe('Na T2. Reduza para a terceira marcha.');
    svc.remove(id);
    expect(() => svc.remove(id)).toThrow(TaskError);
    await store.close();
  });

  it('limits the open proposals per track and the total', async () => {
    const { store, track } = setup();
    const svc = new TaskService(store);
    for (let i = 0; i < TASK_LIMITS.proposalsPerTrack; i++) {
      svc.propose({
        trackId: track.id,
        where: { corner: 1 },
        say: { action: 'dose' },
        source: 'agent',
      });
    }
    expect(() =>
      svc.propose({
        trackId: track.id,
        where: { corner: 1 },
        say: { action: 'dose' },
        source: 'agent',
      }),
    ).toThrow('propostas esperando');
    // the driver is not held to the limit of proposals
    expect(
      svc.propose({
        trackId: track.id,
        where: { corner: 1 },
        say: { action: 'dose' },
        source: 'driver',
      }).task!.status,
    ).toBe('active');
    await store.close();
  });

  it('marks tasks stale when the track loses their corner, and an edit brings them back', async () => {
    const { store, track } = setup();
    const svc = new TaskService(store);
    const { task } = svc.propose({
      trackId: track.id,
      where: { corner: 2 },
      say: { action: 'dose' },
      source: 'driver',
    });
    expect(
      svc.reconcileTrack({ ...track, corners: track.corners.filter((c) => c.id !== 'T2') }),
    ).toBe(1);
    expect(svc.store.getTask(task!.id)!.status).toBe('stale');
    expect(svc.liveTasks({ ...track, corners: [] }, null)).toEqual([]);
    expect(svc.update(task!.id, { where: { corner: 1 } }).status).toBe('active');
    expect(newId()).toBeTruthy();
    await store.close();
  });
});
