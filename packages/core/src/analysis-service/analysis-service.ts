/**
 * AnalysisService: stateful facade over Gt7Store + the pure @gt7/analysis package.
 *
 * - Builds/caches the analysis reference line of each track from the stored centerline.
 * - Detects and persists corners per track (`ensureTrackCorners`), keeping user names.
 * - Caches prepared laps, lap analyses and comparisons in LRU caches keyed by lap ids + the
 *   track line/corner/sector signatures (renames and edits invalidate naturally).
 * - Resolves symbolic references (personal best, session best, best reference, auto).
 *
 * Used by the MCP server, the server REST API and the in-app AI coach. All methods that touch
 * traces are async (trace files are read asynchronously); the rest is synchronous SQLite.
 */

import {
  buildChartData,
  type Centerline,
  type ChartChannel,
  type ChartData,
  centerlineFromPolyline,
  checkLapValidity,
  compareLaps as compareLapsPure,
  computeConsistency,
  computeDistanceDelta,
  computeLapMetrics,
  computeMicrosectors,
  detectCorners,
  formatComparisonMarkdown,
  microsectorColors,
  type PreparedLap,
  pointAtDistance,
  prepareLap,
  resampleLap,
  summarizeComparisonForAI,
  summarizeLapForAI,
} from '@gt7/analysis';
import {
  COMPARISON_REFERENCE_KINDS,
  type ComparisonReferenceKind,
  type ConsistencyReport,
  type Corner,
  type DistanceDelta,
  type EvolutionCornerPoint,
  type EvolutionDay,
  type EvolutionReport,
  type EvolutionTrend,
  type Id,
  type Lap,
  type LapAnalysis,
  type LapComparison,
  type LapComparisonResult,
  type MicrosectorAnalysis,
  type ResampledTrace,
  type TraceChannel,
  type Track,
  type TrackAnalysis,
} from '@gt7/shared';
import { isPersonalLap } from '../live/context.ts';
import type { Gt7Store } from '../store/store.ts';
import { LruCache } from './lru.ts';

/** Bump when the corner detection changes enough to warrant re-detecting stored corners. */
export const CORNER_DETECTION_VERSION = 1;
/** Settings key prefix storing the detection signature of each track's corners. */
export const CORNER_SIGNATURE_KEY = 'analysis.corners.';
/** Apex distance tolerance (m) to carry a user name over to a re-detected corner. */
const NAME_MATCH_M = 40;

export type AnalysisErrorCode =
  | 'notFound'
  | 'noTrack'
  | 'noCenterline'
  | 'noTrace'
  | 'trackMismatch'
  | 'noReference'
  | 'invalidArgument';

/** Error with a machine code and a pt-BR message (safe to show to users / LLMs). */
export class AnalysisError extends Error {
  readonly code: AnalysisErrorCode;
  constructor(code: AnalysisErrorCode, message: string) {
    super(message);
    this.name = 'AnalysisError';
    this.code = code;
  }
}

export interface AnalysisServiceOptions {
  store: Gt7Store;
  /** Max prepared laps kept in memory (default 48; ~1–2 MB each). */
  preparedCacheSize?: number;
  /** Max cached comparisons / lap analyses (default 64 each). */
  resultCacheSize?: number;
  /** Diagnostic logger (default: none). */
  log?: (message: string) => void;
}

export interface EnsureCornersResult {
  corners: Corner[];
  /** True when corners were (re)detected and persisted by this call. */
  detected: boolean;
}

export interface ResampleRequest {
  /** Grid step (m), default 2 (raised to honour maxPoints). */
  stepM?: number;
  channels?: readonly TraceChannel[];
  fromM?: number;
  toM?: number;
  /** Max grid points (default 1000). */
  maxPoints?: number;
  /** Reference for the 'deltaS' channel (lap id or symbolic; default 'auto'). */
  reference?: Id | ComparisonReferenceKind;
}

export interface ChartRequest {
  cornerId?: string;
  fromM?: number;
  toM?: number;
  channels?: readonly ChartChannel[];
  maxPoints?: number;
  /** Index (in lapIds) of the lap used as 'deltaS' reference (default 0). */
  referenceIndex?: number;
  /** Distance before a corner entry included in a corner chart (m), default 200. */
  brakeMarginM?: number;
}

export type ConsistencyTarget = { sessionId: Id; lapIds?: undefined } | { lapIds: Id[] };

interface LineEntry {
  key: string;
  line: Centerline;
}

const isKind = (v: string): v is ComparisonReferenceKind =>
  (COMPARISON_REFERENCE_KINDS as readonly string[]).includes(v);

/** Cheap stable hash (FNV-1a 32) of a string. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Signature of a corner list (ids, distances, names): changes when the user edits corners. */
export function cornersSignature(corners: readonly Corner[]): string {
  return hash(
    JSON.stringify(corners.map((c) => [c.id, c.entryM, c.apexM, c.exitM, c.name, c.direction])),
  );
}

function sectorStarts(track: Track, lengthM: number): number[] {
  const gates = [...track.sectorGates]
    .map((g) => g.distanceM)
    .filter((d) => Number.isFinite(d) && d >= 0 && d < lengthM)
    .sort((a, b) => a - b);
  if (gates.length === 0 || gates[0]! > 1) gates.unshift(0);
  else gates[0] = 0;
  if (gates.length === 1) return [0, lengthM / 3, (2 * lengthM) / 3];
  return gates;
}

function localDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function stdDev(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1));
}

const fmtNum = (v: number, digits = 0) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signed = (v: number, digits = 0) =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), digits)}`;

export class AnalysisService {
  readonly store: Gt7Store;
  readonly #log: (m: string) => void;
  #lines = new Map<Id, LineEntry>();
  #prepared: LruCache<string, Promise<PreparedLap>>;
  #comparisons: LruCache<string, Promise<LapComparisonResult>>;
  #lapAnalyses: LruCache<string, Promise<LapAnalysis>>;
  #evolution = new Map<string, Promise<EvolutionReport>>();
  #cornerJobs = new Map<Id, Promise<EnsureCornersResult>>();

  constructor(opts: AnalysisServiceOptions) {
    this.store = opts.store;
    this.#log = opts.log ?? (() => {});
    this.#prepared = new LruCache(opts.preparedCacheSize ?? 48);
    this.#comparisons = new LruCache(opts.resultCacheSize ?? 64);
    this.#lapAnalyses = new LruCache(opts.resultCacheSize ?? 64);
  }

  /** Cache statistics (tests / diagnostics). */
  get cacheStats() {
    return {
      prepared: {
        size: this.#prepared.size,
        hits: this.#prepared.hits,
        misses: this.#prepared.misses,
      },
      comparisons: {
        size: this.#comparisons.size,
        hits: this.#comparisons.hits,
        misses: this.#comparisons.misses,
      },
      lapAnalyses: {
        size: this.#lapAnalyses.size,
        hits: this.#lapAnalyses.hits,
        misses: this.#lapAnalyses.misses,
      },
    };
  }

  // -------------------------------------------------------------------------------------------
  // Lookups
  // -------------------------------------------------------------------------------------------

  getTrackOrThrow(trackId: Id): Track {
    const t = this.store.getTrack(trackId);
    if (!t) throw new AnalysisError('notFound', `Pista ${trackId} não encontrada.`);
    return t;
  }

  getLapOrThrow(lapId: Id): Lap {
    const l = this.store.getLap(lapId);
    if (!l) throw new AnalysisError('notFound', `Volta ${lapId} não encontrada.`);
    return l;
  }

  #lapTrack(lap: Lap): Track {
    if (!lap.trackId) {
      throw new AnalysisError(
        'noTrack',
        `A volta ${lap.id} não tem pista identificada (volta incompleta ou com descontinuidade).`,
      );
    }
    return this.getTrackOrThrow(lap.trackId);
  }

  /** Signature of the stored centerline (cheap query, no blob). */
  #centerlineKey(trackId: Id): string | null {
    const r = this.store.db
      .prepare(
        'SELECT source_lap_id AS s, length_m AS l, length(points) AS n FROM track_centerlines WHERE track_id = ?',
      )
      .get(trackId) as { s: string | null; l: number; n: number | bigint } | undefined;
    if (!r) return null;
    return `${trackId}:${r.s ?? ''}:${Number(r.n)}:${Number(r.l).toFixed(2)}`;
  }

  /** Analysis reference line of a track (synchronous; cached until the centerline changes). */
  getLine(trackId: Id): LineEntry | null {
    const key = this.#centerlineKey(trackId);
    if (!key) {
      this.#lines.delete(trackId);
      return null;
    }
    const hit = this.#lines.get(trackId);
    if (hit && hit.key === key) return hit;
    const cl = this.store.getCenterline(trackId);
    if (!cl || cl.x.length < 4) return null;
    const line = centerlineFromPolyline({
      closed: true,
      stepM: cl.stepM,
      x: cl.x,
      y: cl.y,
      z: cl.z,
    });
    const entry = { key, line };
    this.#lines.set(trackId, entry);
    return entry;
  }

  #lineOrThrow(trackId: Id): LineEntry {
    const e = this.getLine(trackId);
    if (!e) {
      throw new AnalysisError(
        'noCenterline',
        `A pista ${trackId} ainda não tem linha de referência (complete uma volta limpa).`,
      );
    }
    return e;
  }

  /** Prepared lap (projected on the track line), cached. */
  async preparedLap(lapOrId: Lap | Id): Promise<PreparedLap> {
    const lap = typeof lapOrId === 'string' ? this.getLapOrThrow(lapOrId) : lapOrId;
    const track = this.#lapTrack(lap);
    const line = this.#lineOrThrow(track.id);
    const key = `${lap.id}@${line.key}@${lap.timeMs}`;
    const hit = this.#prepared.get(key);
    if (hit) return hit;
    const p = (async () => {
      const trace = await this.store.loadTrace(lap.id);
      if (!trace) throw new AnalysisError('noTrace', `A volta ${lap.id} não tem trace gravado.`);
      return prepareLap(trace, line.line, {
        lapTimeMs: lap.timeMs,
        isReplay: lap.flags.includes('replay') || lap.referenceMeta?.source === 'replayCapture',
      });
    })();
    this.#prepared.set(key, p);
    p.catch(() => this.#prepared.delete(key));
    return p;
  }

  // -------------------------------------------------------------------------------------------
  // Corners
  // -------------------------------------------------------------------------------------------

  /**
   * Detects the corners of a track from its stored centerline (best lap as speed/yaw reference)
   * and persists them when missing or stale (centerline or detection version changed). Names and
   * brake marker notes given by the user are carried over by apex distance. Corners that exist
   * without a detection signature (user/builtin) are respected unless `force`.
   */
  ensureTrackCorners(trackId: Id, opts: { force?: boolean } = {}): Promise<EnsureCornersResult> {
    const running = this.#cornerJobs.get(trackId);
    if (running && !opts.force) return running;
    const job = this.#ensureCorners(trackId, opts.force ?? false).finally(() => {
      if (this.#cornerJobs.get(trackId) === job) this.#cornerJobs.delete(trackId);
    });
    this.#cornerJobs.set(trackId, job);
    return job;
  }

  async #ensureCorners(trackId: Id, force: boolean): Promise<EnsureCornersResult> {
    const track = this.getTrackOrThrow(trackId);
    const line = this.getLine(trackId);
    if (!line) return { corners: track.corners, detected: false };
    const sigKey = `${CORNER_SIGNATURE_KEY}${trackId}`;
    const wanted = { v: CORNER_DETECTION_VERSION, line: line.key };
    const saved = this.store.getSetting<{ v: number; line: string }>(sigKey);
    const fresh = saved && saved.v === wanted.v && saved.line === wanted.line;
    if (!force && track.corners.length > 0 && (fresh || !saved)) {
      return { corners: track.corners, detected: false };
    }
    if (!force && track.corners.length === 0 && fresh) {
      return { corners: track.corners, detected: false };
    }
    const reference = await this.#detectionReference(track);
    const detected = detectCorners(line.line, reference ? { reference } : {});
    const corners = carryOverNames(detected, track.corners, line.line.lengthM);
    // the track may have been edited meanwhile: re-read before writing
    if (!this.store.getTrack(trackId)) return { corners: [], detected: false };
    this.store.setTrackCorners(trackId, corners);
    this.store.setSetting(sigKey, wanted);
    this.#invalidateTrackResults(trackId);
    this.#log(`analysis: ${corners.length} curvas detectadas na pista ${trackId}`);
    return { corners: this.store.getTrack(trackId)?.corners ?? corners, detected: true };
  }

  async #detectionReference(track: Track): Promise<PreparedLap | undefined> {
    const candidates = [
      ...this.store.getBestLaps(track.id, { limit: 3 }),
      ...(track.centerline?.sourceLapId
        ? [this.store.getLap(track.centerline.sourceLapId)].filter((l): l is Lap => l !== null)
        : []),
    ];
    for (const lap of candidates) {
      try {
        return await this.preparedLap(lap);
      } catch (e) {
        this.#log(`analysis: referência de detecção ${lap.id} indisponível: ${String(e)}`);
      }
    }
    return undefined;
  }

  /** Corners of a track (detected on demand). */
  async getCorners(trackId: Id): Promise<Corner[]> {
    return (await this.ensureTrackCorners(trackId)).corners;
  }

  /** Renames a corner (null clears) and invalidates cached results. */
  renameCorner(trackId: Id, cornerId: string, name: string | null): Track {
    const t = this.store.renameCorner(trackId, cornerId, name);
    if (!t) {
      throw new AnalysisError('notFound', `Curva ${cornerId} não encontrada na pista ${trackId}.`);
    }
    this.#invalidateTrackResults(trackId);
    return t;
  }

  renameTrack(trackId: Id, name: string): Track {
    const t = this.store.renameTrack(trackId, name);
    if (!t) throw new AnalysisError('notFound', `Pista ${trackId} não encontrada.`);
    this.#invalidateTrackResults(trackId);
    return t;
  }

  // -------------------------------------------------------------------------------------------
  // Lifecycle hooks
  // -------------------------------------------------------------------------------------------

  /**
   * Hook for a newly completed lap: drops cached results of its track and detects corners when the
   * track has none yet (new track / first centerline). Resolves to true when corners changed.
   */
  async onLapCompleted(completed: { lap: Lap } | Lap): Promise<boolean> {
    const lap = 'lap' in completed ? completed.lap : completed;
    if (!lap.trackId) return false;
    this.#evolution.forEach((_v, k) => {
      if (k.startsWith(`${lap.trackId}|`)) this.#evolution.delete(k);
    });
    if (!this.store.getTrack(lap.trackId)) return false;
    const res = await this.ensureTrackCorners(lap.trackId);
    return res.detected;
  }

  /** Drops every cached result (prepared laps included). */
  clearCaches(): void {
    this.#lines.clear();
    this.#prepared.clear();
    this.#comparisons.clear();
    this.#lapAnalyses.clear();
    this.#evolution.clear();
  }

  #invalidateTrackResults(trackId: Id): void {
    this.#comparisons.deleteWhere((k) => k.startsWith(`${trackId}|`));
    this.#lapAnalyses.deleteWhere((k) => k.startsWith(`${trackId}|`));
    this.#evolution.forEach((_v, k) => {
      if (k.startsWith(`${trackId}|`)) this.#evolution.delete(k);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Track / lap
  // -------------------------------------------------------------------------------------------

  /** Track overview: map polyline, corners (with map positions), sectors and records. */
  async getTrackAnalysis(
    trackId: Id,
    opts: { maxMapPoints?: number } = {},
  ): Promise<TrackAnalysis> {
    await this.ensureTrackCorners(trackId);
    const track = this.getTrackOrThrow(trackId);
    const line = this.getLine(trackId);
    const L = line?.line.lengthM ?? track.lengthM;
    let map: TrackAnalysis['map'] = null;
    if (line) {
      const max = Math.max(50, opts.maxMapPoints ?? 600);
      const stride = Math.max(1, Math.ceil(line.line.n / max));
      const x: number[] = [];
      const z: number[] = [];
      for (let i = 0; i < line.line.n; i += stride) {
        x.push(Math.round(line.line.x[i]! * 10) / 10);
        z.push(Math.round(line.line.z[i]! * 10) / 10);
      }
      map = { stepM: line.line.stepM * stride, lengthM: L, x, z };
    }
    const corners = track.corners.map((c) => {
      const p = line ? pointAtDistance(line.line, c.apexM) : { x: Number.NaN, z: Number.NaN };
      return { ...c, apexX: p.x, apexZ: p.z };
    });
    const starts = sectorStarts(track, L);
    const sectors = starts.map((fromM, index) => ({ index, fromM, toM: starts[index + 1] ?? L }));
    const all = this.store.listLapsForTrack(trackId);
    const best = all.filter((l) => l.valid).sort((a, b) => a.timeMs - b.timeMs)[0] ?? null;
    const cars = new Map<number, Lap[]>();
    for (const l of all) {
      if (l.isReference) continue;
      const arr = cars.get(l.carCode) ?? [];
      arr.push(l);
      cars.set(l.carCode, arr);
    }
    const sessionIds = new Set(all.map((l) => l.sessionId));
    return {
      track,
      map,
      corners,
      sectors,
      records: {
        overallBestLapId: best?.id ?? null,
        overallBestMs: best?.timeMs ?? null,
        cars: [...cars.entries()].map(([carCode, laps]) => {
          const pb = laps.filter(isPersonalLap).sort((a, b) => a.timeMs - b.timeMs)[0] ?? null;
          return {
            carCode,
            laps: laps.length,
            validLaps: laps.filter((l) => l.valid).length,
            personalBestLapId: pb?.id ?? null,
            personalBestMs: pb?.timeMs ?? null,
          };
        }),
        references: this.store.listReferenceLaps(trackId).map((l) => ({
          lapId: l.id,
          driverName: l.referenceMeta?.driverName ?? null,
          timeMs: l.timeMs,
          carCode: l.carCode,
        })),
      },
      sessionCount: sessionIds.size,
      lapCount: all.length,
    };
  }

  /** Per-corner metrics, validity report and AI summary of one lap. */
  async getLapAnalysis(lapId: Id): Promise<LapAnalysis> {
    const lap = this.getLapOrThrow(lapId);
    const track0 = this.#lapTrack(lap);
    const corners = await this.getCorners(track0.id);
    const track = this.getTrackOrThrow(track0.id);
    const line = this.#lineOrThrow(track.id);
    const key = `${track.id}|${lap.id}|${line.key}|${cornersSignature(corners)}|${hash(JSON.stringify(track.sectorGates))}`;
    const hit = this.#lapAnalyses.get(key);
    if (hit) return hit;
    const p = (async (): Promise<LapAnalysis> => {
      const prepared = await this.preparedLap(lap);
      const metrics = computeLapMetrics(prepared, corners);
      const validity = checkLapValidity(prepared);
      const starts = sectorStarts(track, prepared.lengthM);
      const summary = summarizeLapForAI(prepared, corners, {
        metrics,
        validity,
        sectorStartsM: starts,
      });
      return {
        lap,
        track,
        lengthM: prepared.lengthM,
        corners,
        sectorStartsM: starts,
        metrics,
        validity,
        summary: { ...summary, lapTime_s: lap.timeMs / 1000, gameValid: lap.valid },
      };
    })();
    this.#lapAnalyses.set(key, p);
    p.catch(() => this.#lapAnalyses.delete(key));
    return p;
  }

  // -------------------------------------------------------------------------------------------
  // References and comparisons
  // -------------------------------------------------------------------------------------------

  /** Resolves a symbolic reference for `lap` (never the lap itself). Null when none exists. */
  resolveReference(lapOrId: Lap | Id, kind: ComparisonReferenceKind): Lap | null {
    const lap = typeof lapOrId === 'string' ? this.getLapOrThrow(lapOrId) : lapOrId;
    if (!lap.trackId) return null;
    const trackId = lap.trackId;
    const notSelf = (l: Lap | null | undefined) => (l && l.id !== lap.id ? l : null);
    switch (kind) {
      case 'personalBest':
        return (
          notSelf(this.store.getPersonalBestLap(trackId, lap.carCode)) ??
          notSelf(
            this.store
              .listLapsForTrack(trackId, {
                carCode: lap.carCode,
                validOnly: true,
                includeReferences: false,
              })
              .filter(isPersonalLap)
              .find((l) => l.id !== lap.id),
          )
        );
      case 'sessionBest':
        return notSelf(
          this.store
            .listLaps(lap.sessionId)
            .filter((l) => l.valid && l.id !== lap.id)
            .sort((a, b) => a.timeMs - b.timeMs)[0],
        );
      case 'bestReference': {
        const refs = this.store.listReferenceLaps(trackId).filter((l) => l.id !== lap.id);
        return refs.find((l) => l.carCode === lap.carCode) ?? refs[0] ?? null;
      }
      case 'auto':
        return (
          this.resolveReference(lap, 'bestReference') ??
          this.resolveReference(lap, 'personalBest') ??
          this.resolveReference(lap, 'sessionBest')
        );
    }
  }

  #referenceLap(
    lap: Lap,
    ref: Id | ComparisonReferenceKind,
  ): { lap: Lap; kind: LapComparisonResult['referenceKind'] } {
    if (isKind(ref)) {
      const r = this.resolveReference(lap, ref);
      if (!r) {
        const label: Record<ComparisonReferenceKind, string> = {
          personalBest: 'melhor volta pessoal (outra que não esta)',
          sessionBest: 'melhor volta da sessão (outra que não esta)',
          bestReference: 'volta de referência capturada',
          auto: 'referência, melhor pessoal ou melhor da sessão',
        };
        throw new AnalysisError(
          'noReference',
          `Não há ${label[ref]} para comparar com a volta ${lap.id}.`,
        );
      }
      return { lap: r, kind: ref };
    }
    const r = this.getLapOrThrow(ref);
    if (r.id === lap.id) {
      throw new AnalysisError('invalidArgument', 'Escolha duas voltas diferentes para comparar.');
    }
    return { lap: r, kind: 'lap' };
  }

  /**
   * Compares a lap with a reference (lap id or symbolic). Same track required; a car mismatch
   * adds a warning. Result cached by (lap, reference, line, corners, sectors).
   */
  async compareLaps(
    lapId: Id,
    reference: Id | ComparisonReferenceKind = 'auto',
    opts: { topN?: number } = {},
  ): Promise<LapComparisonResult> {
    const lap = this.getLapOrThrow(lapId);
    const track0 = this.#lapTrack(lap);
    const { lap: refLap, kind } = this.#referenceLap(lap, reference);
    if (refLap.trackId !== lap.trackId) {
      throw new AnalysisError(
        'trackMismatch',
        `As voltas são de pistas diferentes (${lap.trackId ?? '?'} × ${refLap.trackId ?? '?'}).`,
      );
    }
    const corners = await this.getCorners(track0.id);
    const track = this.getTrackOrThrow(track0.id);
    const line = this.#lineOrThrow(track.id);
    const topN = opts.topN ?? 3;
    const key = [
      track.id,
      lap.id,
      refLap.id,
      line.key,
      cornersSignature(corners),
      hash(JSON.stringify(track.sectorGates)),
      topN,
    ].join('|');
    const hit = this.#comparisons.get(key);
    if (hit) return hit.then((r) => ({ ...r, referenceKind: kind }));
    const p = (async (): Promise<LapComparisonResult> => {
      const [a, b] = await Promise.all([this.preparedLap(lap), this.preparedLap(refLap)]);
      const cmp: LapComparison = compareLapsPure(a, b, corners, {
        trackId: track.id,
        sectorStartsM: sectorStarts(track, Math.min(a.lengthM, b.lengthM)),
        topN,
      });
      if (lap.carCode !== refLap.carCode) {
        cmp.warnings.unshift(
          `Carros diferentes (carCode ${lap.carCode} × ${refLap.carCode}): frenagens, V-mín e ` +
            'marchas dependem do carro; compare com cautela.',
        );
      }
      if (!lap.valid) cmp.warnings.push(`A volta ${lap.id} está marcada como inválida.`);
      if (!refLap.valid) cmp.warnings.push(`A referência ${refLap.id} está marcada como inválida.`);
      return {
        comparison: cmp,
        lap,
        referenceLap: refLap,
        referenceKind: kind,
        markdown: formatComparisonMarkdown(cmp),
        summary: {
          ...summarizeComparisonForAI(cmp),
          ...(refLap.referenceMeta
            ? { refDriver: refLap.referenceMeta.driverName, refSource: refLap.referenceMeta.source }
            : {}),
          sameCar: lap.carCode === refLap.carCode,
        },
      };
    })();
    this.#comparisons.set(key, p);
    p.catch(() => this.#comparisons.delete(key));
    return p;
  }

  /** Laps of a session (valid by default) or explicit ids, all on one track. */
  #lapSet(target: ConsistencyTarget, minLaps: number): { laps: Lap[]; track: Track } {
    let laps: Lap[];
    if (target.lapIds) {
      laps = target.lapIds.map((id) => this.getLapOrThrow(id));
    } else {
      const s = this.store.getSession(target.sessionId);
      if (!s) throw new AnalysisError('notFound', `Sessão ${target.sessionId} não encontrada.`);
      const all = this.store.listLaps(target.sessionId).filter((l) => l.trackId);
      const valid = all.filter((l) => l.valid);
      laps = valid.length >= minLaps ? valid : all;
    }
    if (laps.length < minLaps) {
      throw new AnalysisError(
        'invalidArgument',
        `São necessárias pelo menos ${minLaps} voltas (encontradas ${laps.length}).`,
      );
    }
    const trackIds = new Set(laps.map((l) => l.trackId));
    if (trackIds.size !== 1 || !laps[0]!.trackId) {
      throw new AnalysisError('trackMismatch', 'As voltas precisam ser da mesma pista.');
    }
    return { laps, track: this.getTrackOrThrow(laps[0]!.trackId!) };
  }

  /** Consistency of a session (valid laps) or of explicit laps (≥ 2). */
  async getConsistency(target: ConsistencyTarget): Promise<ConsistencyReport> {
    const { laps, track } = this.#lapSet(target, 2);
    const corners = await this.getCorners(track.id);
    const prepared = await Promise.all(laps.map((l) => this.preparedLap(l)));
    const { metrics: _metrics, ...report } = computeConsistency(prepared, corners, {
      sessionId: target.lapIds ? laps[0]!.sessionId : target.sessionId,
    });
    return report;
  }

  /** Microsectors (+ theoretical best) of a set of laps, colored vs a reference lap. */
  async getMicrosectors(
    lapIds: Id[],
    opts: { referenceLapId?: Id; count?: number } = {},
  ): Promise<MicrosectorAnalysis> {
    const ids = [...new Set([...lapIds, ...(opts.referenceLapId ? [opts.referenceLapId] : [])])];
    const { laps, track } = this.#lapSet({ lapIds: ids }, 1);
    const prepared = await Promise.all(laps.map((l) => this.preparedLap(l)));
    const L = Math.min(...prepared.map((p) => p.lengthM));
    const report = computeMicrosectors(prepared, {
      ...(opts.count ? { count: opts.count } : {}),
      sectorStartsM: sectorStarts(track, L),
    });
    const refId = opts.referenceLapId ?? report.bestLapId;
    return {
      report,
      referenceLapId: refId,
      colors: report.laps
        .filter((l) => l.lapId !== refId)
        .map((l) => ({ lapId: l.lapId, colors: microsectorColors(report, l.lapId, refId) })),
    };
  }

  /** Lap resampled on a distance grid (bounded number of points). */
  async getResampledTrace(lapId: Id, req: ResampleRequest = {}): Promise<ResampledTrace> {
    const lap = this.getLapOrThrow(lapId);
    const prepared = await this.preparedLap(lap);
    const L = prepared.lengthM;
    const fromM = Math.max(0, Math.min(req.fromM ?? 0, L));
    const toM = Math.max(fromM, Math.min(req.toM ?? L, L));
    const maxPoints = Math.max(2, req.maxPoints ?? 1000);
    const stepM = Math.max(req.stepM ?? 2, (toM - fromM) / (maxPoints - 1), 0.1);
    const channels = req.channels;
    let reference: PreparedLap | undefined;
    if (channels?.includes('deltaS')) {
      try {
        reference = await this.preparedLap(this.#referenceLap(lap, req.reference ?? 'auto').lap);
      } catch (e) {
        if (!(e instanceof AnalysisError)) throw e;
      }
    }
    return resampleLap(prepared, {
      stepM,
      fromM,
      toM,
      ...(channels ? { channels } : {}),
      ...(reference ? { reference } : {}),
    });
  }

  /** Downsampled chart series for one or more laps (full lap, a range or one corner). */
  async getChartData(lapIds: Id[], req: ChartRequest = {}): Promise<ChartData> {
    const { laps, track } = this.#lapSet({ lapIds }, 1);
    const corners = await this.getCorners(track.id);
    const prepared = await Promise.all(laps.map((l) => this.preparedLap(l)));
    let corner: Corner | undefined;
    if (req.cornerId) {
      corner = findCorner(corners, req.cornerId);
      if (!corner) {
        throw new AnalysisError('notFound', `Curva ${req.cornerId} não encontrada nesta pista.`);
      }
    }
    return buildChartData(prepared, {
      ...(req.channels ? { channels: req.channels } : {}),
      ...(req.fromM !== undefined ? { fromM: req.fromM } : {}),
      ...(req.toM !== undefined ? { toM: req.toM } : {}),
      ...(corner ? { corner } : { corners }),
      ...(req.maxPoints ? { maxPoints: req.maxPoints } : {}),
      ...(req.referenceIndex !== undefined ? { referenceIndex: req.referenceIndex } : {}),
      ...(req.brakeMarginM !== undefined ? { brakeMarginM: req.brakeMarginM } : {}),
    });
  }

  /** Cumulative delta by distance of a lap vs a reference. */
  async getDeltaTrace(
    lapId: Id,
    reference: Id | ComparisonReferenceKind = 'auto',
    opts: { stepM?: number } = {},
  ): Promise<DistanceDelta> {
    const lap = this.getLapOrThrow(lapId);
    const ref = this.#referenceLap(lap, reference).lap;
    if (ref.trackId !== lap.trackId) {
      throw new AnalysisError('trackMismatch', 'As voltas precisam ser da mesma pista.');
    }
    const [a, b] = await Promise.all([this.preparedLap(lap), this.preparedLap(ref)]);
    return computeDistanceDelta(a, b, { stepM: Math.max(1, opts.stepM ?? 2) });
  }

  // -------------------------------------------------------------------------------------------
  // Evolution
  // -------------------------------------------------------------------------------------------

  /**
   * Day-by-day evolution on a track (own laps, one car): best lap, consistency and key per-corner
   * metrics of each day's best lap vs a baseline (best reference lap, else the personal best).
   * Without `carCode` the most driven car of the track is used.
   */
  async getEvolution(
    trackId: Id,
    opts: { carCode?: number; maxDays?: number } = {},
  ): Promise<EvolutionReport> {
    const track = this.getTrackOrThrow(trackId);
    let carCode = opts.carCode ?? null;
    const own = this.store
      .listLapsForTrack(trackId, { includeReferences: false, orderBy: 'startedAt' })
      .filter((l) => !l.flags.includes('replay'));
    if (carCode === null) {
      const counts = new Map<number, number>();
      for (const l of own) counts.set(l.carCode, (counts.get(l.carCode) ?? 0) + 1);
      carCode = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    }
    const key = `${track.id}|${carCode}|${opts.maxDays ?? 30}`;
    const hit = this.#evolution.get(key);
    if (hit) return hit;
    const p = this.#computeEvolution(track, carCode, own, opts.maxDays ?? 30);
    this.#evolution.set(key, p);
    p.catch(() => this.#evolution.delete(key));
    return p;
  }

  async #computeEvolution(
    track: Track,
    carCode: number | null,
    ownAll: Lap[],
    maxDays: number,
  ): Promise<EvolutionReport> {
    const own = carCode === null ? [] : ownAll.filter((l) => l.carCode === carCode);
    const report: EvolutionReport = {
      trackId: track.id,
      carCode,
      baseline: null,
      days: [],
      trends: [],
    };
    if (own.length === 0) return report;
    const corners = await this.getCorners(track.id);
    const refs = this.store.listReferenceLaps(track.id);
    const ref = refs.find((l) => l.carCode === carCode) ?? refs[0] ?? null;
    const pb = carCode !== null ? this.store.getPersonalBestLap(track.id, carCode) : null;
    const baselineLap = ref ?? pb;
    let baseline: PreparedLap | null = null;
    if (baselineLap) {
      try {
        baseline = await this.preparedLap(baselineLap);
        report.baseline = {
          kind: ref ? 'reference' : 'personalBest',
          lapId: baselineLap.id,
          timeMs: baselineLap.timeMs,
        };
      } catch (e) {
        this.#log(`analysis: baseline ${baselineLap.id} indisponível: ${String(e)}`);
      }
    }

    const byDay = new Map<string, Lap[]>();
    for (const l of own) {
      const d = localDate(l.startedAt);
      const arr = byDay.get(d) ?? [];
      arr.push(l);
      byDay.set(d, arr);
    }
    const days = [...byDay.keys()].sort().slice(-Math.max(1, maxDays));
    for (const date of days) {
      const laps = byDay.get(date)!;
      const valid = laps.filter((l) => l.valid).sort((a, b) => a.timeMs - b.timeMs);
      const best = valid[0] ?? null;
      const top3 = valid.slice(0, 3);
      const day: EvolutionDay = {
        date,
        sessions: new Set(laps.map((l) => l.sessionId)).size,
        laps: laps.length,
        validLaps: valid.length,
        bestLapId: best?.id ?? null,
        bestLapMs: best?.timeMs ?? null,
        top3MeanMs: top3.length
          ? Math.round(top3.reduce((a, l) => a + l.timeMs, 0) / top3.length)
          : null,
        lapTimeStdDevMs: (() => {
          const sd = stdDev(valid.map((l) => l.timeMs));
          return sd === null ? null : Math.round(sd);
        })(),
        gapToBaselineMs: best && report.baseline ? best.timeMs - report.baseline.timeMs : null,
        corners: [],
      };
      if (best) {
        try {
          const prepared = await this.preparedLap(best);
          day.corners = evolutionCorners(prepared, baseline, corners, track);
        } catch (e) {
          this.#log(`analysis: evolução, volta ${best.id} indisponível: ${String(e)}`);
        }
      }
      report.days.push(day);
    }
    report.trends = evolutionTrends(report.days, corners);
    return report;
  }
}

function findCorner(corners: readonly Corner[], idOrName: string): Corner | undefined {
  const q = idOrName.trim().toLowerCase();
  return (
    corners.find((c) => c.id.toLowerCase() === q) ??
    corners.find((c) => (c.name ?? '').toLowerCase() === q) ??
    corners.find((c) => c.id.toLowerCase() === `t${q}`)
  );
}

export { findCorner };

/** Copies user names / marker notes from old corners to re-detected ones (nearest apex). */
export function carryOverNames(next: Corner[], prev: readonly Corner[], lengthM: number): Corner[] {
  if (prev.length === 0) return next;
  const used = new Set<number>();
  return next.map((c) => {
    let bestI = -1;
    let bestD = NAME_MATCH_M;
    prev.forEach((o, i) => {
      if (used.has(i) || o.direction !== c.direction) return;
      let d = Math.abs(o.apexM - c.apexM);
      d = Math.min(d, lengthM - d);
      if (d <= bestD) {
        bestD = d;
        bestI = i;
      }
    });
    if (bestI < 0) return c;
    used.add(bestI);
    const o = prev[bestI]!;
    return {
      ...c,
      name: o.name ?? c.name,
      ...(o.brakeMarkerNote ? { brakeMarkerNote: o.brakeMarkerNote } : {}),
    };
  });
}

function evolutionCorners(
  lap: PreparedLap,
  baseline: PreparedLap | null,
  corners: readonly Corner[],
  track: Track,
): EvolutionCornerPoint[] {
  const d = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
  if (baseline) {
    const cmp = compareLapsPure(lap, baseline, corners, {
      trackId: track.id,
      sectorStartsM: sectorStarts(track, Math.min(lap.lengthM, baseline.lengthM)),
    });
    return cmp.rows.map((r) => ({
      cornerId: r.corner.id,
      brakePointM: r.a.brakePointM,
      minSpeedKmh: r.a.minSpeedKmh,
      exitSpeedKmh: r.a.exitSpeedKmh,
      throttlePickupM: r.a.throttlePickupM,
      timeLostMs: Math.round(r.timeLostMs),
      brakePointDiffM: d(r.a.brakePointM, r.b.brakePointM),
      minSpeedDiffKmh: d(r.a.minSpeedKmh, r.b.minSpeedKmh),
      exitSpeedDiffKmh: d(r.a.exitSpeedKmh, r.b.exitSpeedKmh),
      throttlePickupDiffM: d(r.a.throttlePickupM, r.b.throttlePickupM),
    }));
  }
  return computeLapMetrics(lap, corners).map((m) => ({
    cornerId: m.cornerId,
    brakePointM: m.brakePointM,
    minSpeedKmh: m.minSpeedKmh,
    exitSpeedKmh: m.exitSpeedKmh,
    throttlePickupM: m.throttlePickupM,
    timeLostMs: null,
    brakePointDiffM: null,
    minSpeedDiffKmh: null,
    exitSpeedDiffKmh: null,
    throttlePickupDiffM: null,
  }));
}

const TREND_SPECS: {
  metric: Exclude<EvolutionTrend['metric'], 'lapTimeMs'>;
  /** Unit of a "meaningful" change, used for ranking. */
  unit: number;
  label: string;
  u: string;
  digits: number;
}[] = [
  { metric: 'timeLostMs', unit: 50, label: 'tempo perdido', u: ' ms', digits: 0 },
  { metric: 'brakePointDiffM', unit: 5, label: 'frenagem vs base', u: ' m', digits: 0 },
  { metric: 'minSpeedDiffKmh', unit: 2, label: 'V-mín vs base', u: ' km/h', digits: 1 },
  { metric: 'exitSpeedDiffKmh', unit: 3, label: 'saída vs base', u: ' km/h', digits: 1 },
  { metric: 'throttlePickupDiffM', unit: 8, label: 'acelerador vs base', u: ' m', digits: 0 },
];

/** First-vs-last-day changes, ranked by normalized magnitude. */
function evolutionTrends(days: EvolutionDay[], corners: readonly Corner[]): EvolutionTrend[] {
  const withBest = days.filter((d) => d.bestLapMs !== null);
  if (withBest.length < 2) return [];
  const first = withBest[0]!;
  const last = withBest.at(-1)!;
  const out: (EvolutionTrend & { score: number })[] = [];
  const lapChange = last.bestLapMs! - first.bestLapMs!;
  out.push({
    cornerId: null,
    metric: 'lapTimeMs',
    first: first.bestLapMs!,
    last: last.bestLapMs!,
    change: lapChange,
    improved: lapChange < 0,
    message:
      `Melhor volta: ${(first.bestLapMs! / 1000).toFixed(3).replace('.', ',')} s (${first.date}) → ` +
      `${(last.bestLapMs! / 1000).toFixed(3).replace('.', ',')} s (${last.date}), ` +
      `${signed(lapChange / 1000, 3)} s.`,
    score: Number.POSITIVE_INFINITY,
  });
  for (const c of corners) {
    const a = first.corners.find((x) => x.cornerId === c.id);
    const b = last.corners.find((x) => x.cornerId === c.id);
    if (!a || !b) continue;
    const label = c.name ? `${c.id} (${c.name})` : c.id;
    for (const spec of TREND_SPECS) {
      const va = a[spec.metric];
      const vb = b[spec.metric];
      if (va === null || vb === null) continue;
      const change = vb - va;
      const score = Math.abs(change) / spec.unit;
      if (score < 1) continue;
      // closer to the baseline (|diff| shrinks) or less time lost = improvement
      const improved = spec.metric === 'timeLostMs' ? change < 0 : Math.abs(vb) < Math.abs(va);
      out.push({
        cornerId: c.id,
        metric: spec.metric,
        first: va,
        last: vb,
        change,
        improved,
        message:
          `${label} · ${spec.label}: ${signed(va, spec.digits)}${spec.u} → ` +
          `${signed(vb, spec.digits)}${spec.u} (${improved ? 'melhorou' : 'piorou'})`,
        score,
      });
    }
  }
  return out
    .sort((x, y) => y.score - x.score)
    .slice(0, 12)
    .map(({ score: _s, ...t }) => t);
}
