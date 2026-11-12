/** /api/tracks: list/get, rename, recognition candidates, corner names, sector gates, centerline. */

import { equalSectorGates } from '@gt7/core';
import {
  type ApiTrackGoal,
  checkGoal,
  type Goal,
  recognizeTrack,
  type SectorGate,
  suggestGoal,
  type Track,
  type TrackRecognition,
  type Vec2,
} from '@gt7/shared';
import type { FastifyInstance } from 'fastify';
import {
  badRequest,
  bodyObject,
  isSafeId,
  notFound,
  type Obj,
  optNullableString,
  optNumber,
  queryInt,
} from '../http.ts';
import { buildTracksOverview, type TrackOverview } from '../tracks-catalog.ts';
import type { RouteContext } from './context.ts';

const MAX_SECTORS = 20;
/** Minimum spacing between two sector gates (m). */
const MIN_GATE_SPACING_M = 50;

function trackId(params: unknown): string {
  const v = (params as Obj).id;
  if (typeof v !== 'string' || !isSafeId(v)) throw badRequest('Identificador inválido.');
  return v;
}

function parseVec2(v: unknown): Vec2 | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Obj;
  return typeof o.x === 'number' &&
    Number.isFinite(o.x) &&
    typeof o.z === 'number' &&
    Number.isFinite(o.z)
    ? { x: o.x, z: o.z }
    : null;
}

/** Validates user gates: sorted, gate 0 at the start line, spaced, re-indexed. */
export function normalizeGates(input: unknown, lengthM: number): SectorGate[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw badRequest('Informe "gates" (lista de portais) ou "count".');
  }
  if (input.length > MAX_SECTORS) throw badRequest(`No máximo ${MAX_SECTORS} setores.`);
  const gates: { distanceM: number; line?: { a: Vec2; b: Vec2 } }[] = [];
  for (const g of input) {
    if (typeof g !== 'object' || g === null) throw badRequest('Portal de setor inválido.');
    const o = g as Obj;
    const d = o.distanceM;
    if (typeof d !== 'number' || !Number.isFinite(d) || d < 0 || d >= lengthM) {
      throw badRequest(`distanceM deve estar entre 0 e ${Math.floor(lengthM)} m.`);
    }
    let line: { a: Vec2; b: Vec2 } | undefined;
    if (o.line !== undefined && o.line !== null) {
      const l = o.line as Obj;
      const a = parseVec2(l?.a);
      const b = parseVec2(l?.b);
      if (!a || !b) throw badRequest('A linha do portal deve ter pontos a e b com x e z.');
      line = { a, b };
    }
    gates.push({ distanceM: d, ...(line ? { line } : {}) });
  }
  gates.sort((a, b) => a.distanceM - b.distanceM);
  if (gates[0]!.distanceM !== 0) gates.unshift({ distanceM: 0 });
  for (let i = 1; i < gates.length; i++) {
    if (gates[i]!.distanceM - gates[i - 1]!.distanceM < MIN_GATE_SPACING_M) {
      throw badRequest(`Os portais devem estar a pelo menos ${MIN_GATE_SPACING_M} m um do outro.`);
    }
  }
  if (lengthM - gates.at(-1)!.distanceM < MIN_GATE_SPACING_M) {
    throw badRequest(`O último portal deve estar a pelo menos ${MIN_GATE_SPACING_M} m da chegada.`);
  }
  if (gates.length > MAX_SECTORS) throw badRequest(`No máximo ${MAX_SECTORS} setores.`);
  return gates.map((g, index) => ({ index, ...g }));
}

