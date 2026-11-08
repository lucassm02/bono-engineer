/**
 * Analysis REST API over `ctx.runtime.analysis` (AnalysisService):
 *
 *   GET  /api/analysis/tracks/:trackId          map polyline, corners, sectors, records
 *   GET  /api/analysis/laps/:lapId              per-corner metrics, validity, AI summary
 *   GET  /api/analysis/compare?lap=&ref=        corner-by-corner comparison (+ Markdown)
 *   GET  /api/analysis/delta?lap=&ref=&stepM=   delta by distance
 *   GET  /api/analysis/traces?laps=&channels=…  laps resampled on one distance grid
 *   GET  /api/analysis/microsectors?laps=&ref=  microsectors, colors, theoretical best
 *   GET  /api/analysis/consistency?sessionId= | ?laps=
 *   GET  /api/analysis/evolution?trackId=&carCode=
 *   GET  /api/analysis/chart.png?lap=&ref=&corner=&width=   PNG (MCP chart renderer)
 *   GET  /api/laps/:id/trace                    raw stored trace (columnar JSON)
 *   GET  /api/laps/:id/export.csv               CSV aligned by distance (main channels)
 *   POST /api/tracks/:id/redetect-corners       forces corner re-detection
 *
 * AnalysisError → HTTP status in the app error handler (see web.ts / http.ts).
 */

import { AnalysisError } from '@gt7/core';
import { buildComparisonChart } from '@gt7/mcp';
import {
  API_LAP_CSV_COLUMNS,
  API_TRACE_CHANNEL_ALIASES,
  type ApiComparison,
  type ApiConsistency,
  type ApiDistanceDelta,
  type ApiEvolution,
  type ApiLapAnalysis,
  type ApiLapTrace,
  type ApiMicrosectors,
  type ApiRedetectCornersResult,
  type ApiTraces,
  type ApiTrackAnalysis,
  COMPARISON_REFERENCE_KINDS,
  type ComparisonReferenceKind,
  type Id,
  type LapSampleChannel,
  type LapTrace,
  TRACE_CHANNELS,
  type TraceChannel,
} from '@gt7/shared';
import type { FastifyInstance } from 'fastify';
import { badRequest, isSafeId, notFound, type Obj, queryInt, queryString } from '../http.ts';
import type { RouteContext } from './context.ts';

const MAX_LAPS = 20;
const MAX_TRACE_LAPS = 6;
const MAX_TRACE_POINTS = 5000;

function idParam(params: unknown, key: string): string {
  const v = (params as Obj)[key];
  if (typeof v !== 'string' || !isSafeId(v)) throw badRequest('Identificador inválido.');
  return v;
}

function reqId(q: Obj, key: string, label: string): string {
  const v = queryString(q, key);
  if (!v) throw badRequest(`Informe o parâmetro "${label}".`);
  if (!isSafeId(v)) throw badRequest(`O parâmetro "${label}" é inválido.`);
  return v;
}

function refParam(q: Obj, key = 'ref'): Id | ComparisonReferenceKind {
  const v = queryString(q, key);
  if (!v) return 'auto';
  if ((COMPARISON_REFERENCE_KINDS as readonly string[]).includes(v)) {
    return v as ComparisonReferenceKind;
  }
  if (!isSafeId(v)) {
    throw badRequest(
      'O parâmetro "ref" deve ser um id de volta ou personalBest, sessionBest, bestReference, auto.',
    );
  }
  return v;
}

