import { EMPTY_TRACK_CONTEXT, type LiveTrackContext } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import type { TrackOverview } from '../analysis/lib/history.ts';
import {
  barTrackView,
  demoPromptsAllowed,
  guideVisibility,
  isDemoSource,
  isSafeToPrompt,
  menuCardVisible,
  mismatchText,
  OPEN_CHIP_MS,
  openChipWanted,
  type PromptGate,
  pickerEntries,
  recentEntries,
  referenceNote,
  trackPromptAllowed,
} from './liveContext.ts';

const gate: PromptGate = {
  demo: false,
  demoAllowed: false,
  replay: false,
  askOnStart: true,
  savedTracks: 3,
  skipped: false,
  hasHint: false,
};

function track(id: string, patch: Partial<TrackOverview> = {}): TrackOverview {
  return {
    id,
    name: `Pista ${id}`,
    layout: null,
    lengthM: 5000,
    source: 'user',
    needsName: false,
    createdAt: 1,
    thumb: null,
    sessionCount: 1,
    lapCount: 4,
    validLapCount: 4,
    lastActivityAt: 1000,
    best: null,
    cars: [],
    referenceCount: 0,
    bestReferenceMs: null,
    trend: { kind: 'none', deltaMs: null, carCode: null },
    ...patch,
  };
}

const ctx = (patch: Partial<LiveTrackContext>): LiveTrackContext => ({
  ...EMPTY_TRACK_CONTEXT,
  ...patch,
});

describe('isSafeToPrompt: bloqueio por velocidade', () => {
  it('com o carro andando nunca é seguro', () => {
    expect(isSafeToPrompt({ state: 'onTrack', speedKmh: 10 })).toBe(false);
    expect(isSafeToPrompt({ state: 'onTrack', speedKmh: 187 })).toBe(false);
  });
  it('parado (< 10 km/h) é seguro', () => {
    expect(isSafeToPrompt({ state: 'onTrack', speedKmh: 0 })).toBe(true);
    expect(isSafeToPrompt({ state: 'onTrack', speedKmh: 9.9 })).toBe(true);
  });
  it('pausa e menu são seguros, qualquer que seja a velocidade do último pacote', () => {
    expect(isSafeToPrompt({ state: 'paused', speedKmh: 200 })).toBe(true);
    expect(isSafeToPrompt({ state: 'menu', speedKmh: 200 })).toBe(true);
  });
  it('sem dados nada se move', () => {
    expect(isSafeToPrompt({ state: null, speedKmh: null })).toBe(true);
    expect(isSafeToPrompt({ state: 'disconnected', speedKmh: null })).toBe(true);
  });
});

describe('quando perguntar (spec 06)', () => {
  it('pergunta quando há pista salva, a opção está ligada e nada foi pulado', () => {
    expect(trackPromptAllowed(gate)).toBe(true);
    expect(menuCardVisible(gate)).toBe(true);
  });
  it('nunca pergunta sem pista salva, com a opção desligada ou depois de "Reconhecer sozinho"', () => {
    expect(trackPromptAllowed({ ...gate, savedTracks: 0 })).toBe(false);
    expect(trackPromptAllowed({ ...gate, askOnStart: false })).toBe(false);
    expect(trackPromptAllowed({ ...gate, skipped: true })).toBe(false);
  });
  it('nunca pergunta na demonstração (a menos que o tour peça) nem em replay', () => {
    expect(trackPromptAllowed({ ...gate, demo: true })).toBe(false);
    expect(trackPromptAllowed({ ...gate, demo: true, demoAllowed: true })).toBe(true);
    expect(trackPromptAllowed({ ...gate, replay: true })).toBe(false);
    expect(isDemoSource('mock', null)).toBe(true);
    expect(isDemoSource('server', { source: 'simulator' })).toBe(true);
    expect(isDemoSource('server', { source: 'manual' })).toBe(false);
    expect(demoPromptsAllowed('?trackprompt=demo')).toBe(true);
    expect(demoPromptsAllowed('?mock=1')).toBe(false);
  });
  it('o cartão do menu some depois da escolha (vira resumo)', () => {
    expect(menuCardVisible({ ...gate, hasHint: true })).toBe(false);
    expect(trackPromptAllowed({ ...gate, hasHint: true })).toBe(true);
  });
  it('o chip de abertura só aparece com a pista desconhecida e o carro parado', () => {
    const base = { gate, trackKnown: false, safe: true };
    expect(openChipWanted(base)).toBe(true);
    expect(openChipWanted({ ...base, safe: false })).toBe(false);
    expect(openChipWanted({ ...base, trackKnown: true })).toBe(false);
    expect(openChipWanted({ ...base, gate: { ...gate, hasHint: true } })).toBe(false);
    expect(openChipWanted({ ...base, gate: { ...gate, savedTracks: 0 } })).toBe(false);
    expect(OPEN_CHIP_MS).toBe(8000);
  });
});

