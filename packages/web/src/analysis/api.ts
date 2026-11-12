/**
 * REST client of the analysis area. Same origin (the Vite dev server proxies `/api`); a token, if
 * the server requires one, travels in the `gt7_token` cookie set when the page was opened with
 * `?token=`. Errors are normalised to {@link ApiError} with a pt-BR message.
 */

import type {
  ApiBackupUpload,
  ApiComparison,
  ApiConsistency,
  ApiDataSummary,
  ApiDiscoveryScanResult,
  ApiErrorBody,
  ApiEvolution,
  ApiImportMode,
  ApiImportResult,
  ApiLapAnalysis,
  ApiLapDrivingEvents,
  ApiMcpInfo,
  ApiMicrosectors,
  ApiRedetectCornersResult,
  ApiSettings,
  ApiSettingsPatch,
  ApiStatus,
  ApiTraces,
  ApiTrackAnalysis,
  CoachConfig,
  CoachConfigPatch,
  CoachReport,
  CoachReportSummary,
  DeviceInfo,
  EngineerRadioLog,
  FirewallStatus,
  LanInfo,
  Lap,
  ReferenceCaptureStatus,
  Session,
  SessionDetail,
  StartCaptureRequest,
  Track,
  TrackRecognition,
  ViewId,
} from '@gt7/shared';
import { PRODUCT_NAME } from '@gt7/shared';
import { t as uiText } from '../lib/i18n.ts';
import type { TracksOverview } from './lib/history.ts';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Server unreachable (network error / proxy without backend). */
  get offline(): boolean {
    return this.code === 'offline';
  }
}

export const OFFLINE_MESSAGE =
  `Não foi possível falar com o servidor do ${PRODUCT_NAME}. Confira se ele está rodando ` +
  '(npm start ou npm run demo) e se este aparelho está na mesma rede.';

const STATUS_MESSAGES: Record<number, string> = {
  404: 'Não encontrado (o servidor pode ser de uma versão sem este recurso).',
  409: 'Conflito com o estado atual do servidor.',
  500: 'Erro interno do servidor.',
  502: OFFLINE_MESSAGE,
  503: 'Servidor indisponível no momento.',
  504: OFFLINE_MESSAGE,
};

/** Turns a non-2xx response into an ApiError (reads `{ error: { code, message } }`). */
export async function errorFromResponse(res: Response): Promise<ApiError> {
  let code = `http${res.status}`;
  let message = STATUS_MESSAGES[res.status] ?? uiText('Erro {0} do servidor.', res.status);
  try {
    const text = await res.text();
    if (text) {
      const body = JSON.parse(text) as Partial<ApiErrorBody>;
      if (body.error?.message) message = body.error.message;
      if (body.error?.code) code = body.error.code;
    } else if (res.status === 502 || res.status === 504) {
      code = 'offline';
    }
  } catch {
    // Vite's proxy answers 500 with an empty/HTML body when the backend is down.
    if (res.status >= 500) code = res.status === 500 ? 'http500' : 'offline';
  }
  return new ApiError(message, res.status, code);
}

export async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(OFFLINE_MESSAGE, 0, 'offline');
  }
  if (!res.ok) throw await errorFromResponse(res);
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    // HTML fallback page instead of JSON: the backend is not answering /api.
    throw new ApiError(OFFLINE_MESSAGE, res.status, 'offline');
  }
}

export const get = <T>(path: string, signal?: AbortSignal) =>
  request<T>('GET', path, undefined, signal);

const enc = encodeURIComponent;

