/** Localized labels for codes from the server and analysis engine. */

import {
  type CaptureState,
  type CaptureWaiting,
  type ComparisonReferenceKind,
  type CornerKind,
  carName,
  type DrivingEventKind,
  type DrivingEventPhase,
  type FindingConfidence,
  type LapFlag,
  type PacketFormat,
  type SessionMode,
} from '@gt7/shared';
import { getLanguage, t as uiText } from '../../lib/i18n.ts';

export const SESSION_MODE_LABELS: Record<SessionMode, string> = {
  get live() {
    return uiText('Ao vivo');
  },
  get replayCapture() {
    return uiText('Captura de replay');
  },
};

export const LAP_FLAG_LABELS: Record<LapFlag, string> = {
  get incompleteData() {
    return uiText('dados incompletos');
  },
  get paused() {
    return uiText('pausa');
  },
  get outLap() {
    return uiText('volta de saída');
  },
  get inLap() {
    return uiText('volta de entrada');
  },
  get offTrack() {
    return uiText('fora da pista');
  },
  get timeMismatch() {
    return uiText('tempo divergente');
  },
  get replay() {
    return uiText('replay');
  },
  get discontinuity() {
    return uiText('salto nos dados');
  },
};

/** Flags that only mark (do not make the lap invalid). */
export const INFO_FLAGS: ReadonlySet<LapFlag> = new Set<LapFlag>(['replay', 'timeMismatch']);

export const CORNER_KIND_LABELS: Record<CornerKind, string> = {
  get hairpin() {
    return uiText('grampo');
  },
  get slow() {
    return uiText('lenta');
  },
  get medium() {
    return uiText('média');
  },
  get fast() {
    return uiText('rápida');
  },
  kink: 'kink',
  chicane: 'chicane',
};

export const CONFIDENCE_LABELS: Record<FindingConfidence, string> = {
  get high() {
    return uiText('Confiança alta');
  },
  get medium() {
    return uiText('Confiança média');
  },
  get low() {
    return uiText('Confiança baixa');
  },
};

export const DRIVING_EVENT_LABELS: Record<DrivingEventKind, string> = {
  get understeer() {
    return uiText('Saída de frente');
  },
  get oversteer() {
    return uiText('Saída de traseira');
  },
  get frontLock() {
    return uiText('Travamento dianteiro');
  },
  get exitTraction() {
    return uiText('Perda de tração na saída');
  },
};

export const DRIVING_EVENT_PHASE_LABELS: Record<DrivingEventPhase, string> = {
  get braking() {
    return uiText('freada');
  },
  get entry() {
    return uiText('entrada');
  },
  get mid() {
    return uiText('meio da curva');
  },
  get exit() {
    return uiText('saída da curva');
  },
};

export const REFERENCE_KIND_LABELS: Record<ComparisonReferenceKind | 'lap', string> = {
  get auto() {
    return uiText('Automática (top → melhor pessoal → sessão)');
  },
  get personalBest() {
    return uiText('Melhor pessoal');
  },
  get sessionBest() {
    return uiText('Melhor da sessão');
  },
  get bestReference() {
    return uiText('Melhor referência top');
  },
  get lap() {
    return uiText('Volta escolhida');
  },
};

export const CAPTURE_STATE_LABELS: Record<CaptureState, string> = {
  get idle() {
    return uiText('Parado');
  },
  get switchingFormat() {
    return uiText('Preparando a captura…');
  },
  get waitingLapStart() {
    return uiText('Aguardando a linha de largada');
  },
  get recording() {
    return uiText('Gravando a volta…');
  },
  get validating() {
    return uiText('Validando a volta…');
  },
};

/** Short headline for the same states. */
export const CAPTURE_WAITING_TITLES: Record<CaptureWaiting, string> = {
  get replay() {
    return uiText('Aguardando o replay');
  },
  get track() {
    return uiText('Identificando a pista');
  },
  get unknownTrack() {
    return uiText('Pista desconhecida');
  },
  get startLine() {
    return uiText('Aguardando a linha de largada');
  },
};

/** What a capture in `waitingLapStart` is waiting for (ReferenceCaptureStatus.waiting). */
export const CAPTURE_WAITING_LABELS: Record<CaptureWaiting, string> = {
  get replay() {
    return uiText('Aguardando o replay: abra o replay da volta no jogo e dê play.');
  },
  get track() {
    return uiText('Replay detectado — identificando a pista…');
  },
  get unknownTrack() {
    return uiText(
      'Pista desconhecida — dirija essa pista ao vivo primeiro (uma volta completa) e depois capture o replay.',
    );
  },
  get startLine() {
    return uiText('Replay detectado — aguardando o carro cruzar a linha de largada.');
  },
};

