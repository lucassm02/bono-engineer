import { describe, expect, it } from 'vitest';
import { parseRoute, routes } from '../../lib/route.ts';
import { RECENT_SESSION_MS, shouldOfferSummary } from './sessionSummary.ts';

const NOW = 1_700_000_000_000;
const session = (over: Partial<Parameters<typeof shouldOfferSummary>[0]> = {}) => ({
  id: 's1',
  endedAt: NOW - 10 * 60_000,
  lapCount: 5,
  mode: 'live',
  ...over,
});

describe('shouldOfferSummary', () => {
  it('offers a session that just ended with laps', () => {
    expect(shouldOfferSummary(session(), [], NOW)).toBe(true);
  });

  it('stays quiet for open, empty, old, replay or already seen sessions', () => {
    expect(shouldOfferSummary(session({ endedAt: null }), [], NOW)).toBe(false);
    expect(shouldOfferSummary(session({ lapCount: 0 }), [], NOW)).toBe(false);
    expect(shouldOfferSummary(session({ endedAt: NOW - RECENT_SESSION_MS - 1 }), [], NOW)).toBe(
      false,
    );
    expect(shouldOfferSummary(session({ mode: 'replayCapture' }), [], NOW)).toBe(false);
    expect(shouldOfferSummary(session(), ['s1'], NOW)).toBe(false);
  });
});

describe('summary route', () => {
  it('round-trips the session id', () => {
    const href = routes.summary('abc 1');
    const r = parseRoute(href);
    expect(r.name).toBe('summary');
    expect(r.params.id).toBe('abc 1');
  });

  it('keeps the session page and rejects extra segments', () => {
    expect(parseRoute('#/analise/sessao/abc').name).toBe('session');
    expect(parseRoute('#/analise/sessao/abc/outra').name).toBe('notFound');
  });
});