export function trackRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { runtime, hub } = ctx;
  const store = runtime.store;

  const getTrack = (id: string): Track => {
    const t = store.getTrack(id);
    if (!t) throw notFound('Pista não encontrada.');
    return t;
  };
  const changed = () => {
    runtime.refreshTrack();
    hub.scheduleStatus();
  };

  app.get('/tracks', async () => store.listTracks());

  /**
   * Home screen data in one request: per track thumbnail, counts, best lap, cars and trend.
   * `simulator` tells the UI that everything here comes from the demo console (badge "Demo").
   */
  app.get(
    '/tracks/overview',
    async (): Promise<{ simulator: boolean; tracks: TrackOverview[] }> => ({
      simulator: ctx.simulator,
      tracks: buildTracksOverview({
        tracks: store.listTracks(),
        sessions: store.listSessions({ limit: 1000 }),
        lapsOf: (id) => store.listLapsForTrack(id, { orderBy: 'startedAt', limit: 20000 }),
        centerlineOf: (id) => store.getCenterline(id),
      }),
    }),
  );

  app.get('/tracks/:id', async (req) => getTrack(trackId(req.params)));

  // ------------------------------------------------------------------------------------ goal

  const carParam = (q: Obj): number | null => {
    const car = queryInt(q, 'carCode', 'carCode', { min: 1 });
    return car ?? null;
  };

  /** Ideal lap of the fastest own laps (sum of the best sectors), null when it cannot be made. */
  const idealLapMs = async (id: string, carCode: number | null): Promise<number | null> => {
    const laps = store
      .listLapsForTrack(id, {
        ...(carCode !== null ? { carCode } : {}),
        validOnly: true,
        includeReferences: false,
        limit: 12,
      })
      .filter((l) => !l.flags.includes('replay'));
    if (laps.length < 2) return null;
    try {
      const m = await runtime.analysis.getMicrosectors(laps.map((l) => l.id));
      return m.report.theoreticalBestSectorsMs;
    } catch {
      return null;
    }
  };

  app.get('/tracks/:id/goal', async (req): Promise<ApiTrackGoal> => {
    const id = trackId(req.params);
    getTrack(id);
    const carCode = carParam(req.query as Obj);
    const own = store
      .listLapsForTrack(id, {
        ...(carCode !== null ? { carCode } : {}),
        validOnly: true,
        includeReferences: false,
        orderBy: 'time',
      })
      .filter((l) => !l.flags.includes('replay'));
    const bestLapMs = own[0]?.timeMs ?? null;
    const active = store.getActiveGoal(id, carCode);
    const before = active ? own.filter((l) => l.startedAt < active.createdAt) : [];
    return {
      trackId: id,
      active,
      history: store.listGoalHistory(id),
      suggestion: suggestGoal(bestLapMs, await idealLapMs(id, carCode)),
      bestLapMs,
      baselineMs: before[0]?.timeMs ?? null,
    };
  });

  app.put('/tracks/:id/goal', async (req): Promise<Goal> => {
    const id = trackId(req.params);
    getTrack(id);
    const b = bodyObject(req.body);
    const carCode = optNumber(b, 'carCode', 'carCode', { min: 1, integer: true }) ?? null;
    const best = store
      .listLapsForTrack(id, {
        ...(carCode !== null ? { carCode } : {}),
        validOnly: true,
        includeReferences: false,
        orderBy: 'time',
      })
      .find((l) => !l.flags.includes('replay'));
    const check = checkGoal(b.targetMs, best?.timeMs ?? null, b.allowSlower === true);
    if (!check.ok) {
      throw check.reason === 'slower'
        ? badRequest(
            'A meta é mais lenta que a sua melhor volta. Confirme se é isso mesmo ou digite um tempo menor.',
            'goalSlower',
          )
        : badRequest('Informe uma meta entre 10 s e 1 hora (ex.: 1:45.000).', 'goalInvalid');
    }
    const goal = store.setGoal(id, carCode, check.targetMs);
    runtime.refreshGoal();
    return goal;
  });

  app.delete('/tracks/:id/goal', async (req): Promise<{ ok: true }> => {
    const id = trackId(req.params);
    getTrack(id);
    store.clearGoal(id, carParam(req.query as Obj));
    runtime.refreshGoal();
    return { ok: true };
  });

  app.get('/tracks/:id/centerline', async (req) => {
    const id = trackId(req.params);
    getTrack(id);
    const c = store.getCenterline(id);
    if (!c) throw notFound('Esta pista ainda não tem linha de referência.', 'noCenterline');
    return c;
  });

  /**
   * Candidates for naming a track: the stored centerline compared with the shipped driving lines of
   * the 122 official layouts (falls back to the length window when there is no line). Never renames
   * anything: the UI asks the user to confirm.
   */
  app.get('/tracks/:id/recognition', async (req): Promise<TrackRecognition> => {
    const id = trackId(req.params);
    const t = getTrack(id);
    const c = store.getCenterline(id);
    return recognizeTrack(t.lengthM, c ? { x: c.x, z: c.z } : null);
  });

  app.get('/tracks/:id/laps', async (req) => {
    const id = trackId(req.params);
    getTrack(id);
    return store.listLapsForTrack(id);
  });

  app.patch('/tracks/:id', async (req) => {
    const id = trackId(req.params);
    getTrack(id);
    const b = bodyObject(req.body);
    const name = b.name;
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 80)) {
      throw badRequest('O nome da pista deve ter de 1 a 80 caracteres.');
    }
    const layout = optNullableString(b, 'layout', 'layout', 80);
    if (name === undefined && layout === undefined) {
      throw badRequest('Nada para alterar: informe "name" e/ou "layout".');
    }
    const t = store.updateTrack(id, {
      ...(typeof name === 'string' ? { name: name.trim() } : {}),
      ...(layout !== undefined ? { layout } : {}),
      source: 'user',
    });
    changed();
    return t;
  });

  app.patch('/tracks/:id/corners/:cornerId', async (req) => {
    const id = trackId(req.params);
    const cornerId = (req.params as Obj).cornerId;
    const t = getTrack(id);
    if (typeof cornerId !== 'string' || !t.corners.some((c) => c.id === cornerId)) {
      throw notFound('Curva não encontrada nesta pista.');
    }
    const b = bodyObject(req.body);
    const name = optNullableString(b, 'name', 'name', 60);
    const note = optNullableString(b, 'brakeMarkerNote', 'brakeMarkerNote', 200);
    if (name === undefined && note === undefined) {
      throw badRequest('Nada para alterar: informe "name" e/ou "brakeMarkerNote".');
    }
    const updated = store.setTrackCorners(
      id,
      t.corners.map((c) =>
        c.id === cornerId
          ? {
              ...c,
              ...(name !== undefined ? { name: name?.trim() || null } : {}),
              ...(note !== undefined ? { brakeMarkerNote: note?.trim() || null } : {}),
            }
          : c,
      ),
    );
    changed();
    return updated;
  });

  /** Body: `{ count: n }` (equal sectors) or `{ gates: [{ distanceM, line? }] }`. */
  app.put('/tracks/:id/sectors', async (req) => {
    const id = trackId(req.params);
    const t = getTrack(id);
    const b = bodyObject(req.body);
    const count = optNumber(b, 'count', 'count', { min: 1, max: MAX_SECTORS, integer: true });
    let gates: SectorGate[];
    if (count !== undefined) gates = equalSectorGates(t.lengthM, count);
    else gates = normalizeGates(b.gates, t.lengthM);
    const updated = store.setSectorGates(id, gates);
    changed();
    return updated;
  });
}
