/** pt-BR labels of the analysis area (codes from the server/core → text). */

import {
  type CaptureState,
  type ComparisonReferenceKind,
  type CornerKind,
  carName,
  type FindingConfidence,
  type LapFlag,
  type PacketFormat,
  type SessionMode,
} from '@gt7/shared';

export const SESSION_MODE_LABELS: Record<SessionMode, string> = {
  live: 'Ao vivo',
  replayCapture: 'Captura de replay',
};

export const LAP_FLAG_LABELS: Record<LapFlag, string> = {
  incompleteData: 'dados incompletos',
  paused: 'pausa',
  outLap: 'volta de saída',
  inLap: 'volta de entrada',
  offTrack: 'fora da pista',
  timeMismatch: 'tempo divergente',
  replay: 'replay',
  discontinuity: 'salto nos dados',
};

/** Flags that only mark (do not make the lap invalid). */
export const INFO_FLAGS: ReadonlySet<LapFlag> = new Set<LapFlag>(['replay', 'timeMismatch']);

export const CORNER_KIND_LABELS: Record<CornerKind, string> = {
  hairpin: 'grampo',
  slow: 'lenta',
  medium: 'média',
  fast: 'rápida',
  kink: 'kink',
  chicane: 'chicane',
};

export const CONFIDENCE_LABELS: Record<FindingConfidence, string> = {
  high: 'Confiança alta',
  medium: 'Confiança média',
  low: 'Confiança baixa',
};

export const REFERENCE_KIND_LABELS: Record<ComparisonReferenceKind | 'lap', string> = {
  auto: 'Automática (top → melhor pessoal → sessão)',
  personalBest: 'Melhor pessoal',
  sessionBest: 'Melhor da sessão',
  bestReference: 'Melhor referência top',
  lap: 'Volta escolhida',
};

export const CAPTURE_STATE_LABELS: Record<CaptureState, string> = {
  idle: 'Parado',
  switchingFormat: 'Trocando o formato do pacote (até ~15 s)…',
  waitingLapStart: 'Aguardando o início da volta: deixe o replay cruzar a linha de chegada',
  recording: 'Gravando a volta…',
  validating: 'Validando a volta…',
};

/** Validation issue codes of the reference capture (core/capture/reference-capture.ts). */
export const CAPTURE_ISSUE_LABELS: Record<string, string> = {
  paused: 'O replay foi pausado durante a volta.',
  discontinuity: 'Houve um salto no replay (avanço, retrocesso ou troca de câmera/carro).',
  packetGaps: 'Pacotes perdidos demais (Wi-Fi instável?): a volta ficou com buracos.',
  lengthMismatch: 'O comprimento da volta não bate com a pista (volta incompleta ou pista errada).',
  timeMismatch: 'O tempo medido não bate com o tempo do ranking informado (±0,3 s).',
  carMismatch: 'O carro do replay é diferente do carro esperado.',
  enterFailed: 'Não foi possível entrar no modo de captura (troca de formato falhou).',
};

export function captureIssueLabel(code: string): string {
  return CAPTURE_ISSUE_LABELS[code] ?? `Problema na validação (${code}).`;
}

export const PACKET_FORMAT_INFO: Record<PacketFormat, { label: string; text: string }> = {
  A: {
    label: 'A (básico)',
    text: 'Pacote original: sem volante nem pedais crus. Use só se os outros falharem.',
  },
  B: {
    label: 'B',
    text: 'Acrescenta volante e forças G. Funciona em replays: é o formato da captura de referência.',
  },
  '~': {
    label: '~ (recomendado ao vivo)',
    text: 'O mais completo ao vivo (acelerador/freio crus, volante). Não funciona em replays.',
  },
  C: {
    label: 'C (experimental)',
    text: 'Inclui superfície (asfalto/zebra/grama). Ainda não verificado no console.',
  },
};

/** MCP tool name → what the coach is doing (pt-BR, gerund). */
export const COACH_TOOL_LABELS: Record<string, string> = {
  list_tracks: 'Listando pistas',
  get_track: 'Lendo a pista',
  list_sessions: 'Listando sessões',
  list_laps: 'Listando voltas',
  list_reference_laps: 'Buscando referências do top',
  get_lap_summary: 'Resumindo a volta',
  compare_laps: 'Comparando voltas',
  get_corner_detail: 'Olhando a curva de perto',
  get_consistency: 'Medindo a consistência',
  get_microsectors: 'Calculando microssetores',
  get_trace: 'Lendo os traces',
  get_evolution: 'Consultando a evolução',
  render_comparison_chart: 'Gerando o gráfico',
  get_live_state: 'Lendo o estado ao vivo',
};

export function coachToolLabel(name: string): string {
  return COACH_TOOL_LABELS[name] ?? `Usando ${name}`;
}

/**
 * Car as text: the catalogue name; else the name given by the caller (reference metadata); else
 * "Carro #1234" (cars missing from the catalogue, e.g. new DLC, still work everywhere).
 */
export function carLabel(carCode: number | null | undefined, name?: string | null): string {
  if (carCode === null || carCode === undefined) return name || '—';
  return carName(carCode) ?? (name || `Carro #${carCode}`);
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const dayFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '—';
  return dateFmt.format(new Date(ms));
}

export function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return dayFmt.format(new Date(y, m - 1, d));
}

/** "há 3 min" style relative time. */
export function formatAgo(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return '—';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 10) return 'agora';
  if (s < 60) return `há ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}