function qs(q: Record<string, string | number | boolean | null | undefined>): string {
  const parts = Object.entries(q)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${enc(k)}=${enc(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

// ---------------------------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------------------------

export const api = {
  status: () => get<ApiStatus>('/api/status'),
  settings: () => get<ApiSettings>('/api/settings'),
  patchSettings: (p: ApiSettingsPatch) => request<ApiSettings>('PATCH', '/api/settings', p),
  /** Restarts the console search ('Procurar de novo'). */
  discoveryScan: () => request<ApiDiscoveryScanResult>('POST', '/api/discovery/scan'),
  firewallCheck: () => request<FirewallStatus>('POST', '/api/firewall/check'),
  lan: () => get<LanInfo>('/api/lan'),
  devices: () => get<DeviceInfo[]>('/api/devices'),
  showView: (deviceId: string, view: ViewId, from: string) =>
    request<{ ok: true; delivered: number }>('POST', `/api/devices/${enc(deviceId)}/show-view`, {
      view,
      from,
    }),

  sessions: (q: { trackId?: string; carCode?: number; mode?: string; limit?: number } = {}) =>
    get<Session[]>(`/api/sessions${qs({ limit: 500, ...q })}`),
  session: (id: string) => get<SessionDetail>(`/api/sessions/${enc(id)}`),
  deleteSession: (id: string) => request<{ ok: true }>('DELETE', `/api/sessions/${enc(id)}`),
  lap: (id: string) => get<Lap>(`/api/laps/${enc(id)}`),
  engineerRadio: (id: string) => get<EngineerRadioLog[]>(`/api/laps/${enc(id)}/engineer-radio`),
  saveEngineerRadio: (id: string, log: EngineerRadioLog) =>
    request<{ ok: true }>('PUT', `/api/laps/${enc(id)}/engineer-radio`, log),
  trackLaps: (
    trackId: string,
    q: {
      carCode?: number;
      validOnly?: boolean;
      references?: 'include' | 'exclude' | 'only';
      orderBy?: 'time' | 'startedAt';
      limit?: number;
    } = {},
  ) => get<Lap[]>(`/api/laps${qs({ trackId, ...q })}`),
  deleteLap: (id: string) => request<{ ok: true }>('DELETE', `/api/laps/${enc(id)}`),
  setReference: (
    id: string,
    meta: {
      driverName?: string;
      rankingTimeMs?: number;
      carName?: string | null;
      notes?: string | null;
    },
  ) => request<Lap>('PUT', `/api/laps/${enc(id)}/reference`, meta),
  unsetReference: (id: string) => request<Lap>('DELETE', `/api/laps/${enc(id)}/reference`),
  references: (trackId?: string) => get<Lap[]>(`/api/references${qs({ trackId })}`),

  tracks: () => get<Track[]>('/api/tracks'),
  track: (id: string) => get<Track>(`/api/tracks/${enc(id)}`),
  renameTrack: (id: string, name: string) =>
    request<Track>('PATCH', `/api/tracks/${enc(id)}`, { name }),
  /** Names a track (and its layout). The server marks the name as confirmed by the user. */
  nameTrack: (id: string, name: string, layout: string | null) =>
    request<Track>('PATCH', `/api/tracks/${enc(id)}`, { name, layout }),
  tracksOverview: () => get<TracksOverview>('/api/tracks/overview'),
  /** Official layouts that look like this track (driving line first, length as fallback). */
  trackRecognition: (id: string) => get<TrackRecognition>(`/api/tracks/${enc(id)}/recognition`),
  patchCorner: (
    trackId: string,
    cornerId: string,
    p: { name?: string | null; brakeMarkerNote?: string | null },
  ) => request<Track>('PATCH', `/api/tracks/${enc(trackId)}/corners/${enc(cornerId)}`, p),
  setSectorCount: (trackId: string, count: number) =>
    request<Track>('PUT', `/api/tracks/${enc(trackId)}/sectors`, { count }),
  redetectCorners: (trackId: string) =>
    request<ApiRedetectCornersResult>('POST', `/api/tracks/${enc(trackId)}/redetect-corners`),

  trackAnalysis: (trackId: string) => get<ApiTrackAnalysis>(`/api/analysis/tracks/${enc(trackId)}`),
  lapAnalysis: (lapId: string) => get<ApiLapAnalysis>(`/api/analysis/laps/${enc(lapId)}`),
  lapEvents: (lapId: string) => get<ApiLapDrivingEvents>(`/api/analysis/laps/${enc(lapId)}/events`),
  compare: (lap: string, ref: string) =>
    get<ApiComparison>(`/api/analysis/compare${qs({ lap, ref, topN: 20 })}`),
  traces: (laps: string[], channels: readonly string[], ref?: string, maxPoints = 2500) =>
    get<ApiTraces>(
      `/api/analysis/traces${qs({ laps: laps.join(','), channels: channels.join(','), stepM: 2, maxPoints, ref })}`,
    ),
  microsectors: (laps: string[], ref?: string) =>
    get<ApiMicrosectors>(`/api/analysis/microsectors${qs({ laps: laps.join(','), ref })}`),
  consistency: (sessionId: string) =>
    get<ApiConsistency>(`/api/analysis/consistency${qs({ sessionId })}`),
  evolution: (trackId: string, carCode?: number) =>
    get<ApiEvolution>(`/api/analysis/evolution${qs({ trackId, carCode })}`),

  capture: () => get<ReferenceCaptureStatus>('/api/capture'),
  startCapture: (b: StartCaptureRequest) =>
    request<ReferenceCaptureStatus>('POST', '/api/capture/start', b),
  stopCapture: (save: boolean) =>
    request<ReferenceCaptureStatus>('POST', '/api/capture/stop', { save }),

  mcpInfo: () => get<ApiMcpInfo>('/api/mcp/info'),
  dataSummary: () => get<ApiDataSummary>('/api/data/summary'),
  /** Address that downloads a `.bono` backup (a plain link: the browser streams it to disk). */
  dataExportUrl: (o: { laps: boolean; settings: boolean; recordings: boolean }) =>
    `/api/data/export?laps=${o.laps ? 1 : 0}&settings=${o.settings ? 1 : 0}&recordings=${o.recordings ? 1 : 0}`,
  /** Sends the chosen `.bono` file as it is; the server checks it and says what is inside. */
  dataImportUpload: async (file: File): Promise<ApiBackupUpload> => {
    let res: Response;
    try {
      res = await fetch('/api/data/import', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', accept: 'application/json' },
        body: file,
      });
    } catch {
      throw new ApiError(OFFLINE_MESSAGE, 0, 'offline');
    }
    if (!res.ok) throw await errorFromResponse(res);
    return (await res.json()) as ApiBackupUpload;
  },
  dataImportApply: (id: string, body: { mode: ApiImportMode; settings: boolean }) =>
    request<ApiImportResult>('POST', `/api/data/import/${encodeURIComponent(id)}/apply`, body),
  dataImportDiscard: (id: string) =>
    request<void>('DELETE', `/api/data/import/${encodeURIComponent(id)}`),
  coachConfig: () => get<CoachConfig>('/api/coach/config'),
  putCoachConfig: (p: CoachConfigPatch) => request<CoachConfig>('PUT', '/api/coach/config', p),
  coachReports: (limit = 50) => get<CoachReportSummary[]>(`/api/coach/reports${qs({ limit })}`),
  coachReport: (id: string) => get<CoachReport>(`/api/coach/reports/${enc(id)}`),
  deleteCoachReport: (id: string) =>
    request<{ ok: true }>('DELETE', `/api/coach/reports/${enc(id)}`),
};

/** Download / image URLs (opened by the browser, not fetched). */
export const urls = {
  lapCsv: (id: string) => `/api/laps/${enc(id)}/export.csv`,
  lapTrace: (id: string) => `/api/laps/${enc(id)}/trace?download=1`,
  recording: (sessionId: string) => `/api/recordings/${enc(sessionId)}`,
  chartPng: (lap: string, ref: string, corner?: string) =>
    `/api/analysis/chart.png${qs({ lap, ref, corner })}`,
};