/** Validation issue codes of the reference capture (core/capture/reference-capture.ts). */
export const CAPTURE_ISSUE_LABELS: Record<string, string> = {
  paused: 'O replay foi pausado durante a volta.',
  get discontinuity() {
    return uiText('Houve um salto no replay (avanço, retrocesso ou troca de câmera/carro).');
  },
  get packetGaps() {
    return uiText('Pacotes perdidos demais (Wi-Fi instável?): a volta ficou com buracos.');
  },
  get lengthMismatch() {
    return uiText(
      'O comprimento da volta não bate com a pista (volta incompleta ou pista errada).',
    );
  },
  get timeMismatch() {
    return uiText(
      'O tempo medido pelos pacotes não bate com o tempo do ranking digitado (tolerância ±0,3 s).',
    );
  },
  get carMismatch() {
    return uiText('O carro do replay é diferente do carro esperado.');
  },
  get notRealtime() {
    return uiText(
      'O replay não estava em velocidade 1× (use a velocidade normal, sem câmera lenta).',
    );
  },
  interrupted: 'O replay foi interrompido antes de a volta fechar.',
  get enterFailed() {
    return uiText('Não foi possível preparar a captura.');
  },
};

export function captureIssueLabel(code: string): string {
  return CAPTURE_ISSUE_LABELS[code] ?? uiText('Problema na validação ({0}).', code);
}

export const PACKET_FORMAT_INFO: Record<PacketFormat, { label: string; text: string }> = {
  A: {
    get label() {
      return uiText('A (básico)');
    },
    get text() {
      return uiText('Pacote original: sem volante nem pedais crus. Use só se os outros falharem.');
    },
  },
  B: {
    label: 'B',
    get text() {
      return uiText('Acrescenta volante e forças G.');
    },
  },
  '~': {
    get label() {
      return uiText('~ (recomendado ao vivo)');
    },
    get text() {
      return uiText(
        'O mais completo (acelerador/freio crus, volante). Também entrega os dados do replay.',
      );
    },
  },
  C: {
    get label() {
      return uiText('C (experimental)');
    },
    get text() {
      return uiText('Inclui superfície (asfalto/zebra/grama). Ainda não verificado no console.');
    },
  },
};

/** MCP tool name → what the coach is doing (pt-BR, gerund). */
export const COACH_TOOL_LABELS: Record<string, string> = {
  get list_tracks() {
    return uiText('Listando pistas');
  },
  get get_track() {
    return uiText('Lendo a pista');
  },
  get list_sessions() {
    return uiText('Listando sessões');
  },
  get list_laps() {
    return uiText('Listando voltas');
  },
  get list_reference_laps() {
    return uiText('Buscando referências do top');
  },
  get get_lap_summary() {
    return uiText('Resumindo a volta');
  },
  get compare_laps() {
    return uiText('Comparando voltas');
  },
  get get_corner_detail() {
    return uiText('Olhando a curva de perto');
  },
  get get_consistency() {
    return uiText('Medindo a consistência');
  },
  get get_microsectors() {
    return uiText('Calculando microssetores');
  },
  get get_trace() {
    return uiText('Lendo os traces');
  },
  get get_evolution() {
    return uiText('Consultando a evolução');
  },
  get render_comparison_chart() {
    return uiText('Gerando o gráfico');
  },
  get get_live_state() {
    return uiText('Lendo o estado ao vivo');
  },
  get get_knowledge() {
    return uiText('Consultando a base de pilotagem');
  },
};

export function coachToolLabel(name: string): string {
  return COACH_TOOL_LABELS[name] ?? uiText('Usando {0}', name);
}

/**
 * Car as text: the catalogue name; else the name given by the caller (reference metadata); else
 * "Carro #1234" (cars missing from the catalogue, e.g. new DLC, still work everywhere).
 */
export function carLabel(carCode: number | null | undefined, name?: string | null): string {
  if (carCode === null || carCode === undefined) return name || '—';
  return carName(carCode) ?? (name || uiText('Carro #{0}', carCode));
}

const dateOptions: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString(getLanguage(), dateOptions);
}

export function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(y, m - 1, d).toLocaleDateString(getLanguage(), {
    day: '2-digit',
    month: 'short',
  });
}

/** "há 3 min" style relative time. */
export function formatAgo(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return '—';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 10) return uiText('agora');
  if (s < 60) return uiText('há {0} s', s);
  const m = Math.round(s / 60);
  if (m < 60) return uiText('há {0} min', m);
  const h = Math.round(m / 60);
  if (h < 48) return uiText('há {0} h', h);
  return uiText('há {0} dias', Math.round(h / 24));
}
