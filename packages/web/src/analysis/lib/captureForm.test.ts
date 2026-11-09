import type { Lap, ReferenceCaptureStatus, ReferenceMeta } from '@gt7/shared';
import { DEFAULT_REPLAY_DRIVER, listCars } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import {
  carOptionGroups,
  carRequestFields,
  detectionView,
  discardKey,
  driverSuggestions,
  groupReferences,
  normalizeRankingText,
  parseCarChoice,
  parseRankingTime,
  progressView,
  resolvedCarName,
  timeOriginLabel,
  visibleIssues,
} from './captureForm.ts';

const HURACAN_GR4 = 3253;

function status(p: Partial<ReferenceCaptureStatus> = {}): ReferenceCaptureStatus {
  return { state: 'idle', driverName: null, lapId: null, issues: [], ...p };
}

function ref(
  id: string,
  trackId: string,
  carCode: number,
  timeMs: number,
  meta: Partial<ReferenceMeta> = {},
): Lap {
  return {
    id,
    trackId,
    carCode,
    timeMs,
    isReference: true,
    referenceMeta: {
      driverName: 'Fulano',
      source: 'replayCapture',
      rankingTimeMs: null,
      capturedAt: 1,
      ...meta,
    },
  } as unknown as Lap;
}

describe('parseRankingTime', () => {
  it.each([
    ['1:30.960', 90_960],
    ['1:30,960', 90_960],
    ['90.960', 90_960],
    ['90,96', 90_960],
    ['  1:30.960  ', 90_960],
    ['1 : 30 . 960', 90_960],
    ["1'30.960", 90_960],
    ['1’30"960', 90_960],
    ['01:30.960', 90_960],
    ['2:05', 125_000],
    ['1:59.089', 119_089],
  ])('accepts %s', (text, ms) => {
    const r = parseRankingTime(text);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.ms).toBe(ms);
  });

  it('shows the interpreted time', () => {
    const r = parseRankingTime('1:30.960');
    expect(r).toMatchObject({ kind: 'ok', shown: '1:30,960' });
  });

  it('treats blank as empty (optional field)', () => {
    expect(parseRankingTime('').kind).toBe('empty');
    expect(parseRankingTime('   ').kind).toBe('empty');
  });

  it.each(['abc', '1:75.000', '1:30.9601', '1::30', '-90', '1:30.', '5', '9.999', '99999'])(
    'rejects %s',
    (text) => {
      const r = parseRankingTime(text);
      expect(r.kind).toBe('invalid');
      if (r.kind === 'invalid') expect(r.message.length).toBeGreaterThan(10);
    },
  );

  it('normalises the game notation', () => {
    expect(normalizeRankingText('1\'30"960')).toBe('1:30.960');
    expect(normalizeRankingText('1:30,960')).toBe('1:30.960');
  });
});

describe('car names from the catalogue', () => {
  it('resolves "Marca Modelo"', () => {
    expect(resolvedCarName(HURACAN_GR4)).toBe('Lamborghini Huracan Gr.4');
  });

  it('returns null for unknown or missing codes', () => {
    expect(resolvedCarName(999_999)).toBeNull();
    expect(resolvedCarName(null)).toBeNull();
    expect(resolvedCarName(undefined)).toBeNull();
  });

  it('does not repeat a maker already in the name', () => {
    for (const c of listCars().slice(0, 600)) {
      const n = resolvedCarName(c.id) as string;
      expect(n.length).toBeLessThanOrEqual(80);
      expect(n.toLowerCase()).not.toMatch(/^(\w+) \1\b/);
    }
  });
});

