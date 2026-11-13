/**
 * GT7 MCP server: tools over the Gt7Store + AnalysisService (sessions, laps, comparisons per corner,
 * consistency, microsectors, traces, evolution, chart images, live state) and coaching prompts.
 *
 * Outputs are compact JSON text (units in the keys, rounded numbers, bounded sizes) plus Markdown
 * where it helps; raw 60 Hz arrays are never returned.
 */

import type { ChartChannel } from '@gt7/analysis';
import {
  AnalysisError,
  AnalysisService,
  findCorner,
  type Gt7Runtime,
  type Gt7Store,
  TaskError,
  TaskService,
} from '@gt7/core';
import {
  type CornerMetrics,
  drillSummary,
  type EngineerTask,
  type Lap,
  PRODUCT_NAME,
  PRODUCT_SLUG,
  suggestionText,
  type TaskWhere,
  TRACE_CHANNELS,
  weeklyToText,
} from '@gt7/shared';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { buildComparisonChart } from './chart.ts';
import {
  carFields,
  compactLap,
  compactSession,
  compactStats,
  dateTime,
  jsonText,
  lapTime,
  latestDrivingSession,
  r,
  roundDeep,
} from './format.ts';
import { registerKnowledge } from './knowledge.ts';
import { registerPrompts } from './prompts.ts';

export const MCP_SERVER_NAME = PRODUCT_SLUG;
export const MCP_SERVER_VERSION = '0.1.0';

export interface McpDeps {
  store: Gt7Store;
  /** Shared analysis service (default: runtime.analysis or a new one over `store`). */
  analysis?: AnalysisService;
  /** Live runtime (only in the app process / HTTP transport): enables get_live_state. */
  runtime?: Gt7Runtime | null;
  /** Engineer tasks (default: the runtime's, else one over `store`). */
  tasks?: TaskService;
  /** Who the proposals are credited to: an external agent (default) or the in-app coach. */
  taskSource?: 'agent' | 'coach';
}

const INSTRUCTIONS = `Servidor de telemetria do ${PRODUCT_NAME}. Integração disponível: Gran Turismo 7.
Fluxo típico: list_sessions → list_laps → compare_laps(lap_id, reference="auto") → \
get_corner_detail / render_comparison_chart nas curvas que mais custam; depois \
get_knowledge(car_code, diagnostics = os plan[].code) para a base de pilotagem da classe do carro.
Visões prontas: get_weekly_summary (a semana), get_session_summary (uma sessão), get_goal (meta da pista), \
get_sectors (setores e volta ideal) e list_corner_drills (treinos de uma curva).
Tarefas para o engenheiro de rádio: get_task_dictionary (o vocabulário), propose_engineer_task (propõe; o piloto aprova no app \
e só então o engenheiro fala no ponto da pista), list_engineer_tasks, update_engineer_task e withdraw_engineer_task.
Convenções: distâncias em metros ao longo da volta; delta e tempo perdido positivos = você mais lento; \
pares [você, referência]. Referências capturadas de replay têm precisão de alguns metros.
Use só os números retornados; diga quando um dado não existe.`;

const REFERENCE_DESC =
  "Referência: id de volta ou 'auto' (top de replay → melhor pessoal → melhor da sessão), " +
  "'bestReference', 'personalBest', 'sessionBest'. Padrão 'auto'.";

const CHART_CHANNELS = [
  'speedKmh',
  'throttle',
  'brake',
  'gear',
  'steering',
  'deltaS',
  'rpm',
  'latG',
  'lonG',
  'yawRate',
  'lateralOffsetM',
  'timeS',
] as const satisfies readonly ChartChannel[];

/** Digits used when returning a trace channel. */
const CHANNEL_DIGITS: Partial<Record<string, number>> = {
  timeS: 3,
  speedKmh: 1,
  throttle: 2,
  brake: 2,
  clutch: 2,
  gear: 0,
  rpm: 0,
  steering: 3,
  yawRate: 3,
  latG: 2,
  lonG: 2,
  deltaS: 3,
  lateralOffsetM: 2,
  x: 1,
  y: 1,
  z: 1,
  tcs: 0,
  asm: 0,
};

const ok = (...texts: string[]): CallToolResult => ({
  content: texts.map((text) => ({ type: 'text' as const, text })),
});

function errorResult(e: unknown): CallToolResult {
  const msg =
    e instanceof AnalysisError ? e.message : `Erro: ${e instanceof Error ? e.message : String(e)}`;
  return { isError: true, content: [{ type: 'text', text: msg }] };
}

async function safe(fn: () => Promise<CallToolResult> | CallToolResult): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (e) {
    return errorResult(e);
  }
}

function compactMetrics(m: CornerMetrics) {
  return {
    brakePoint_m: r(m.brakePointM),
    peakBrake_pct: r(m.peakBrake === null ? null : m.peakBrake * 100),
    timeToPeakBrake_s: r(m.timeToPeakBrakeS, 2),
    brakeRelease_m: r(m.brakeReleaseM),
    braking_s: r(m.brakingDurationS, 2),
    trail_s: r(m.trailBrakingS, 2),
    entry_kmh: r(m.entrySpeedKmh, 1),
    vmin_kmh: r(m.minSpeedKmh, 1),
    vminAt_m: r(m.minSpeedM),
    gear: m.gearAtApex,
    throttle_m: r(m.throttlePickupM),
    toFullThrottle_s: r(m.timeToFullThrottleS, 2),
    coast_s: r(m.coastingS, 2),
    exit_kmh: r(m.exitSpeedKmh, 1),
    line_m: m.lateralOffsetM
      ? [r(m.lateralOffsetM.entry, 1), r(m.lateralOffsetM.apex, 1), r(m.lateralOffsetM.exit, 1)]
      : null,
    corrections: m.steeringCorrections,
    tcs_s: r(m.tcsActiveS, 2),
    lock_s: r(m.frontLockS, 2),
    rearSlipPeak: r(m.rearSlipPeak, 2),
    corner_s: r(m.timeInCornerS, 2),
  };
}

