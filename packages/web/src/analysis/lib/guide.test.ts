import { knowledgeIndex } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { parseRoute, routes } from '../../lib/route.ts';
import { classTopicId, filterGuide, parseGuideGroup, parseGuideKind } from './guide.ts';

describe('guide route', () => {
  it('parses #/guia and builds hrefs', () => {
    expect(parseRoute('#/guia').name).toBe('guide');
    expect(parseRoute('#/guia?q=trail&classe=4').query).toEqual({ q: 'trail', classe: '4' });
    expect(parseRoute('#/guia/x').name).toBe('notFound');
    expect(routes.guide()).toBe('#/guia');
    expect(routes.guide({ q: 'freio', classe: '3' })).toBe('#/guia?q=freio&classe=3');
  });
});

describe('filterGuide', () => {
  const all = knowledgeIndex();

  it('returns everything without filters', () => {
    expect(filterGuide({ query: '', kind: 'todos', group: null })).toHaveLength(all.length);
  });

  it('filters by kind and by search without accents', () => {
    const diag = filterGuide({ query: '', kind: 'diagnostico', group: null });
    expect(diag.length).toBeGreaterThanOrEqual(23);
    expect(diag.every((t) => t.kind === 'diagnostico')).toBe(true);
    const hits = filterGuide({ query: 'subesterco', kind: 'todos', group: null });
    expect(hits.length).toBeGreaterThan(0);
    expect(filterGuide({ query: 'zzzzqqq', kind: 'todos', group: null })).toEqual([]);
  });

  it('keeps only the chosen class among the class cards', () => {
    const cls = filterGuide({ query: '', kind: 'classe', group: '4' });
    expect(cls.map((t) => t.id)).toEqual([classTopicId('4')]);
    const mixed = filterGuide({ query: '', kind: 'todos', group: 'B' });
    expect(mixed.filter((t) => t.kind === 'classe').map((t) => t.id)).toEqual(['classe/grb']);
    expect(mixed.some((t) => t.kind === 'diagnostico')).toBe(true);
  });

  it('parses the query-string values', () => {
    expect(parseGuideKind('classe')).toBe('classe');
    expect(parseGuideKind('x')).toBe('todos');
    expect(parseGuideGroup('gr3')).toBe('3');
    expect(parseGuideGroup('zz')).toBeNull();
  });
});