function lapList(q: Obj, key: string, max: number, min = 1): string[] {
  const raw = queryString(q, key);
  const ids = [
    ...new Set(
      (raw ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length < min) {
    throw badRequest(
      min > 1
        ? `Informe pelo menos ${min} voltas em "${key}" (ids separados por vírgula).`
        : `Informe "${key}" (ids de voltas separados por vírgula).`,
    );
  }
  if (ids.length > max) throw badRequest(`No máximo ${max} voltas em "${key}".`);
  for (const id of ids) if (!isSafeId(id)) throw badRequest(`Id de volta inválido: ${id}`);
  return ids;
}

function queryNum(
  q: Obj,
  key: string,
  label: string,
  range: { min?: number; max?: number } = {},
): number | undefined {
  const raw = q[key];
  if (raw === undefined || raw === '') return undefined;
  const n = typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) throw badRequest(`O parâmetro "${label}" deve ser um número.`);
  if (range.min !== undefined && n < range.min) {
    throw badRequest(`O parâmetro "${label}" deve ser no mínimo ${range.min}.`);
  }
  if (range.max !== undefined && n > range.max) {
    throw badRequest(`O parâmetro "${label}" deve ser no máximo ${range.max}.`);
  }
  return n;
}

/** NaN/±Infinity → null (JSON-safe), optional rounding. */
function cleanArray(values: ArrayLike<number>, digits?: number): (number | null)[] {
  const f = digits === undefined ? 0 : 10 ** digits;
  const out = new Array<number | null>(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    out[i] = Number.isFinite(v) ? (f ? Math.round(v * f) / f : v) : null;
  }
  return out;
}

/** Maps requested channel names (aliases or TraceChannel names) to TraceChannel. */
export function parseTraceChannels(raw: string | undefined): { key: string; ch: TraceChannel }[] {
  const names = (raw ?? 'speed,throttle,brake,gear,steering')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0 || names.length > 12) {
    throw badRequest('Informe de 1 a 12 canais em "channels".');
  }
  return names.map((key) => {
    const alias = (API_TRACE_CHANNEL_ALIASES as Record<string, TraceChannel>)[key];
    const ch = alias ?? ((TRACE_CHANNELS as readonly string[]).includes(key) ? key : null);
    if (!ch) {
      throw badRequest(
        `Canal desconhecido: ${key}. Use ${Object.keys(API_TRACE_CHANNEL_ALIASES).join(', ')} ` +
          'ou um canal do trace (speedKmh, latG…).',
      );
    }
    return { key, ch: ch as TraceChannel };
  });
}

const csvNum = (v: number | undefined, digits: number) =>
  v === undefined || !Number.isFinite(v) ? '' : String(Math.round(v * 10 ** digits) / 10 ** digits);

/** CSV of a lap: distance-aligned rows (1 m grid on the track line, else raw samples). */
async function lapCsv(ctx: RouteContext, lapId: Id, stepM: number): Promise<string> {
  const header = API_LAP_CSV_COLUMNS.join(',');
  const rows: string[] = [header];
  try {
    const t = await ctx.runtime.analysis.getResampledTrace(lapId, {
      stepM,
      maxPoints: 20_000,
      channels: [
        'timeS',
        'speedKmh',
        'throttle',
        'brake',
        'gear',
        'rpm',
        'steering',
        'latG',
        'lonG',
        'x',
        'y',
        'z',
      ],
    });
    const c = t.channels;
    for (let i = 0; i < t.distanceM.length; i++) {
      rows.push(
        [
          csvNum(t.distanceM[i], 2),
          csvNum(c.timeS?.[i], 3),
          csvNum(c.speedKmh?.[i], 2),
          csvNum((c.throttle?.[i] ?? Number.NaN) * 100, 1),
          csvNum((c.brake?.[i] ?? Number.NaN) * 100, 1),
          csvNum(c.gear?.[i], 0),
          csvNum(c.rpm?.[i], 0),
          csvNum(c.steering?.[i], 4),
          csvNum(c.latG?.[i], 3),
          csvNum(c.lonG?.[i], 3),
          csvNum(c.x?.[i], 2),
          csvNum(c.y?.[i], 2),
          csvNum(c.z?.[i], 2),
        ].join(','),
      );
    }
    return `${rows.join('\r\n')}\r\n`;
  } catch (e) {
    // No track line yet: raw samples sorted by their own distance.
    if (!(e instanceof AnalysisError) || !['noTrack', 'noCenterline'].includes(e.code)) throw e;
  }
  const trace = await ctx.runtime.store.loadTrace(lapId);
  if (!trace) throw notFound('Esta volta não tem trace gravado.', 'noTrace');
  const ch = trace.channels;
  for (let i = 0; i < trace.length; i++) {
    rows.push(
      [
        csvNum(ch.distanceM[i], 2),
        csvNum((ch.tMs[i] ?? Number.NaN) / 1000, 3),
        csvNum(ch.speedKmh[i], 2),
        csvNum((ch.throttle[i] ?? Number.NaN) * 100, 1),
        csvNum((ch.brake[i] ?? Number.NaN) * 100, 1),
        csvNum(ch.gear[i], 0),
        csvNum(ch.rpm[i], 0),
        csvNum(ch.steeringRad[i], 4),
        csvNum(ch.latG[i], 3),
        csvNum(ch.lonG[i], 3),
        csvNum(ch.x[i], 2),
        csvNum(ch.y[i], 2),
        csvNum(ch.z[i], 2),
      ].join(','),
    );
  }
  return `${rows.join('\r\n')}\r\n`;
}