/** Creates the MCP server with every tool, resource and prompt registered. */
export function createGt7McpServer(deps: McpDeps): McpServer {
  const { store } = deps;
  const runtime = deps.runtime ?? null;
  const tasks = deps.tasks ?? runtime?.tasks ?? new TaskService(store);
  const taskSource = deps.taskSource ?? 'agent';
  const analysis = deps.analysis ?? runtime?.analysis ?? new AnalysisService({ store });
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  const RO = { readOnlyHint: true, openWorldHint: false } as const;
  const trackName = (id: string | null) => (id ? (store.getTrack(id)?.name ?? id) : null);

  // ------------------------------------------------------------------------------------------
  server.registerTool(
    'list_tracks',
    {
      title: 'Pistas',
      description:
        'Lista as pistas conhecidas (identificadas pela geometria): id, nome, comprimento, nº de ' +
        'curvas, sessões, voltas, referências e melhor volta.',
      inputSchema: {},
      annotations: RO,
    },
    async () =>
      safe(() => {
        const tracks = store.listTracks().map((t) => {
          const laps = store.listLapsForTrack(t.id);
          const best = laps.filter((l) => l.valid)[0] ?? null;
          return {
            id: t.id,
            name: t.name,
            length_m: r(t.lengthM),
            corners: t.corners.length,
            sessions: new Set(laps.map((l) => l.sessionId)).size,
            laps: laps.length,
            references: laps.filter((l) => l.isReference).length,
            best: lapTime(best?.timeMs),
            bestLapId: best?.id ?? null,
          };
        });
        return ok(jsonText({ tracks }));
      }),
  );

  server.registerTool(
    'get_track',
    {
      title: 'Detalhes da pista',
      description:
        'Curvas da pista (id T1…, nome, tipo, direção, entrada/ápice/saída em m), setores, recordes ' +
        'por carro e voltas de referência. Detecta as curvas se ainda não existirem.',
      inputSchema: { track_id: z.string().describe('Id da pista (list_tracks).') },
      annotations: RO,
    },
    async ({ track_id }) =>
      safe(async () => {
        const ta = await analysis.getTrackAnalysis(track_id, { maxMapPoints: 50 });
        return ok(
          jsonText({
            id: ta.track.id,
            name: ta.track.name,
            length_m: r(ta.map?.lengthM ?? ta.track.lengthM),
            sessions: ta.sessionCount,
            laps: ta.lapCount,
            corners: ta.corners.map((c) => ({
              id: c.id,
              ...(c.name ? { name: c.name } : {}),
              kind: c.kind ?? null,
              dir: c.direction,
              entry_m: r(c.entryM),
              apex_m: r(c.apexM),
              exit_m: r(c.exitM),
              ...(c.brakeMarkerNote ? { marker: c.brakeMarkerNote } : {}),
            })),
            sectors: ta.sectors.map((s) => [r(s.fromM), r(s.toM)]),
            records: {
              overallBest: lapTime(ta.records.overallBestMs),
              overallBestLapId: ta.records.overallBestLapId,
              cars: ta.records.cars.map((c) => ({
                ...carFields(c.carCode),
                laps: c.laps,
                valid: c.validLaps,
                pb: lapTime(c.personalBestMs),
                pbLapId: c.personalBestLapId,
              })),
              references: ta.records.references.map((x) => ({
                lapId: x.lapId,
                driver: x.driverName,
                time: lapTime(x.timeMs),
                ...carFields(x.carCode),
              })),
            },
          }),
        );
      }),
  );

  server.registerTool(
    'list_sessions',
    {
      title: 'Sessões',
      description:
        'Lista sessões (mais recentes primeiro): data, pista, carro, modo (live/replayCapture), nº de ' +
        'voltas e melhor tempo. Filtros opcionais por pista e carro.',
      inputSchema: {
        track_id: z.string().optional().describe('Filtra por pista.'),
        car_code: z.number().int().optional().describe('Filtra por código do carro.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe('Máximo de sessões (padrão 20).'),
      },
      annotations: RO,
    },
    async ({ track_id, car_code, limit }) =>
      safe(() => {
        const sessions = store.listSessions({
          ...(track_id ? { trackId: track_id } : {}),
          ...(car_code !== undefined ? { carCode: car_code } : {}),
          limit,
        });
        return ok(
          jsonText({
            sessions: sessions.map((s) =>
              compactSession(s, s.trackId ? store.getTrack(s.trackId) : null),
            ),
          }),
        );
      }),
  );

  server.registerTool(
    'list_laps',
    {
      title: 'Voltas',
      description:
        'Voltas de uma sessão (ordem da volta) ou de uma pista (mais rápidas primeiro): tempo, ' +
        'setores (ms), válida, flags (offTrack, replay…), se é referência. Sem filtros: sessão mais recente.',
      inputSchema: {
        session_id: z.string().optional().describe('Id da sessão.'),
        track_id: z.string().optional().describe('Id da pista (todas as sessões).'),
        car_code: z.number().int().optional().describe('Só com track_id: filtra o carro.'),
        valid_only: z.boolean().default(false).describe('Só voltas válidas.'),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: RO,
    },
    async ({ session_id, track_id, car_code, valid_only, limit }) =>
      safe(() => {
        let laps: Lap[];
        let scope: Record<string, unknown>;
        if (track_id && !session_id) {
          laps = store.listLapsForTrack(track_id, {
            ...(car_code !== undefined ? { carCode: car_code } : {}),
            validOnly: valid_only,
            limit,
          });
          scope = { track: { id: track_id, name: trackName(track_id) }, order: 'time' };
        } else {
          const sid = session_id ?? latestDrivingSession(store)?.id;
          if (!sid) return ok('Nenhuma sessão com voltas encontrada.');
          const s = store.getSession(sid);
          if (!s) throw new AnalysisError('notFound', `Sessão ${sid} não encontrada.`);
          laps = store
            .listLaps(sid)
            .filter((l) => !valid_only || l.valid)
            .slice(0, limit);
          const best = laps.filter((l) => l.valid).sort((a, b) => a.timeMs - b.timeMs)[0];
          scope = {
            session: compactSession(s, s.trackId ? store.getTrack(s.trackId) : null),
            bestLapId: best?.id ?? null,
          };
        }
        return ok(
          jsonText({ ...scope, laps: laps.map((l) => compactLap(l, { session: !!track_id })) }),
        );
      }),
  );

  server.registerTool(
    'list_reference_laps',
    {
      title: 'Voltas de referência',
      description:
        'Voltas de referência (top do ranking capturadas de replay ou importadas): piloto, carro, ' +
        'tempo, tempo do ranking, pista.',
      inputSchema: { track_id: z.string().optional().describe('Filtra por pista.') },
      annotations: RO,
    },
    async ({ track_id }) =>
      safe(() => {
        const refs = store.listReferenceLaps(track_id);
        return ok(
          jsonText({
            references: refs.map((l) => ({
              id: l.id,
              track: { id: l.trackId, name: trackName(l.trackId) },
              driver: l.referenceMeta?.driverName ?? null,
              carName: l.referenceMeta?.carName ?? null,
              ...carFields(l.carCode),
              time: lapTime(l.timeMs),
              rankingTime: lapTime(l.referenceMeta?.rankingTimeMs),
              source: l.referenceMeta?.source ?? null,
              replay: l.flags.includes('replay'),
            })),
          }),
        );
      }),
  );

  server.registerTool(
    'get_lap_summary',
    {
      title: 'Resumo da volta',
      description:
        'Resumo de uma volta: tempo, setores, validade (problemas detectados), métricas por curva ' +
        '(frenagem m, pico de freio %, trail braking s, V-mín km/h, marcha, acelerador m, roda livre s, saída km/h) ' +
        'e eventos de pilotagem detectados (saída de frente, saída de traseira, travamento dianteiro, ' +
        'perda de tração na saída) com curva, trecho, confiança e ação. Confiança média/baixa = provável.',
      inputSchema: { lap_id: z.string().describe('Id da volta.') },
      annotations: RO,
    },
    async ({ lap_id }) =>
      safe(async () => {
        const la = await analysis.getLapAnalysis(lap_id);
        const events = await analysis.getLapDrivingEvents(lap_id).catch(() => null);
        return ok(
          jsonText({
            lap: compactLap(la.lap, { session: true }),
            track: { id: la.track.id, name: la.track.name },
            issues: la.validity.issues.slice(0, 5).map((i) => i.message),
            summary: la.summary,
            drivingEvents:
              events?.events.map((e) => ({
                kind: e.kind,
                corner: e.cornerId,
                phase: e.phase,
                from_m: Math.round(e.startM),
                to_m: Math.round(e.endM),
                duration_s: e.durationS,
                confidence: e.confidence,
                message: e.message,
                action: e.action,
                evidence: Object.fromEntries(
                  Object.entries(e.evidence).filter(([, v]) => v !== null),
                ),
              })) ?? null,
          }),
        );
      }),
  );

  server.registerTool(
    'compare_laps',
    {
      title: 'Comparar voltas (principal)',
      description:
        'Ferramenta principal de coaching: compara sua volta com uma referência curva a curva. ' +
        'Retorna tempo perdido por curva e setor, pares [você, referência] de frenagem/V-mín/' +
        'acelerador/saída/roda livre/trail, diagnósticos ranqueados por custo e UMA ação por curva ' +
        '(plan), além de um relatório Markdown.',
      inputSchema: {
        lap_id: z.string().describe('Sua volta (sujeito).'),
        reference: z.string().default('auto').describe(REFERENCE_DESC),
        markdown: z.boolean().default(true).describe('Incluir o relatório Markdown (padrão sim).'),
      },
      annotations: RO,
    },
    async ({ lap_id, reference, markdown }) =>
      safe(async () => {
        const res = await analysis.compareLaps(lap_id, reference);
        const c = res.comparison;
        const json = {
          referenceKind: res.referenceKind,
          reference: {
            id: res.referenceLap.id,
            time: lapTime(res.referenceLap.timeMs),
            driver: res.referenceLap.referenceMeta?.driverName ?? null,
            ...carFields(res.referenceLap.carCode),
          },
          you: { id: res.lap.id, time: lapTime(res.lap.timeMs), ...carFields(res.lap.carCode) },
          ...res.summary,
          phases: c.topLosses.map((row) => ({
            c: row.corner.id,
            ...(row.phaseLoss
              ? {
                  braking_s: r(row.phaseLoss.brakingMs / 1000, 2),
                  mid_s: r(row.phaseLoss.midMs / 1000, 2),
                  exit_s: r(row.phaseLoss.exitMs / 1000, 2),
                  nextStraight_s: r(row.phaseLoss.followingStraightMs / 1000, 2),
                }
              : {}),
          })),
          plan: (c.keyFindings ?? []).map((f) => ({
            c: f.cornerId ?? null,
            code: f.kind,
            cost_s: r((f.costMs ?? 0) / 1000, 2),
            conf: f.confidence ?? null,
            action: f.action ?? f.kind,
          })),
        };
        return markdown ? ok(jsonText(json), res.markdown) : ok(jsonText(json));
      }),
  );

  server.registerTool(
    'get_corner_detail',
    {
      title: 'Detalhe de uma curva',
      description:
        'Olhar de perto UMA curva em 1–6 voltas: métricas completas por volta (a 1ª volta é a base), ' +
        'tempo ganho/perdido na janela da curva vs a 1ª volta e traces reamostrados (padrão a cada 5 m) ' +
        'de velocidade, acelerador/freio (%), marcha, volante, desvio lateral e delta, da zona de ' +
        'frenagem até 50 m após a saída.',
      inputSchema: {
        corner: z.string().describe('Id da curva (T1…) ou nome dado pelo piloto.'),
        lap_ids: z.array(z.string()).min(1).max(6).describe('Voltas; a 1ª é a base do delta.'),
        step_m: z.number().min(2).max(50).default(5).describe('Passo dos traces em metros (≥ 2).'),
        traces: z.boolean().default(true).describe('Incluir traces (padrão sim).'),
      },
      annotations: RO,
    },
    async ({ corner, lap_ids, step_m, traces }) =>
      safe(async () => {
        const first = analysis.getLapOrThrow(lap_ids[0]!);
        if (!first.trackId) throw new AnalysisError('noTrack', 'Volta sem pista identificada.');
        const corners = await analysis.getCorners(first.trackId);
        const c = findCorner(corners, corner);
        if (!c) {
          throw new AnalysisError(
            'notFound',
            `Curva "${corner}" não encontrada. Curvas: ${corners.map((k) => k.id + (k.name ? ` (${k.name})` : '')).join(', ')}`,
          );
        }
        const idx = corners.indexOf(c);
        const analyses = await Promise.all(lap_ids.map((id) => analysis.getLapAnalysis(id)));
        const span = c.exitM + 50 - (c.entryM - 200);
        const maxPoints = Math.min(160, Math.ceil(span / step_m) + 1);
        const chart = await analysis.getChartData(lap_ids, {
          cornerId: c.id,
          channels: traces
            ? ['speedKmh', 'throttle', 'brake', 'gear', 'steering', 'lateralOffsetM', 'deltaS']
            : ['deltaS'],
          maxPoints,
          referenceIndex: 0,
        });
        const deltaOf = (lapId: string) => {
          const s = chart.series.find((x) => x.lapId === lapId && x.channel === 'deltaS');
          const vals = (s?.values ?? []).filter((v): v is number => v !== null);
          return vals.length ? r(vals.at(-1)! - vals[0]!, 3) : null;
        };
        const laps = analyses.map((la) => ({
          lapId: la.lap.id,
          time: lapTime(la.lap.timeMs),
          ...(la.lap.isReference ? { reference: la.lap.referenceMeta?.driverName ?? true } : {}),
          windowDelta_s: la.lap.id === lap_ids[0] ? 0 : deltaOf(la.lap.id),
          metrics: compactMetrics(la.metrics[idx]!),
        }));
        const out: Record<string, unknown> = {
          corner: {
            id: c.id,
            ...(c.name ? { name: c.name } : {}),
            kind: c.kind ?? null,
            dir: c.direction,
            entry_m: r(c.entryM),
            apex_m: r(c.apexM),
            exit_m: r(c.exitM),
          },
          base: lap_ids[0],
          laps,
        };
        if (traces) {
          const byLap: Record<string, Record<string, (number | null)[]>> = {};
          for (const s of chart.series) {
            byLap[s.lapId] ??= {};
            byLap[s.lapId]![s.channel] = s.values;
          }
          out.traces = {
            units:
              'speedKmh km/h, throttle/brake %, steering rad, lateralOffsetM m (+ = esquerda), deltaS s vs base',
            step_m: chart.stepM,
            distance_m: chart.distanceM,
            laps: byLap,
          };
        }
        return ok(jsonText(out));
      }),
  );

  server.registerTool(
    'get_consistency',
    {
      title: 'Consistência',
      description:
        'Variação entre voltas: estatística do tempo de volta e, por curva, média/desvio-padrão do ' +
        'ponto de frenagem, V-mín, retomada, saída e tempo na zona; destaques em frase pronta. ' +
        'Use session_id (voltas válidas) ou lap_ids (≥ 2).',
      inputSchema: {
        session_id: z.string().optional(),
        lap_ids: z.array(z.string()).min(2).max(40).optional(),
      },
      annotations: RO,
    },
    async ({ session_id, lap_ids }) =>
      safe(async () => {
        const target = lap_ids?.length
          ? { lapIds: lap_ids }
          : session_id
            ? { sessionId: session_id }
            : null;
        if (!target) {
          throw new AnalysisError('invalidArgument', 'Informe session_id ou lap_ids.');
        }
        const rep = await analysis.getConsistency(target);
        const pair = (s: { mean: number; stdDev: number } | undefined, d = 1) =>
          s ? [r(s.mean, d), r(s.stdDev, d + 1)] : null;
        return ok(
          jsonText({
            sessionId: rep.sessionId,
            lapIds: rep.lapIds,
            lapTime_s: compactStats(
              {
                ...rep.lapTime,
                mean: rep.lapTime.mean / 1000,
                stdDev: rep.lapTime.stdDev / 1000,
                min: rep.lapTime.min / 1000,
                max: rep.lapTime.max / 1000,
              },
              3,
            ),
            highlights: rep.highlights.map((h) => h.message ?? `${h.cornerId} ${h.metric}`),
            corners_meanSd: rep.corners.map((c) => ({
              id: c.cornerId,
              brakePoint_m: pair(c.metrics.brakePointM, 0),
              vmin_kmh: pair(c.metrics.minSpeedKmh),
              throttle_m: pair(c.metrics.throttlePickupM, 0),
              exit_kmh: pair(c.metrics.exitSpeedKmh),
              zone_s: pair(c.metrics.timeDeltaS, 2),
            })),
          }),
        );
      }),
  );

  server.registerTool(
    'get_microsectors',
    {
      title: 'Microssetores e volta teórica',
      description:
        'Divide a volta em microssetores (padrão 25): tempos por volta vs referência, melhor de cada ' +
        'microssetor e volta teórica (soma dos melhores microssetores e dos melhores setores).',
      inputSchema: {
        lap_ids: z.array(z.string()).min(1).max(20).optional().describe('Voltas (mesma pista).'),
        session_id: z.string().optional().describe('Alternativa: voltas válidas da sessão.'),
        reference_lap_id: z
          .string()
          .optional()
          .describe('Base das diferenças (padrão: a melhor do conjunto).'),
        count: z.number().int().min(5).max(60).default(25),
      },
      annotations: RO,
    },
    async ({ lap_ids, session_id, reference_lap_id, count }) =>
      safe(async () => {
        let ids = lap_ids ?? [];
        if (!ids.length && session_id) {
          const laps = store.listLaps(session_id);
          const valid = laps.filter((l) => l.valid && l.trackId);
          ids = (valid.length ? valid : laps.filter((l) => l.trackId))
            .slice(0, 20)
            .map((l) => l.id);
        }
        if (!ids.length)
          throw new AnalysisError('invalidArgument', 'Informe lap_ids ou session_id.');
        const ms = await analysis.getMicrosectors(ids, {
          ...(reference_lap_id ? { referenceLapId: reference_lap_id } : {}),
          count,
        });
        const rep = ms.report;
        const ref = rep.laps.find((l) => l.lapId === ms.referenceLapId)!;
        const lapIndex = new Map(rep.laps.map((l, i) => [l.lapId, i]));
        return ok(
          jsonText({
            count: rep.count,
            length_m: r(rep.lengthM),
            boundaries_m: rep.boundariesM.map((b) => r(b)),
            referenceLapId: ms.referenceLapId,
            bestLap: { id: rep.bestLapId, time: lapTime(rep.bestLapMs) },
            theoreticalBest: lapTime(rep.theoreticalBestMs),
            theoreticalBestSectors: lapTime(rep.theoreticalBestSectorsMs),
            gainAvailable_s: r((rep.bestLapMs - rep.theoreticalBestMs) / 1000, 3),
            bestSectors_ms: rep.bestSectorMs.map((v) => r(v)),
            lapIds: rep.laps.map((l) => l.lapId),
            bestMicroLapIndex: rep.bestMicroLapIds.map((id) => lapIndex.get(id) ?? null),
            laps: rep.laps.map((l) => ({
              id: l.lapId,
              time: lapTime(l.lapTimeMs),
              sectors_ms: l.sectorMs.map((v) => r(v)),
              ...(l.lapId === ms.referenceLapId
                ? {}
                : { microDeltaVsRef_ms: l.microMs.map((v, i) => r(v - ref.microMs[i]!)) }),
            })),
          }),
        );
      }),
  );

  server.registerTool(
    'get_trace',
    {
      title: 'Trace reamostrado',
      description:
        'Dados de uma volta reamostrados por distância (nunca 60 Hz crus): canais escolhidos entre ' +
        `${TRACE_CHANNELS.join(', ')}; pedais 0–1. Passo ≥ 2 m, máximo de pontos limitado (≤ 500).`,
      inputSchema: {
        lap_id: z.string(),
        channels: z
          .array(z.enum(TRACE_CHANNELS as unknown as [string, ...string[]]))
          .min(1)
          .max(8)
          .default(['speedKmh', 'throttle', 'brake', 'gear']),
        from_m: z.number().min(0).optional(),
        to_m: z.number().min(0).optional(),
        step_m: z.number().min(2).max(200).default(5),
        max_points: z.number().int().min(10).max(500).default(300),
        reference: z.string().default('auto').describe(`Só para o canal deltaS. ${REFERENCE_DESC}`),
      },
      annotations: RO,
    },
    async ({ lap_id, channels, from_m, to_m, step_m, max_points, reference }) =>
      safe(async () => {
        const tr = await analysis.getResampledTrace(lap_id, {
          stepM: step_m,
          maxPoints: max_points,
          channels: channels as (typeof TRACE_CHANNELS)[number][],
          ...(from_m !== undefined ? { fromM: from_m } : {}),
          ...(to_m !== undefined ? { toM: to_m } : {}),
          reference,
        });
        const cols: Record<string, (number | null)[]> = {};
        for (const [ch, vals] of Object.entries(tr.channels)) {
          cols[ch] = (vals ?? []).map((v) => r(v, CHANNEL_DIGITS[ch] ?? 2));
        }
        return ok(
          jsonText({
            lapId: tr.lapId,
            from_m: r(tr.fromM, 1),
            to_m: r(tr.toM, 1),
            step_m: r(tr.stepM, 2),
            points: tr.distanceM.length,
            distance_m: tr.distanceM.map((d) => r(d, 1)),
            ...cols,
          }),
        );
      }),
  );

  server.registerTool(
    'get_evolution',
    {
      title: 'Histórico de evolução',
      description:
        'Evolução por dia numa pista (suas voltas, um carro): melhor volta, média das 3 melhores, ' +
        'desvio-padrão, gap para a base (referência do top, senão melhor pessoal) e, por curva, tempo ' +
        'perdido e diferenças de frenagem/V-mín/saída/acelerador vs a base; tendências em frases.',
      inputSchema: {
        track_id: z.string(),
        car_code: z.number().int().optional().describe('Padrão: carro mais usado na pista.'),
        max_days: z.number().int().min(1).max(60).default(14),
      },
      annotations: RO,
    },
    async ({ track_id, car_code, max_days }) =>
      safe(async () => {
        const ev = await analysis.getEvolution(track_id, {
          ...(car_code !== undefined ? { carCode: car_code } : {}),
          maxDays: max_days,
        });
        const cornerIds =
          ev.days.find((d) => d.corners.length)?.corners.map((c) => c.cornerId) ?? [];
        const col = (
          d: (typeof ev.days)[number],
          k:
            | 'timeLostMs'
            | 'brakePointDiffM'
            | 'minSpeedDiffKmh'
            | 'exitSpeedDiffKmh'
            | 'throttlePickupDiffM',
          digits = 0,
        ) =>
          cornerIds.map((id) => r(d.corners.find((c) => c.cornerId === id)?.[k] ?? null, digits));
        return ok(
          jsonText({
            trackId: ev.trackId,
            ...(ev.carCode === null ? { car: null } : carFields(ev.carCode)),
            baseline: ev.baseline
              ? {
                  kind: ev.baseline.kind,
                  lapId: ev.baseline.lapId,
                  time: lapTime(ev.baseline.timeMs),
                }
              : null,
            cornerIds,
            note: 'arrays por curva na ordem de cornerIds; diffs = você − base',
            days: ev.days.map((d) => ({
              date: d.date,
              sessions: d.sessions,
              laps: d.laps,
              valid: d.validLaps,
              best: lapTime(d.bestLapMs),
              bestLapId: d.bestLapId,
              top3: lapTime(d.top3MeanMs),
              sd_ms: d.lapTimeStdDevMs,
              gap_s: r(d.gapToBaselineMs === null ? null : d.gapToBaselineMs / 1000, 3),
              lost_ms: col(d, 'timeLostMs'),
              brakeDiff_m: col(d, 'brakePointDiffM'),
              vminDiff_kmh: col(d, 'minSpeedDiffKmh', 1),
              exitDiff_kmh: col(d, 'exitSpeedDiffKmh', 1),
              throttleDiff_m: col(d, 'throttlePickupDiffM'),
            })),
            trends: ev.trends.map((t) => t.message),
          }),
        );
      }),
  );

  server.registerTool(
    'render_comparison_chart',
    {
      title: 'Gráfico de comparação (imagem)',
      description:
        'Imagem PNG para você "ver" a comparação: velocidade, acelerador, freio, marcha, volante e ' +
        'delta por distância (você laranja × referência verde-água) e o mapa da pista colorido por ' +
        'onde se perde (vermelho) ou ganha (azul) tempo. Com corner: zoom na curva com os dois traçados ' +
        'e os pontos de frenagem.',
      inputSchema: {
        lap_id: z.string(),
        reference: z.string().default('auto').describe(REFERENCE_DESC),
        corner: z.string().optional().describe('Id/nome da curva para zoom (opcional).'),
        channels: z
          .array(z.enum(CHART_CHANNELS))
          .min(1)
          .max(7)
          .optional()
          .describe('Painéis (padrão: speedKmh, throttle, brake, gear, steering, deltaS).'),
      },
      annotations: RO,
    },
    async ({ lap_id, reference, corner, channels }) =>
      safe(async () => {
        const res = await buildComparisonChart(analysis, {
          lapId: lap_id,
          reference,
          ...(corner ? { cornerId: corner } : {}),
          ...(channels ? { channels: [...channels] } : {}),
        });
        return {
          content: [
            { type: 'image', data: res.png.toString('base64'), mimeType: 'image/png' },
            { type: 'text', text: res.caption },
          ],
        };
      }),
  );

  server.registerTool(
    'get_goal',
    {
      title: 'Meta de tempo da pista',
      description:
        'Meta de tempo do piloto numa pista (e carro): o tempo alvo, a melhor volta, quanto falta, as metas ' +
        'já batidas e a meta sugerida (volta ideal ou 0,5% abaixo da melhor). Use para "estou perto da minha meta?".',
      inputSchema: {
        track_id: z.string(),
        car_code: z.number().int().optional().describe('Padrão: meta para qualquer carro.'),
      },
      annotations: RO,
    },
    async ({ track_id, car_code }) =>
      safe(async () => {
        const g = await analysis.getTrackGoal(track_id, car_code ?? null);
        const remaining =
          g.active && g.bestLapMs !== null ? Math.max(0, g.bestLapMs - g.active.targetMs) : null;
        return ok(
          jsonText({
            track: trackName(track_id),
            trackId: track_id,
            goal: g.active
              ? {
                  target: lapTime(g.active.targetMs),
                  targetMs: g.active.targetMs,
                  ...(g.active.carCode !== null ? { car: g.active.carCode } : { car: 'qualquer' }),
                  setAt: dateTime(g.active.createdAt),
                  reached: remaining === 0,
                  remaining_s: r(remaining === null ? null : remaining / 1000, 3),
                  startedFrom: lapTime(g.baselineMs),
                }
              : null,
            bestLap: lapTime(g.bestLapMs),
            reached: g.history.slice(0, 10).map((h) => ({
              target: lapTime(h.targetMs),
              reachedAt: h.achievedAt === null ? null : dateTime(h.achievedAt),
              car: h.carCode ?? 'qualquer',
            })),
            suggestion: g.suggestion
              ? {
                  target: lapTime(g.suggestion.targetMs),
                  basis:
                    g.suggestion.basis === 'idealLap' ? 'volta ideal' : '0,5% abaixo da melhor',
                  idealLap: lapTime(g.suggestion.idealLapMs),
                }
              : null,
          }),
        );
      }),
  );

  server.registerTool(
    'get_session_summary',
    {
      title: 'Resumo da sessão',
      description:
        'Resumo pronto de uma sessão: melhor volta contra o recorde anterior, ritmo (média das 5 melhores, ' +
        'mediana), regularidade e tendência, comparação com a última sessão / a melhor / a meta, curvas onde ' +
        'ganhou e perdeu e até 3 dicas. Padrão: a sessão de pilotagem mais recente.',
      inputSchema: {
        session_id: z.string().optional().describe('Padrão: a sessão mais recente com voltas.'),
      },
      annotations: RO,
    },
    async ({ session_id }) =>
      safe(async () => {
        const id = session_id ?? latestDrivingSession(store)?.id;
        if (!id) return ok('Ainda não há sessões com voltas gravadas.');
        const sum = await analysis.getSessionSummary(id);
        const best = sum.best;
        return ok(
          jsonText({
            sessionId: id,
            track: trackName(sum.trackId),
            ...carFields(sum.carCode),
            startedAt: dateTime(sum.startedAt),
            laps: sum.laps,
            bestLap: best
              ? {
                  time: lapTime(best.timeMs),
                  vsPreviousRecord_s: r(best.deltaMs === null ? null : best.deltaMs / 1000, 3),
                  firstTime: best.firstTime,
                }
              : null,
            pace: sum.pace
              ? {
                  top5Avg: lapTime(sum.pace.top5AvgMs),
                  median: lapTime(sum.pace.medianMs),
                  spread_s: r(sum.pace.spreadMs / 1000, 3),
                }
              : null,
            consistency: sum.consistency
              ? { stdDev_s: r(sum.consistency.stdDevMs / 1000, 3), trend: sum.consistency.trend }
              : null,
            comparisons: Object.fromEntries(
              Object.entries(sum.comparisons)
                .filter(([, c]) => c)
                .map(([k, c]) => [
                  k,
                  {
                    baseline: lapTime(c!.baselineMs),
                    bestDelta_s: r(c!.bestDeltaMs / 1000, 3),
                    paceDelta_s: r(c!.paceDeltaMs === null ? null : c!.paceDeltaMs / 1000, 3),
                  },
                ]),
            ),
            gained: sum.corners?.gains.map((c) => ({
              corner: c.name ?? c.cornerId,
              delta_ms: c.deltaMs,
            })),
            lost: sum.corners?.losses.map((c) => ({
              corner: c.name ?? c.cornerId,
              delta_ms: c.deltaMs,
            })),
            tips: sum.suggestions.map((t) => suggestionText(t)),
            note: 'deltas negativos = mais rápido que a base',
          }),
        );
      }),
  );

  server.registerTool(
    'get_sectors',
    {
      title: 'Setores e volta ideal',
      description:
        'Melhor tempo de cada setor da pista (e a volta que o fez), média dos 5 melhores, quanto a melhor ' +
        'volta deixa para trás em cada setor e a volta ideal (soma dos melhores setores).',
      inputSchema: {
        track_id: z.string(),
        car_code: z.number().int().optional().describe('Padrão: todos os carros.'),
      },
      annotations: RO,
    },
    async ({ track_id, car_code }) =>
      safe(async () => {
        const res = await analysis.getTrackSectors(
          track_id,
          car_code !== undefined ? { carCode: car_code } : {},
        );
        const t = res.table;
        return ok(
          jsonText({
            track: trackName(track_id),
            ...(res.carCode === null ? {} : carFields(res.carCode)),
            laps: t.lapCount,
            bestLap: lapTime(t.bestLapMs),
            idealLap: lapTime(t.idealLapMs),
            gain_s: r(t.gainMs / 1000, 3),
            sectors: t.rows.map((row) => ({
              sector: row.index + 1,
              from_m: r(row.fromM),
              to_m: r(row.toM),
              best: lapTime(row.bestMs),
              bestLapId: row.bestLapId,
              top5Avg: lapTime(row.avgTopMs),
              bestLapLoses_ms: r(row.bestLapLossMs),
            })),
            note: 'a volta ideal é um teto, não uma promessa',
          }),
        );
      }),
  );

  server.registerTool(
    'list_corner_drills',
    {
      title: 'Treinos de curva',
      description:
        'Treinos de uma curva já feitos (o piloto escolheu a curva e passou várias vezes): por treino, a curva, ' +
        'a data, o número de passagens, o melhor tempo do trecho, o primeiro e o último e quanto melhorou. ' +
        'Sem corner_id lista os treinos recentes de todas as curvas da pista.',
      inputSchema: {
        track_id: z.string(),
        corner_id: z.string().optional().describe('Ex.: T7.'),
        limit: z.number().int().min(1).max(30).default(10),
      },
      annotations: RO,
    },
    async ({ track_id, corner_id, limit }) =>
      safe(() => {
        const drills = corner_id
          ? store.listDrillsForCorner(track_id, corner_id, limit)
          : store
              .listSessions({ trackId: track_id, limit: 30 })
              .flatMap((s) => store.listDrills(s.id))
              .sort((a, b) => b.startedAt - a.startedAt)
              .slice(0, limit);
        const corners = new Map(
          (store.getTrack(track_id)?.corners ?? []).map((c) => [c.id, c.name]),
        );
        return ok(
          jsonText({
            track: trackName(track_id),
            drills: drills.flatMap((d) => {
              const sum = drillSummary(d.passes);
              if (!sum) return [];
              return [
                {
                  corner: d.cornerId,
                  name: corners.get(d.cornerId) ?? null,
                  date: dateTime(d.startedAt),
                  passes: sum.count,
                  best_s: r(sum.bestMs / 1000, 3),
                  first_s: r(sum.firstMs / 1000, 3),
                  last_s: r(sum.lastMs / 1000, 3),
                  average_s: r(sum.averageMs / 1000, 3),
                  improvement_s: r(sum.improvementMs / 1000, 3),
                  target_s: r(d.targetMs === null ? null : d.targetMs / 1000, 3),
                },
              ];
            }),
          }),
        );
      }),
  );

  server.registerTool(
    'get_weekly_summary',
    {
      title: 'Resumo da semana',
      description:
        'O que o piloto fez em 7 dias: sessões, voltas, tempo na pista, e por pista (e carro) a melhor volta, ' +
        'quanto mudou contra o recorde anterior, recordes pessoais e metas batidas. weeks_ago 0 = os últimos ' +
        '7 dias, 1 = os 7 dias antes deles. Traz também o texto pronto para compartilhar.',
      inputSchema: {
        weeks_ago: z.number().int().min(0).max(520).default(0),
      },
      annotations: RO,
    },
    async ({ weeks_ago }) =>
      safe(() => {
        const w = analysis.getWeeklySummary(weeks_ago);
        const text = weeklyToText(w, {
          lapTime: (ms) => lapTime(ms) ?? '',
          delta: (ms) =>
            `${ms < 0 ? '−' : '+'}${(Math.abs(ms) / 1000).toFixed(3).replace('.', ',')}`,
          date: (ms) => dateTime(ms).slice(5, 10).split('-').reverse().join('/'),
        });
        return ok(
          jsonText({
            from: dateTime(w.fromMs),
            to: dateTime(w.toMs),
            sessions: w.sessions,
            laps: w.laps,
            validLaps: w.validLaps,
            timeOnTrack_min: Math.round(w.drivingMs / 60_000),
            personalRecords: w.records,
            tracks: w.tracks.map((t) => ({
              track: t.trackName,
              trackId: t.trackId,
              ...carFields(t.carCode),
              sessions: t.sessions,
              laps: t.laps,
              validLaps: t.validLaps,
              best: lapTime(t.bestMs),
              previousBest: lapTime(t.previousBestMs),
              vsPrevious_s: r(t.deltaMs === null ? null : t.deltaMs / 1000, 3),
              record: t.isRecord,
              firstTime: t.firstTime,
              goal: t.goal
                ? {
                    target: lapTime(t.goal.targetMs),
                    reached: t.goal.reached,
                    remaining_s: r(t.goal.remainingMs / 1000, 3),
                  }
                : null,
            })),
            goalsReached: w.goalsReached.map((g) => ({
              track: g.trackName,
              target: lapTime(g.targetMs),
              at: dateTime(g.achievedAt),
            })),
            shareableText: text,
            note: 'vsPrevious negativo = mais rápido que o recorde anterior',
          }),
        );
      }),
  );

  // ------------------------------------------------------------------------------------------
  // Engineer tasks (spec 20): the agent proposes, the driver approves in the app.
  // ------------------------------------------------------------------------------------------
  const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
  const whereSchema = z
    .object({
      corner: z.number().int().min(1).max(20).optional().describe('Curva (1-20): T7 = 7.'),
      phase: z.enum(['entry', 'apex', 'exit']).optional().describe('Só com corner.'),
      between: z
        .tuple([z.number().int().min(1).max(20), z.number().int().min(1).max(20)])
        .optional()
        .describe('Reta entre duas curvas: [de, até].'),
      before: z.number().int().min(1).max(20).optional().describe('Antes da curva n.'),
      after: z.number().int().min(1).max(20).optional().describe('Depois da curva n.'),
      sector: z.number().int().min(1).max(6).optional(),
      straight: z
        .enum(['start', 'finish'])
        .optional()
        .describe('Reta dos boxes ou linha de chegada.'),
      global: z
        .enum(['slowCorners', 'fastCorners', 'hardBraking', 'allCorners', 'allStraights'])
        .optional(),
      atM: z
        .number()
        .min(0)
        .max(30000)
        .optional()
        .describe('Posição na volta, em metros (vira curva/fase ou "entre duas curvas").'),
    })
    .describe(
      'Onde a tarefa vale: informe UMA forma (corner [+phase], between, before, after, sector, straight, global ou atM).',
    );
  const saySchema = z
    .object({
      action: z
        .string()
        .describe(
          'brake | throttle | steer | enter | gearDown | gearUp | gearHold | ou o id de uma frase pronta (veja get_task_dictionary).',
        ),
      comparator: z.string().optional(),
      amount: z.string().optional(),
      gear: z.number().int().min(1).max(8).optional(),
      purpose: z.string().optional(),
      focus: z.enum(['focus', 'attention', 'reminder', 'none']).optional(),
    })
    .describe('O que o engenheiro deve dizer, montado só com o dicionário.');

  const toWhere = (w: z.infer<typeof whereSchema>): TaskWhere | null => {
    const kinds = (
      ['corner', 'between', 'before', 'after', 'sector', 'straight', 'global', 'atM'] as const
    ).filter((k) => w[k] !== undefined);
    if (kinds.length !== 1) return null;
    if (w.corner !== undefined) return { corner: w.corner, ...(w.phase ? { phase: w.phase } : {}) };
    if (w.between) return { between: w.between };
    if (w.before !== undefined) return { before: w.before };
    if (w.after !== undefined) return { after: w.after };
    if (w.sector !== undefined) return { sector: w.sector };
    if (w.straight) return { straight: w.straight };
    if (w.global) return { global: w.global };
    return { atM: w.atM! };
  };
  const taskError = (e: unknown): CallToolResult => {
    if (e instanceof TaskError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: jsonText({
              error: e.message,
              ...(e.valid ? { valid: e.valid } : {}),
              hint: 'Veja get_task_dictionary: o engenheiro só fala frases montadas com o dicionário.',
            }),
          },
        ],
      };
    }
    return errorResult(e);
  };
  const taskView = (t: EngineerTask) => ({
    id: t.id,
    track: trackName(t.trackId),
    trackId: t.trackId,
    car: t.carCode ?? 'qualquer',
    status: t.status,
    where: t.where,
    say: t.say,
    spoken: t.spoken['pt-BR'],
    why: t.why,
    note: t.note,
    source: t.source,
    agent: t.agent,
    spokenCount: t.spokenCount,
    createdAt: dateTime(t.createdAt),
  });

  server.registerTool(
    'get_task_dictionary',
    {
      title: 'Dicionário das tarefas do engenheiro',
      description:
        'O vocabulário que o engenheiro de rádio consegue falar: onde (curva, fase, entre curvas, setor...), ação ' +
        '(verbos com comparativo e quantidade, marchas e frases prontas), porquê e prefixo, com exemplos. Chame ' +
        'antes de propor uma tarefa: o servidor monta a frase só com estas peças e recusa o resto.',
      inputSchema: {},
      annotations: RO,
    },
    async () => safe(() => ok(jsonText(tasks.dictionary(), 40_000))),
  );

  server.registerTool(
    'propose_engineer_task',
    {
      title: 'Propor uma tarefa ao engenheiro',
      description:
        'Propõe UMA instrução de pilotagem para o engenheiro de rádio falar num ponto da pista (ex.: "Na T7, entrada. ' +
        'Freie vinte metros mais tarde."). É só uma PROPOSTA: o piloto aprova no app e só depois o engenheiro fala. ' +
        'O servidor compõe a frase com o dicionário (get_task_dictionary) e devolve o texto; se algo não existir, ' +
        'recusa e lista o que é válido. Ancore em dados reais (curvas e distâncias de get_corner_detail / get_trace), ' +
        'uma instrução por curva, e explique o motivo em "why". Use dry_run para só conferir a frase.',
      inputSchema: {
        track_id: z.string(),
        car_code: z
          .number()
          .int()
          .optional()
          .describe('Padrão: vale para qualquer carro; informe para ser só deste carro.'),
        where: whereSchema,
        say: saySchema,
        why: z
          .string()
          .max(280)
          .optional()
          .describe('Por que (com o número que sustenta): aparece na tela de aprovação.'),
        note: z
          .string()
          .max(140)
          .optional()
          .describe('Texto livre que só aparece no painel (nunca é falado).'),
        agent: z.string().max(60).optional().describe('Seu nome (ex.: "claude-code", "chatgpt").'),
        dry_run: z.boolean().default(false).describe('Só compõe e valida, sem criar nada.'),
      },
      annotations: WRITE,
    },
    async ({ track_id, car_code, where, say, why, note, agent, dry_run }) =>
      safe(() => {
        const w = toWhere(where);
        if (!w) {
          return taskError(
            new TaskError(
              'invalid',
              'Informe UMA forma de "where" (corner, between, before, after, sector, straight, global ou atM).',
            ),
          );
        }
        try {
          const r = tasks.propose({
            trackId: track_id,
            carCode: car_code ?? null,
            where: w,
            say,
            ...(why ? { why } : {}),
            ...(note ? { note } : {}),
            source: taskSource,
            ...(agent ? { agent } : {}),
            dryRun: dry_run,
          });
          return ok(
            jsonText({
              ok: true,
              dryRun: dry_run,
              ...(r.task ? { taskId: r.task.id, status: 'proposed' } : {}),
              spoken: r.composition.text,
              estimatedSeconds: r.composition.estimatedMs / 1000,
              where: r.composition.where,
              note: dry_run
                ? 'Nada foi criado.'
                : 'Proposta criada. O engenheiro só fala depois que o piloto aprovar no app.',
            }),
          );
        } catch (e) {
          return taskError(e);
        }
      }),
  );

  server.registerTool(
    'list_engineer_tasks',
    {
      title: 'Tarefas do engenheiro',
      description:
        'Lista as tarefas do engenheiro (propostas, ativas, pausadas, concluídas) de uma pista ou de todas, com a frase, ' +
        'o motivo e quantas vezes foi falada. Use para não repetir uma tarefa que já existe.',
      inputSchema: {
        track_id: z.string().optional(),
        status: z.enum(['proposed', 'active', 'paused', 'done', 'dismissed', 'stale']).optional(),
      },
      annotations: RO,
    },
    async ({ track_id, status }) =>
      safe(() =>
        ok(
          jsonText({
            tasks: tasks
              .list({ ...(track_id ? { trackId: track_id } : {}), ...(status ? { status } : {}) })
              .slice(0, 100)
              .map(taskView),
          }),
        ),
      ),
  );

  server.registerTool(
    'update_engineer_task',
    {
      title: 'Editar uma proposta',
      description:
        'Edita uma proposta que o piloto ainda não decidiu (lugar, frase, motivo ou nota). Tarefas já aprovadas só o piloto muda.',
      inputSchema: {
        task_id: z.string(),
        where: whereSchema.optional(),
        say: saySchema.optional(),
        why: z.string().max(280).optional(),
        note: z.string().max(140).optional(),
      },
      annotations: WRITE,
    },
    async ({ task_id, where, say, why, note }) =>
      safe(() => {
        try {
          const w = where ? toWhere(where) : undefined;
          if (where && !w) throw new TaskError('invalid', 'Informe UMA forma de "where".');
          const t = tasks.agentUpdate(task_id, {
            ...(w ? { where: w } : {}),
            ...(say ? { say } : {}),
            ...(why !== undefined ? { why } : {}),
            ...(note !== undefined ? { note } : {}),
          });
          return ok(jsonText({ ok: true, task: taskView(t) }));
        } catch (e) {
          return taskError(e);
        }
      }),
  );

  server.registerTool(
    'withdraw_engineer_task',
    {
      title: 'Retirar uma proposta',
      description:
        'Retira uma proposta que o piloto ainda não decidiu. Não apaga tarefas aprovadas.',
      inputSchema: { task_id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ task_id }) =>
      safe(() => {
        try {
          tasks.withdraw(task_id);
          return ok(jsonText({ ok: true }));
        } catch (e) {
          return taskError(e);
        }
      }),
  );

  server.registerTool(
    'get_live_state',
    {
      title: 'Estado ao vivo',
      description:
        'Estado ao vivo do app (conexão, pista, volta atual, delta, setores, próxima curva, carro, ' +
        'combustível). Só funciona via transporte HTTP do app em execução (http://localhost:8770/mcp).',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      safe(() => {
        if (!runtime) {
          return ok(
            'Estado ao vivo indisponível neste processo (stdio lê só o banco). Para perguntas durante a ' +
              'sessão, conecte ao MCP HTTP do app em execução: http://localhost:8770/mcp. Os dados ' +
              'gravados (sessões, voltas, comparações) funcionam normalmente aqui.',
          );
        }
        const st = runtime.getStatus();
        const f = runtime.liveFrame;
        const s = runtime.session;
        return ok(
          jsonText({
            connection: st.connection,
            ingestor: {
              state: st.ingestor.state,
              rateHz: r(st.ingestor.rateHz),
              lossPct: r(st.ingestor.lossPct, 2),
            },
            capture: st.capture.state,
            session: s
              ? {
                  id: s.id,
                  laps: s.lapCount,
                  best: lapTime(s.bestLapMs),
                  ...carFields(s.carCode),
                }
              : null,
            frame: f
              ? {
                  state: f.state,
                  track: f.track,
                  lap: {
                    n: f.lap.lap,
                    of: f.lap.totalLaps,
                    current: lapTime(f.lap.currentLapMs),
                    last: lapTime(f.lap.lastLapMs),
                    best: lapTime(f.lap.bestLapMs),
                    predicted: lapTime(f.lap.predictedLapMs),
                    delta_s: r(f.lap.delta.ms === null ? null : f.lap.delta.ms / 1000, 3),
                    deltaRef: f.lap.delta.reference,
                    valid: f.lap.currentLapValid ?? null,
                  },
                  sectors: f.sectors.map((x) => ({
                    ms: x.timeMs,
                    status: x.status,
                    delta_ms: x.deltaMs,
                  })),
                  distance_m: r(f.distanceM),
                  nextCorner: f.nextCorner ? roundDeep(f.nextCorner, 1) : null,
                  car: {
                    speed_kmh: r(f.car.speedKmh),
                    gear: f.car.gear,
                    rpm: r(f.car.rpm),
                    throttle: r(f.car.throttle, 2),
                    brake: r(f.car.brake, 2),
                  },
                  tyresC: roundDeep(f.tyres.tempC, 0),
                  fuel: roundDeep(
                    {
                      level: f.fuel.level,
                      perLap: f.fuel.perLapAvg,
                      lapsLeft: f.fuel.lapsRemaining,
                    },
                    2,
                  ),
                }
              : null,
          }),
        );
      }),
  );

  server.registerTool(
    'rename_corner',
    {
      title: 'Renomear curva',
      description:
        'Dá um nome a uma curva (ex.: T1 → "Grampo"); string vazia remove o nome. O nome é mantido ' +
        'se as curvas forem detectadas de novo.',
      inputSchema: {
        track_id: z.string(),
        corner_id: z.string().describe('Id da curva (T1…).'),
        name: z.string().max(60),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ track_id, corner_id, name }) =>
      safe(() => {
        const t = analysis.renameCorner(track_id, corner_id.toUpperCase(), name.trim() || null);
        runtime?.refreshTrack();
        const c = t.corners.find((k) => k.id === corner_id.toUpperCase());
        return ok(`Curva ${c?.id} da pista ${t.name}: ${c?.name ? `"${c.name}"` : 'sem nome'}.`);
      }),
  );

  server.registerTool(
    'rename_track',
    {
      title: 'Renomear pista',
      description: 'Renomeia uma pista (ex.: "Pista desconhecida 1" → "Spa-Francorchamps").',
      inputSchema: { track_id: z.string(), name: z.string().min(1).max(80) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ track_id, name }) =>
      safe(() => {
        const t = analysis.renameTrack(track_id, name.trim());
        runtime?.refreshTrack();
        return ok(`Pista ${t.id} renomeada para "${t.name}".`);
      }),
  );

  // ------------------------------------------------------------------------------------------
  // Resources (cheap read-only views)
  server.registerResource(
    'tracks',
    'gt7://tracks',
    { title: 'Pistas', description: 'Pistas conhecidas (JSON).', mimeType: 'application/json' },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(
            store.listTracks().map((t) => ({
              id: t.id,
              name: t.name,
              length_m: r(t.lengthM),
              corners: t.corners.length,
            })),
          ),
        },
      ],
    }),
  );
  server.registerResource(
    'track',
    new ResourceTemplate('gt7://tracks/{trackId}', {
      list: async () => ({
        resources: store.listTracks().map((t) => ({
          uri: `gt7://tracks/${t.id}`,
          name: t.name,
          mimeType: 'application/json',
        })),
      }),
    }),
    {
      title: 'Pista',
      description: 'Pista com curvas e setores (JSON).',
      mimeType: 'application/json',
    },
    async (uri, vars) => {
      const id = String(vars.trackId);
      const t = store.getTrack(id);
      if (!t) throw new Error(`Pista ${id} não encontrada.`);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              id: t.id,
              name: t.name,
              length_m: r(t.lengthM),
              sectorGates_m: t.sectorGates.map((g) => r(g.distanceM)),
              corners: t.corners.map((c) => ({
                id: c.id,
                name: c.name,
                kind: c.kind ?? null,
                dir: c.direction,
                entry_m: r(c.entryM),
                apex_m: r(c.apexM),
                exit_m: r(c.exitM),
              })),
            }),
          },
        ],
      };
    },
  );

  registerKnowledge(server, { store });
  registerPrompts(server, { store, analysis, runtime });
  return server;
}
