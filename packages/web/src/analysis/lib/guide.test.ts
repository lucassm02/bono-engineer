import { knowledgeIndex } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { parseRoute, routes } from '../../lib/route.ts';
import { classTopicId, filterGuide, parseGuideGroup, parseGuideKind } from './guide.ts';

describe('guide route', () => {
  it('parses #/guide and builds hrefs', () => {
    expect(parseRoute('#/guide').name).toBe('guide');
    expect(parseRoute('#/guide?q=trail&class=4').query).toEqual({ q: 'trail', class: '4' });
    expect(parseRoute('#/guide/x').name).toBe('notFound');
    expect(routes.guide()).toBe('#/guide');
    expect(routes.guide({ q: 'freio', class: '3' })).toBe('#/guide?q=freio&class=3');
  });
});

describe('filterGuide', () => {
  const all = knowledgeIndex();

  it('returns everything without filters', () => {
    expect(filterGuide({ query: '', kind: 'all', group: null })).toHaveLength(all.length);
  });

  it('filters by kind and by search without accents', () => {
    const diag = filterGuide({ query: '', kind: 'diagnostics', group: null });
    expect(diag.length).toBeGreaterThanOrEqual(23);
    expect(diag.every((t) => t.kind === 'diagnostics')).toBe(true);
    const hits = filterGuide({ query: 'subesterco', kind: 'all', group: null });
    expect(hits.length).toBeGreaterThan(0);
    expect(filterGuide({ query: 'zzzzqqq', kind: 'all', group: null })).toEqual([]);
  });

  it('keeps only the chosen class among the class cards', () => {
    const cls = filterGuide({ query: '', kind: 'class', group: '4' });
    expect(cls.map((t) => t.id)).toEqual([classTopicId('4')]);
    const mixed = filterGuide({ query: '', kind: 'all', group: 'B' });
    expect(mixed.filter((t) => t.kind === 'class').map((t) => t.id)).toEqual(['class/grb']);
    expect(mixed.some((t) => t.kind === 'diagnostics')).toBe(true);
  });

  it('parses the query-string values', () => {
    expect(parseGuideKind('class')).toBe('class');
    expect(parseGuideKind('x')).toBe('all');
    expect(parseGuideGroup('gr3')).toBe('3');
    expect(parseGuideGroup('zz')).toBeNull();
  });
});
