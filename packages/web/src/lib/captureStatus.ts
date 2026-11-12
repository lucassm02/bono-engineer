/**
 * Automatic session capture, as the UI shows it: one short label, a tone and the full pt-BR
 * sentence the server sends (`ServerStatus.sessionCapture.hint`). Pure, so it is easy to test.
 */

import type {
  ReferenceCaptureStatus,
  SessionCaptureStatus,
  SessionSavedMessage,
} from '@gt7/shared';
import { formatLapTime } from './format.ts';
import { t as uiText } from './i18n.ts';

export type CaptureTone = 'ok' | 'warn' | 'info' | 'idle' | 'off';

export interface CaptureView {
  tone: CaptureTone;
  /** Short text for the chip. */
  label: string;
  /** Full sentence (tooltip / screen readers). */
  title: string;
  /** The dot pulses (a session is being recorded). */
  pulse: boolean;
  /** There is an open, saved session to link to. */
  sessionId: string | null;
  /** A reference capture is armed: the chip leads to the capture page. */
  reference?: boolean;
}

const lapsText = (n: number) => `${n} ${n === 1 ? 'volta' : 'voltas'}`;

/** null (server without the field, or no server) → nothing to show. */
export function describeCapture(c: SessionCaptureStatus | null | undefined): CaptureView | null {
  if (!c) return null;
  const sessionId = c.enabled ? c.sessionId : null;
  const title = c.hint || uiText('Captura automática de sessões');
  switch (c.state) {
    case 'recording':
      return {
        tone: 'ok',
        label: c.lapsDone > 0 ? uiText('Gravando · {0}', lapsText(c.lapsDone)) : uiText('Gravando'),
        title,
        pulse: true,
        sessionId,
      };
    case 'paused': {
      const label =
        c.detail === 'offTrack'
          ? uiText('Fora da pista')
          : c.detail === 'noSignal'
            ? uiText('Sem sinal')
            : uiText('Pausado');
      return { tone: 'warn', label, title, pulse: false, sessionId };
    }
    case 'waiting':
      return {
        tone: 'idle',
        label: uiText('Aguardando pista'),
        title,
        pulse: false,
        sessionId: null,
      };
    case 'replay':
      return {
        tone: 'info',
        label: uiText('Replay detectado'),
        title,
        pulse: false,
        sessionId: null,
      };
    default:
      return {
        tone: 'off',
        label: c.enabled ? uiText('Captura parada') : uiText('Gravação desligada'),
        title,
        pulse: false,
        sessionId: null,
      };
  }
}

/** m:ss of a short span ("0:45"). */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Reference (replay) capture armed by the user: progress of the capture as a chip — waiting for the
 * replay / the start line, recording the lap (0:45), validating. null when no capture is running.
 */
export function describeReferenceCapture(
  r: ReferenceCaptureStatus | null | undefined,
): CaptureView | null {
  if (!r || r.state === 'idle') return null;
  const title = r.hint || uiText('Gravação da volta de replay em andamento');
  const base = { title, pulse: false, sessionId: null, reference: true } as const;
  switch (r.state) {
    case 'recording':
      return {
        ...base,
        tone: 'ok',
        label: uiText('Capturando · gravando volta {0}', clockText(r.recordingMs ?? 0)),
        pulse: true,
      };
    case 'validating':
      return { ...base, tone: 'info', label: uiText('Capturando · validando') };
    case 'waitingLapStart':
      switch (r.waiting) {
        case 'startLine':
          return {
            ...base,
            tone: 'info',
            label: uiText('Capturando · aguardando linha de largada'),
          };
        case 'track':
          return { ...base, tone: 'info', label: uiText('Capturando · identificando a pista') };
        case 'unknownTrack':
          return { ...base, tone: 'warn', label: uiText('Capturando · pista desconhecida') };
        default:
          return { ...base, tone: 'idle', label: uiText('Capturando · aguardando o replay') };
      }
    default:
      return { ...base, tone: 'idle', label: uiText('Preparando a captura') };
  }
}

/** "Sessão salva: Pista X, 5 voltas, melhor 1:23,456" (the "ver" link is drawn by the toast). */
export function savedToastText(
  m: Pick<SessionSavedMessage, 'trackName' | 'lapCount' | 'bestLapMs'>,
): string {
  const parts = [m.trackName ?? uiText('pista não identificada'), lapsText(m.lapCount)];
  if (m.bestLapMs !== null && m.bestLapMs > 0) parts.push(`melhor ${formatLapTime(m.bestLapMs)}`);
  return uiText('Sessão salva: {0}', parts.join(', '));
}
