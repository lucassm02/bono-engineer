import { describe, expect, it, vi } from 'vitest';

// Synthetic manifest: Santa lacks one phrase that Alex has, and one that nobody has.
vi.mock('./radio-manifest.json', () => ({
  default: {
    format: 1,
    sampleRate: 24000,
    sequenceGapMs: 60,
    voices: {
      alex: {
        file: 'alex-test.wav',
        clips: {
          'Pneus frios.': [0, 24000],
          Melhorou: [26400, 2400],
          'dois décimos.': [31200, 4800],
        },
      },
      santa: {
        file: 'santa-test.wav',
        clips: { Melhorou: [0, 2400], 'dois décimos.': [4800, 4800] },
      },
    },
  },
}));

const { pickRadioPack, radioClipMs, radioPack, radioUtteranceMs, hasRadioUtterance } = await import(
  './engineerClips.ts'
);

describe('montagem determinística', () => {
  it('returns the exact played duration of a sequence: clips / rate + fixed gaps', () => {
    const pack = radioPack('radio:santa')!;
    expect(radioClipMs(pack, 'Melhorou')).toBe(100);
    expect(radioUtteranceMs(pack, 'Melhorou')).toBe(100);
    expect(radioUtteranceMs(pack, ['Melhorou', 'dois décimos.'])).toBe(100 + 200 + 60);
    expect(radioUtteranceMs(pack, ['Melhorou', 'dois décimos.'], 1.08)).toBeCloseTo(
      300 / 1.08 + 60,
      9,
    );
    expect(radioUtteranceMs(pack, ['Melhorou', 'Pneus frios.'])).toBeUndefined();
    expect(radioUtteranceMs(pack, [])).toBeUndefined();
    expect(hasRadioUtterance(pack, ['Melhorou'])).toBe(true);
  });
});

describe('fallback de pacote', () => {
  it('uses the default pack only when it has the phrase', () => {
    const all = () => true;
    expect(pickRadioPack('radio:santa', 'Melhorou', all)?.voiceId).toBe('radio:santa');
    expect(pickRadioPack('radio:santa', 'Pneus frios.', all)?.voiceId).toBe('radio:alex');
    expect(pickRadioPack('radio:santa', ['Pneus frios.', 'Melhorou'], all)?.voiceId).toBe(
      'radio:alex',
    );
    expect(pickRadioPack('radio:santa', 'Sem clipe.', all)).toBeNull();
  });

  it('skips a failed pack and reports unavailable audio when no pack can play', () => {
    const santaFailed = (pack: { voiceId: string }) => pack.voiceId !== 'radio:santa';
    expect(pickRadioPack('radio:santa', 'Melhorou', santaFailed)?.voiceId).toBe('radio:alex');
    expect(pickRadioPack('radio:santa', 'Melhorou', () => false)).toBeNull();
    // Unknown/removed IDs never reach device synthesis: they resolve to the default pack.
    expect(pickRadioPack('radio:dora', 'Melhorou', () => true)?.voiceId).toBe('radio:alex');
  });
});