export function analysisRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { runtime, hub } = ctx;
  const analysis = runtime.analysis;
  const store = runtime.store;

  // ------------------------------------------------------------------------------- tracks

  app.get('/analysis/tracks/:trackId', async (req): Promise<ApiTrackAnalysis> => {
    const trackId = idParam(req.params, 'trackId');
    const maxPoints = queryInt(req.query as Obj, 'maxPoints', 'maxPoints', {
      min: 50,
      max: 5000,
    });
    const a = await analysis.getTrackAnalysis(trackId, { maxMapPoints: maxPoints ?? 1000 });
    if (!a.map) {
      throw notFound('Esta pista ainda não tem linha de referência.', 'noCenterline');
    }
    return {
      track: a.track,
      polyline: { x: a.map.x, z: a.map.z, stepM: a.map.stepM, lengthM: a.map.lengthM },
      corners: a.corners,
      sectorStartsM: a.sectors.map((s) => s.fromM),
      sectors: a.sectors,
      records: a.records,
      references: a.records.references,
      sessionCount: a.sessionCount,
      lapCount: a.lapCount,
    };
  });

  app.post('/tracks/:id/redetect-corners', async (req): Promise<ApiRedetectCornersResult> => {
    const id = idParam(req.params, 'id');
    if (!store.getTrack(id)) throw notFound('Pista não encontrada.');
    const res = await analysis.ensureTrackCorners(id, { force: true });
    runtime.refreshTrack();
    hub.scheduleStatus();
    return { track: analysis.getTrackOrThrow(id), corners: res.corners, detected: res.detected };
  });

  // --------------------------------------------------------------------------------- laps

  app.get(
    '/analysis/laps/:lapId',
    async (req): Promise<ApiLapAnalysis> => analysis.getLapAnalysis(idParam(req.params, 'lapId')),
  );

  app.get('/analysis/compare', async (req): Promise<ApiComparison> => {
    const q = req.query as Obj;
    return analysis.compareLaps(reqId(q, 'lap', 'lap'), refParam(q), {
      topN: queryInt(q, 'topN', 'topN', { min: 1, max: 20 }) ?? 3,
    });
  });

  app.get('/analysis/delta', async (req): Promise<ApiDistanceDelta> => {
    const q = req.query as Obj;
    const stepM = queryNum(q, 'stepM', 'stepM', { min: 1, max: 100 });
    return analysis.getDeltaTrace(reqId(q, 'lap', 'lap'), refParam(q), {
      ...(stepM !== undefined ? { stepM } : {}),
    });
  });

  app.get('/analysis/traces', async (req): Promise<ApiTraces> => {
    const q = req.query as Obj;
    const lapIds = lapList(q, 'laps', MAX_TRACE_LAPS);
    const channels = parseTraceChannels(queryString(q, 'channels'));
    const prepared = await Promise.all(lapIds.map((id) => analysis.preparedLap(id)));
    const trackIds = new Set(lapIds.map((id) => analysis.getLapOrThrow(id).trackId));
    if (trackIds.size > 1) {
      throw new AnalysisError('trackMismatch', 'As voltas precisam ser da mesma pista.');
    }
    const L = Math.min(...prepared.map((p) => p.lengthM));
    const fromM = Math.max(0, Math.min(queryNum(q, 'from', 'from', { min: 0 }) ?? 0, L));
    const toM = Math.max(fromM, Math.min(queryNum(q, 'to', 'to', { min: 0 }) ?? L, L));
    const maxPoints =
      queryInt(q, 'maxPoints', 'maxPoints', { min: 2, max: MAX_TRACE_POINTS }) ?? 2000;
    const stepM = Math.max(
      queryNum(q, 'stepM', 'stepM', { min: 0.5, max: 500 }) ?? 2,
      (toM - fromM) / (maxPoints - 1),
    );
    const ref = queryString(q, 'ref') ? refParam(q) : undefined;
    const traceChannels = [...new Set(channels.map((c) => c.ch))];
    const traces = await Promise.all(
      lapIds.map((id) =>
        analysis.getResampledTrace(id, {
          fromM,
          toM,
          stepM,
          maxPoints: maxPoints + 1,
          channels: traceChannels,
          ...(ref ? { reference: ref } : {}),
        }),
      ),
    );
    const first = traces[0]!;
    return {
      fromM: first.fromM,
      toM: first.toM,
      stepM: first.stepM,
      distanceM: first.distanceM.map((d) => Math.round(d * 100) / 100),
      channels: channels.map((c) => c.key),
      laps: traces.map((t) => ({
        lapId: t.lapId,
        channels: Object.fromEntries(
          channels.map((c) => [c.key, cleanArray(t.channels[c.ch] ?? [], 4)]),
        ),
      })),
    };
  });

  app.get('/analysis/microsectors', async (req): Promise<ApiMicrosectors> => {
    const q = req.query as Obj;
    const lapIds = lapList(q, 'laps', MAX_LAPS);
    const refRaw = queryString(q, 'ref');
    let referenceLapId: Id | undefined;
    if (refRaw) {
      const ref = refParam(q);
      if ((COMPARISON_REFERENCE_KINDS as readonly string[]).includes(ref)) {
        const r = analysis.resolveReference(lapIds[0]!, ref as ComparisonReferenceKind);
        if (!r) throw new AnalysisError('noReference', `Não há referência "${ref}" para comparar.`);
        referenceLapId = r.id;
      } else {
        referenceLapId = ref;
      }
    }
    const count = queryInt(q, 'count', 'count', { min: 5, max: 200 });
    return analysis.getMicrosectors(lapIds, {
      ...(referenceLapId ? { referenceLapId } : {}),
      ...(count ? { count } : {}),
    });
  });

  app.get('/analysis/consistency', async (req): Promise<ApiConsistency> => {
    const q = req.query as Obj;
    const sessionId = queryString(q, 'sessionId');
    if (sessionId) {
      if (!isSafeId(sessionId)) throw badRequest('O parâmetro "sessionId" é inválido.');
      return analysis.getConsistency({ sessionId });
    }
    if (!queryString(q, 'laps')) throw badRequest('Informe "sessionId" ou "laps".');
    return analysis.getConsistency({ lapIds: lapList(q, 'laps', MAX_LAPS, 2) });
  });

  app.get('/analysis/evolution', async (req): Promise<ApiEvolution> => {
    const q = req.query as Obj;
    const carCode = queryInt(q, 'carCode', 'carCode');
    const maxDays = queryInt(q, 'maxDays', 'maxDays', { min: 1, max: 365 });
    return analysis.getEvolution(reqId(q, 'trackId', 'trackId'), {
      ...(carCode !== undefined ? { carCode } : {}),
      ...(maxDays !== undefined ? { maxDays } : {}),
    });
  });

  app.get('/analysis/chart.png', async (req, reply) => {
    const q = req.query as Obj;
    const corner = queryString(q, 'corner');
    if (corner !== undefined && corner.length > 60) throw badRequest('Curva inválida.');
    const width = queryInt(q, 'width', 'width', { min: 400, max: 2400 });
    const res = await buildComparisonChart(analysis, {
      lapId: reqId(q, 'lap', 'lap'),
      reference: refParam(q),
      ...(corner ? { cornerId: corner } : {}),
      ...(width ? { width } : {}),
    });
    return reply
      .type('image/png')
      .header('x-chart-caption', encodeURIComponent(res.caption.slice(0, 500)))
      .send(res.png);
  });

  // ---------------------------------------------------------------------- trace export

  app.get('/laps/:id/trace', async (req, reply): Promise<ApiLapTrace> => {
    const id = idParam(req.params, 'id');
    if (!store.getLap(id)) throw notFound('Volta não encontrada.');
    const trace: LapTrace | null = await store.loadTrace(id);
    if (!trace) throw notFound('Esta volta não tem trace gravado.', 'noTrace');
    const q = req.query as Obj;
    const wanted = queryString(q, 'channels')
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const all = Object.keys(trace.channels) as LapSampleChannel[];
    const keys = wanted ? all.filter((k) => wanted.includes(k)) : all;
    if (wanted && keys.length === 0) throw badRequest('Nenhum canal conhecido em "channels".');
    if (q.download === '1' || q.download === 'true') {
      reply.header('content-disposition', `attachment; filename="gt7-volta-${id}.json"`);
    }
    return {
      lapId: trace.lapId,
      sampleRateHz: trace.sampleRateHz,
      length: trace.length,
      channels: Object.fromEntries(keys.map((k) => [k, cleanArray(trace.channels[k])])),
    };
  });

  app.get('/laps/:id/export.csv', async (req, reply) => {
    const id = idParam(req.params, 'id');
    if (!store.getLap(id)) throw notFound('Volta não encontrada.');
    const stepM = queryNum(req.query as Obj, 'stepM', 'stepM', { min: 0.5, max: 50 }) ?? 1;
    const csv = await lapCsv(ctx, id, stepM);
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="gt7-volta-${id}.csv"`)
      .send(csv);
  });
}
