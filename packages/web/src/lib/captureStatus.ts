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
  const title = c.hint || 'Captura automática de sessões';
  switch (c.state) {
    case 'recording':
      return {
        tone: 'ok',
        label: c.lapsDone > 0 ? `Gravando · ${lapsText(c.lapsDone)}` : 'Gravando',
        title,
        pulse: true,
        sessionId,
      };
    case 'paused': {
      const label =
        c.detail === 'offTrack'
          ? 'Fora da pista'
          : c.detail === 'noSignal'
            ? 'Sem sinal'
            : 'Pausado';
      return { tone: 'warn', label, title, pulse: false, sessionId };
    }
    case 'waiting':
      return { tone: 'idle', label: 'Aguardando pista', title, pulse: false, sessionId: null };
    case 'replay':
      return {
        tone: 'info',
        label: 'Replay detectado',
        title,
        pulse: false,
        sessionId: null,
      };
    default:
      return {
        tone: 'off',
        label: c.enabled ? 'Captura parada' : 'Gravação desligada',
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
  const title = r.hint || 'Captura de referência em andamento';
  const base = { title, pulse: false, sessionId: null, reference: true } as const;
  switch (r.state) {
    case 'recording':
      return {
        ...base,
        tone: 'ok',
        label: `Capturando · gravando volta ${clockText(r.recordingMs ?? 0)}`,
        pulse: true,
      };
    case 'validating':
      return { ...base, tone: 'info', label: 'Capturando · validando' };
    case 'waitingLapStart':
      switch (r.waiting) {
        case 'startLine':
          return { ...base, tone: 'info', label: 'Capturando · aguardando linha de largada' };
        case 'track':
          return { ...base, tone: 'info', label: 'Capturando · identificando a pista' };
        case 'unknownTrack':
          return { ...base, tone: 'warn', label: 'Capturando · pista desconhecida' };
        default:
          return { ...base, tone: 'idle', label: 'Capturando · aguardando o replay' };
      }
    default:
      return { ...base, tone: 'idle', label: 'Preparando a captura' };
  }
}

/** "Sessão salva: Pista X, 5 voltas, melhor 1:23,456" (the "ver" link is drawn by the toast). */
export function savedToastText(
  m: Pick<SessionSavedMessage, 'trackName' | 'lapCount' | 'bestLapMs'>,
): string {
  const parts = [m.trackName ?? 'pista não identificada', lapsText(m.lapCount)];
  if (m.bestLapMs !== null && m.bestLapMs > 0) parts.push(`melhor ${formatLapTime(m.bestLapMs)}`);
  return `Sessão salva: ${parts.join(', ')}`;
}