describe('barTrackView: pista reconhecida pelo carro de fundo da pré-corrida', () => {
  it('mostra o circuito e o layout, sem pulsar, antes de qualquer volta', () => {
    const v = barTrackView({
      ctx: ctx({
        name: 'Suzuka Circuit',
        layout: 'East Course',
        confidence: 'probable',
        basis: 'path',
      }),
      sessionOpen: false,
      hasSavedTracks: false,
    });
    expect(v.kind).toBe('probable');
    expect(v.label).toContain('Suzuka Circuit · East Course');
    expect(v.pulse).toBe(false);
    expect(v.action).toBeNull();
  });
});

describe('barTrackView: a pista na faixa', () => {
  it('sem sessão e com pistas salvas: "Escolher pista" (toque abre a folha)', () => {
    const v = barTrackView({ ctx: EMPTY_TRACK_CONTEXT, sessionOpen: false, hasSavedTracks: true });
    expect(v).toMatchObject({ kind: 'choose', label: 'Escolher pista', action: 'picker' });
  });
  it('com sessão e nada conhecido: "Reconhecendo a pista…"', () => {
    const v = barTrackView({ ctx: EMPTY_TRACK_CONTEXT, sessionOpen: true, hasSavedTracks: false });
    expect(v).toMatchObject({ kind: 'recognizing', label: 'Reconhecendo a pista…', pulse: true });
    expect(v.action).toBeNull();
  });
  it('palpite do catálogo: "Provavelmente …", sem gravar nada', () => {
    const v = barTrackView({
      ctx: ctx({ name: 'Trial Mountain Circuit', confidence: 'probable', basis: 'catalog' }),
      sessionOpen: true,
      hasSavedTracks: false,
    });
    expect(v.label).toBe('Provavelmente Trial Mountain Circuit');
    expect(v.kind).toBe('probable');
  });
  it('pista escolhida: nome com "escolhida" até a volta confirmar', () => {
    const v = barTrackView({
      ctx: ctx({
        trackId: 't1',
        name: 'Monza',
        confidence: 'probable',
        basis: 'hint',
      }),
      sessionOpen: true,
      hasSavedTracks: true,
    });
    expect(v).toMatchObject({ kind: 'probable', label: 'Monza', note: 'escolhida' });
  });
  it('pista confirmada: o nome, ponto de acento', () => {
    const v = barTrackView({
      ctx: ctx({
        trackId: 't1',
        name: 'Trial Mountain Circuit',
        layout: 'Reverse',
        confidence: 'confirmed',
        basis: 'lap',
        trackSource: 'user',
      }),
      sessionOpen: true,
      hasSavedTracks: true,
    });
    expect(v).toMatchObject({
      kind: 'confirmed',
      label: 'Trial Mountain Circuit',
      note: 'Reverse',
      tone: 'accent',
    });
  });
  it('pista aprendida e sem nome: "Pista nova · Dar nome" com ponto de alerta', () => {
    const v = barTrackView({
      ctx: ctx({
        trackId: 't1',
        name: 'Pista desconhecida 1',
        confidence: 'confirmed',
        basis: 'lap',
        trackSource: 'auto',
        needsName: true,
      }),
      sessionOpen: true,
      hasSavedTracks: true,
    });
    expect(v).toMatchObject({
      kind: 'new',
      label: 'Pista nova',
      note: 'Dar nome',
      tone: 'warn',
      action: 'naming',
    });
  });
});

