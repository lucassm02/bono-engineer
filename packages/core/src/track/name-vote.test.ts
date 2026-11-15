import type { KnownTrackCandidate } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { NAME_VOTES_NEEDED, TrackNameVoter } from './name-vote.ts';

const cand = (id: string, over: Partial<KnownTrackCandidate> = {}): KnownTrackCandidate =>
  ({
    layout: { id, venue: 'Nürburgring', layoutLabel: 'Sprint' },
    confidence: 'medium',
    lengthOk: true,
    ...over,
  }) as KnownTrackCandidate;

const one = (id = 'a', over: Partial<KnownTrackCandidate> = {}) => ({
  candidates: [cand(id, over)],
  ambiguous: false,
});

describe('TrackNameVoter', () => {
  it('names the track after enough consecutive laps that agree, once', () => {
    const v = new TrackNameVoter();
    for (let i = 1; i < NAME_VOTES_NEEDED; i++) expect(v.vote('t', one())).toBeNull();
    expect(v.vote('t', one())?.venue).toBe('Nürburgring');
    // the count starts again after the name
    expect(v.vote('t', one())).toBeNull();
  });

  it('a lap that does not agree starts the count again', () => {
    const v = new TrackNameVoter();
    v.vote('t', one());
    v.vote('t', one());
    expect(v.vote('t', { candidates: [], ambiguous: false })).toBeNull();
    expect(v.vote('t', one())).toBeNull();
    expect(v.vote('t', one())).toBeNull();
    expect(v.vote('t', one())).not.toBeNull();
  });

  it('another layout or another track restarts it', () => {
    const v = new TrackNameVoter();
    v.vote('t', one('a'));
    v.vote('t', one('a'));
    expect(v.vote('t', one('b'))).toBeNull();
    v.vote('u', one('b'));
    expect(v.vote('u', one('b'))).toBeNull();
    expect(v.vote('u', one('b'))).not.toBeNull();
  });

  it('never names from look-alikes, a weak match or a wrong length', () => {
    const cases = [
      { candidates: [cand('a'), cand('b')], ambiguous: false },
      { candidates: [cand('a')], ambiguous: true },
      one('a', { confidence: 'low' }),
      one('a', { lengthOk: false }),
    ];
    for (const m of cases) {
      const v = new TrackNameVoter();
      for (let i = 0; i < NAME_VOTES_NEEDED + 2; i++) expect(v.vote('t', m)).toBeNull();
    }
  });

  it('accepts a strong match as well', () => {
    const v = new TrackNameVoter();
    let r = null;
    for (let i = 0; i < NAME_VOTES_NEEDED; i++) r = v.vote('t', one('a', { confidence: 'high' }));
    expect(r).not.toBeNull();
  });
});