describe('car select', () => {
  it('lists every car of the catalogue, grouped by maker A-Z', () => {
    const groups = carOptionGroups();
    expect(groups.reduce((n, g) => n + g.cars.length, 0)).toBe(listCars().length);
    const names = groups.map((g) => g.makerName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'pt-BR')));
    expect(groups.find((g) => g.makerName === 'Lamborghini')?.cars.map((c) => c.id)).toContain(
      HURACAN_GR4,
    );
  });

  it('parses the select value', () => {
    expect(parseCarChoice('auto')).toBe('auto');
    expect(parseCarChoice('none')).toBe('none');
    expect(parseCarChoice('3253')).toBe(3253);
    expect(parseCarChoice('lixo')).toBe('auto');
  });

  it('sends the resolved name; the expected code only for a manual choice', () => {
    expect(carRequestFields('auto', HURACAN_GR4)).toEqual({ carName: 'Lamborghini Huracan Gr.4' });
    expect(carRequestFields('auto', null)).toEqual({});
    expect(carRequestFields('auto', 999_999)).toEqual({});
    expect(carRequestFields('none', HURACAN_GR4)).toEqual({});
    expect(carRequestFields(HURACAN_GR4, null)).toEqual({
      carName: 'Lamborghini Huracan Gr.4',
      expectedCarCode: HURACAN_GR4,
    });
  });
});

describe('driverSuggestions', () => {
  it('lists used drivers, newest first, without duplicates or the default name', () => {
    const laps = [
      ref('a', 't', 1, 1, { driverName: 'Kokichi', capturedAt: 10 }),
      ref('b', 't', 1, 1, { driverName: 'kokichi ', capturedAt: 30 }),
      ref('c', 't', 1, 1, { driverName: 'Yamanaka', capturedAt: 20 }),
      ref('d', 't', 1, 1, { driverName: DEFAULT_REPLAY_DRIVER, capturedAt: 40 }),
      ref('e', 't', 1, 1, { driverName: '  ', capturedAt: 50 }),
    ];
    expect(driverSuggestions(laps)).toEqual(['kokichi', 'Yamanaka']);
    expect(driverSuggestions(laps, 1)).toEqual(['kokichi']);
    expect(driverSuggestions([])).toEqual([]);
  });
});

describe('detectionView', () => {
  const base = {
    online: true,
    connection: 'onTrack' as const,
    liveState: null,
    carCode: null,
    capture: status(),
  };

  it('invites to open the replay when nothing is detected', () => {
    const v = detectionView(base);
    expect(v.kind).toBe('idle');
    expect(v.title).toMatch(/Abra o replay no jogo/);
    expect(v.carName).toBeNull();
  });

  it('detects the replay from the connection state, with the car', () => {
    const v = detectionView({
      ...base,
      connection: 'replay',
      carCode: HURACAN_GR4,
    });
    expect(v.kind).toBe('replay');
    expect(v.title).toBe('Replay detectado');
    expect(v.carName).toBe('Lamborghini Huracan Gr.4');
    expect(v.trackName).toBeNull();
    expect(v.message).toMatch(/Capturar esta volta/);
  });

  it('shows the track once the capture identified it', () => {
    const v = detectionView({
      ...base,
      connection: 'replay',
      carCode: HURACAN_GR4,
      capture: status({
        state: 'waitingLapStart',
        waiting: 'startLine',
        replayDetected: true,
        trackName: 'Trial Mountain Circuit',
      }),
    });
    expect(v.trackName).toBe('Trial Mountain Circuit');
    expect(v.tone).toBe('ok');
  });

  it('warns about an unknown track', () => {
    const v = detectionView({
      ...base,
      connection: 'replay',
      carCode: HURACAN_GR4,
      capture: status({ state: 'waitingLapStart', waiting: 'unknownTrack', replayDetected: true }),
    });
    expect(v.kind).toBe('replayUnknownTrack');
    expect(v.tone).toBe('warn');
    expect(v.message).toMatch(/dirija essa pista ao vivo/i);
  });

  it('uses the live frame state when the console state is not replay yet', () => {
    expect(detectionView({ ...base, connection: null, liveState: 'replay' }).kind).toBe('replay');
  });

  it('labels an unknown car code', () => {
    const v = detectionView({ ...base, connection: 'replay', carCode: 999_999 });
    expect(v.carName).toBe('Carro #999999');
  });

  it('reports no connection', () => {
    expect(detectionView({ ...base, online: false, capture: null }).kind).toBe('offline');
  });
});