describe('folha "Pista de hoje": pistas, ordem e referência', () => {
  const car1 = 1111;
  const car2 = 2222;
  const tracks = [
    track('antiga', { lastActivityAt: 100, cars: [carOf(car1, 95_000)] }),
    track('recente', { lastActivityAt: 900, cars: [carOf(car2, 80_000)] }),
    track('meio', {
      name: 'Suzuka',
      lastActivityAt: 500,
      cars: [carOf(car1, 99_000)],
      bestReferenceMs: 90_000,
    }),
    track('semvolta', { lastActivityAt: null, createdAt: 50, lapCount: 0, cars: [] }),
  ];
  function carOf(carCode: number, bestMs: number) {
    return {
      carCode,
      laps: 3,
      sessions: 1,
      bestMs,
      bestLapId: 'l',
      lastAt: 1,
      carName: `Carro ${carCode}`,
    };
  }

  it('ordena por uso recente quando o carro não é conhecido', () => {
    expect(pickerEntries(tracks, null).map((e) => e.track.id)).toEqual([
      'recente',
      'meio',
      'antiga',
      'semvolta',
    ]);
  });

  it('com o carro conhecido, as pistas com voltas desse carro vêm primeiro', () => {
    const list = pickerEntries(tracks, car1);
    expect(list.map((e) => e.track.id)).toEqual(['meio', 'antiga', 'recente', 'semvolta']);
    expect(list.map((e) => e.carMatch)).toEqual([true, true, false, false]);
  });

  it('o cartão do menu mostra no máximo 4 pistas', () => {
    const many = Array.from({ length: 9 }, (_, i) => track(`t${i}`, { lastActivityAt: i }));
    expect(recentEntries(many, null)).toHaveLength(4);
    expect(recentEntries(many, null)[0]!.track.id).toBe('t8');
  });

  it('busca por nome ignora acento e caixa', () => {
    expect(pickerEntries(tracks, null, 'SUZUKA').map((e) => e.track.id)).toEqual(['meio']);
    expect(pickerEntries(tracks, null, 'pista rec').map((e) => e.track.id)).toEqual(['recente']);
    expect(pickerEntries(tracks, null, 'nada disso')).toEqual([]);
  });

  it('mostra a referência que será usada e avisa quando não há', () => {
    const [meio] = pickerEntries(tracks, car1, 'suzuka');
    expect(meio!.reference.kind).toBe('personal');
    expect(meio!.reference.text).toMatch(/^Melhor pessoal 1:39[.,]000 · Carro 1111$/);
    // outro carro sem volta própria, mas há volta de referência na pista
    expect(referenceNote(tracks[2]!, car2)).toMatchObject({
      kind: 'reference',
      timeMs: 90_000,
    });
    // nada para o carro: orienta só pelo traçado
    expect(referenceNote(tracks[3]!, car1)).toMatchObject({
      kind: 'none',
      text: 'O engenheiro vai orientar só pelo traçado',
    });
  });
});

describe('divergência e guia', () => {
  it('mostra o aviso de troca ou de pista nova', () => {
    const m = {
      sessionId: 's',
      hintedTrackId: 'a',
      hintedTrackName: 'Monza',
      detectedTrackId: 'b',
      detectedTrackName: 'Suzuka',
      lapNumber: 1,
      lapsMoved: 0,
      at: 1,
    };
    expect(mismatchText(m, false)).toBe('Isso não parece Monza. Troquei para Suzuka.');
    expect(mismatchText(m, true)).toBe('Isso não parece Monza. Salvei como uma pista nova.');
  });

  it('o guia completo é do engenheiro em Treino; nos demais casos fica reduzido', () => {
    expect(guideVisibility({ engineerOn: true, mode: 'training' })).toBe('full');
    expect(guideVisibility({ engineerOn: false, mode: 'training' })).toBe('reduced');
    expect(guideVisibility({ engineerOn: true, mode: 'race' })).toBe('reduced');
    expect(guideVisibility({ engineerOn: true, mode: 'qualifying' })).toBe('reduced');
  });
});
