import type { ReferenceCaptureStatus, SessionCaptureStatus } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import {
  clockText,
  describeCapture,
  describeReferenceCapture,
  savedToastText,
} from './captureStatus.ts';

const base: SessionCaptureStatus = {
  state: 'waiting',
  enabled: true,
  sessionId: null,
  since: null,
  lapsDone: 0,
  carCode: null,
  trackName: null,
  bestLapMs: null,
  trackTimeMs: 0,
  hint: 'Aguardando você entrar numa pista…',
};

describe('describeCapture', () => {
  it('hides when the server sends nothing', () => {
    expect(describeCapture(null)).toBeNull();
    expect(describeCapture(undefined)).toBeNull();
  });

  it('waiting is quiet and keeps the server sentence as the tooltip', () => {
    expect(describeCapture(base)).toEqual({
      tone: 'idle',
      label: 'Aguardando pista',
      title: 'Aguardando você entrar numa pista…',
      pulse: false,
      sessionId: null,
    });
  });

  it('recording pulses, counts laps in pt-BR and links to the open session', () => {
    const rec = { ...base, state: 'recording' as const, sessionId: 's1', hint: 'Gravando sessão' };
    expect(describeCapture(rec)).toMatchObject({
      tone: 'ok',
      label: 'Gravando',
      pulse: true,
      sessionId: 's1',
    });
    expect(describeCapture({ ...rec, lapsDone: 1 })?.label).toBe('Gravando · 1 volta');
    expect(describeCapture({ ...rec, lapsDone: 4 })?.label).toBe('Gravando · 4 voltas');
  });

  it('paused says why, and still links to the session', () => {
    const p = { ...base, state: 'paused' as const, sessionId: 's1' };
    expect(describeCapture({ ...p, detail: 'paused' })?.label).toBe('Pausado');
    expect(describeCapture({ ...p, detail: 'offTrack' })?.label).toBe('Fora da pista');
    expect(describeCapture({ ...p, detail: 'noSignal' })?.label).toBe('Sem sinal');
    expect(describeCapture({ ...p, detail: 'paused' })?.sessionId).toBe('s1');
    expect(describeCapture({ ...p, detail: 'paused' })?.pulse).toBe(false);
  });

  it('replay and switched-off are explicit and never link', () => {
    expect(describeCapture({ ...base, state: 'replay' })).toMatchObject({
      tone: 'info',
      label: 'Replay detectado',
      sessionId: null,
    });
    const off = describeCapture({ ...base, state: 'idle', enabled: false, sessionId: 'x' });
    expect(off).toMatchObject({ tone: 'off', label: 'Gravação desligada', sessionId: null });
    expect(describeCapture({ ...base, state: 'idle' })?.label).toBe('Captura parada');
  });
});

describe('savedToastText', () => {
  it('names the track, laps and best time', () => {
    expect(savedToastText({ trackName: 'Interlagos', lapCount: 5, bestLapMs: 83_456 })).toBe(
      'Sessão salva: Interlagos, 5 voltas, melhor 1:23,456',
    );
  });
  it('copes with an unknown track, one lap and no valid time', () => {
    expect(savedToastText({ trackName: null, lapCount: 1, bestLapMs: null })).toBe(
      'Sessão salva: pista não identificada, 1 volta',
    );
  });
});

describe('describeReferenceCapture (armed capture progress)', () => {
  const ref: ReferenceCaptureStatus = {
    state: 'waitingLapStart',
    driverName: 'X',
    lapId: null,
    issues: [],
    waiting: 'replay',
    hint: 'Aguardando o replay.',
  };

  it('shows nothing when no capture is running', () => {
    expect(describeReferenceCapture(null)).toBeNull();
    expect(describeReferenceCapture({ ...ref, state: 'idle' })).toBeNull();
  });

  it('follows waiting for the replay → track → start line → recording → validating', () => {
    expect(describeReferenceCapture(ref)).toMatchObject({
      label: 'Capturando · aguardando o replay',
      reference: true,
      sessionId: null,
    });
    expect(describeReferenceCapture({ ...ref, waiting: 'track' })?.label).toMatch(/identificando/);
    expect(describeReferenceCapture({ ...ref, waiting: 'startLine' })?.label).toBe(
      'Capturando · aguardando linha de largada',
    );
    expect(describeReferenceCapture({ ...ref, waiting: 'unknownTrack' })).toMatchObject({
      tone: 'warn',
      label: 'Capturando · pista desconhecida',
    });
    expect(
      describeReferenceCapture({ ...ref, state: 'recording', recordingMs: 45_300 }),
    ).toMatchObject({ tone: 'ok', pulse: true, label: 'Capturando · gravando volta 0:45' });
    expect(describeReferenceCapture({ ...ref, state: 'validating' })?.label).toBe(
      'Capturando · validando',
    );
  });

  it('formats short spans as m:ss', () => {
    expect(clockText(0)).toBe('0:00');
    expect(clockText(65_900)).toBe('1:05');
  });
});