describe('progressView', () => {
  it('walks the four steps', () => {
    expect(progressView(status({ state: 'waitingLapStart', waiting: 'replay' })).step).toBe(0);
    expect(progressView(status({ state: 'waitingLapStart', waiting: 'track' })).step).toBe(0);
    expect(progressView(status({ state: 'waitingLapStart', waiting: 'startLine' })).step).toBe(1);
    expect(progressView(status({ state: 'recording' })).step).toBe(2);
    expect(progressView(status({ state: 'validating' })).step).toBe(3);
    const v = progressView(status({ state: 'recording' }));
    expect(v.steps.map((s) => s.state)).toEqual(['done', 'done', 'now', 'todo']);
  });

  it('shows the elapsed time and extrapolates the total', () => {
    const v = progressView(status({ state: 'recording', recordingMs: 45_000, lapFraction: 0.36 }));
    expect(v.clock).toBe('0:45');
    expect(v.estimate).toBe('de 2:05');
    expect(v.recordingFraction).toBeCloseTo(0.36);
    expect(v.tone).toBe('rec');
  });

  it('has no estimate at the very start of the lap', () => {
    const v = progressView(status({ state: 'recording', recordingMs: 800, lapFraction: 0.01 }));
    expect(v.estimate).toBe('');
  });

  it('tells what to do while waiting', () => {
    expect(progressView(status({ state: 'waitingLapStart', waiting: 'replay' })).text).toMatch(
      /Abra o replay/,
    );
    expect(progressView(status({ state: 'waitingLapStart', waiting: 'unknownTrack' })).tone).toBe(
      'warn',
    );
  });
});

describe('issues of the previous lap', () => {
  it('hides the old issues while the next lap is being recorded', () => {
    const issues = ['discontinuity'];
    expect(visibleIssues(status({ state: 'recording', issues }))).toEqual([]);
    expect(visibleIssues(status({ state: 'validating', issues }))).toEqual([]);
    expect(visibleIssues(status({ state: 'waitingLapStart', issues }))).toEqual(issues);
    expect(visibleIssues(status({ state: 'idle', issues }))).toEqual(issues);
  });

  it('identifies a new rejection', () => {
    expect(discardKey(status())).toBeNull();
    const a = discardKey(status({ issues: ['paused'], measuredLapMs: 90_000 }));
    const b = discardKey(status({ issues: ['paused'], measuredLapMs: 91_000 }));
    expect(a).not.toBe(b);
  });
});

describe('references list', () => {
  const tracks = [
    { id: 't1', name: 'Trial Mountain Circuit', layout: null },
    { id: 't2', name: 'Spa', layout: 'GP' },
  ];

  it('groups by track, fastest first, newest track first, marks the delta lap per car', () => {
    const laps = [
      ref('a', 't1', HURACAN_GR4, 120_000, { capturedAt: 100 }),
      ref('b', 't1', HURACAN_GR4, 119_089, { capturedAt: 90 }),
      ref('c', 't1', 1234, 121_000, { capturedAt: 80 }),
      ref('d', 't2', HURACAN_GR4, 140_000, { capturedAt: 300 }),
    ];
    const g = groupReferences(laps, tracks);
    expect(g.map((x) => x.trackName)).toEqual(['Spa', 'Trial Mountain Circuit']);
    expect(g[1]?.laps.map((l) => l.id)).toEqual(['b', 'a', 'c']);
    expect([...(g[1]?.deltaIds ?? [])].sort()).toEqual(['b', 'c']);
    expect(g[0]?.layout).toBe('GP');
  });

  it('ignores laps that are not references and names unknown tracks', () => {
    const notRef = { ...ref('x', 't1', 1, 1), isReference: false } as Lap;
    const g = groupReferences([notRef, ref('y', 'zz', 1, 1)], tracks);
    expect(g).toHaveLength(1);
    expect(g[0]?.trackName).toBe('Pista não identificada');
  });

  it('describes where the time comes from', () => {
    const m = (p: Partial<ReferenceMeta>) =>
      ({
        driverName: 'x',
        source: 'replayCapture',
        rankingTimeMs: null,
        capturedAt: 1,
        ...p,
      }) as ReferenceMeta;
    expect(timeOriginLabel(m({ timeSource: 'ranking' }))).toBe('tempo do ranking');
    expect(timeOriginLabel(m({ timeSource: 'packets' }))).toMatch(/pacotes/);
    expect(timeOriginLabel(m({ rankingTimeMs: 90_000 }))).toBe('tempo do ranking');
    expect(timeOriginLabel(m({ source: 'own' }))).toBe('volta própria');
    expect(timeOriginLabel(null)).toBe('—');
  });
});
