import type { ApiTraces, CornerComparisonRow } from '@gt7/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { canonicalHash, href, isAnalysisRoute, parseRoute, routes } from '../../lib/route.ts';
import { Markdown } from '../components/Markdown.tsx';
import {
  COMPARE_PANELS,
  CORNER_METRICS,
  cornerRange,
  gridIndex,
  isAllNull,
  lapSeries,
  metricTone,
  nearestIndex,
  panelData,
  signed,
  sortRows,
  timeTone,
  valueAt,
} from './chartData.ts';
import { captureIssueLabel } from './labels.ts';
import { formatLapTimeInput, parseLapTime } from './lapTime.ts';
import { inlineText, parseInline, parseMarkdown, safeHref } from './markdown.ts';
import { createSseParser, type SseMessage } from './sse.ts';

describe('router', () => {
  it('parses live and analysis routes', () => {
    expect(parseRoute('').name).toBe('live');
    expect(parseRoute('#/').name).toBe('live');
    expect(parseRoute('#/live').name).toBe('live');
    expect(parseRoute('#/analysis').name).toBe('sessions');
    expect(parseRoute('#/analysis/session/abc-1')).toMatchObject({
      name: 'session',
      params: { id: 'abc-1' },
    });
    expect(parseRoute('#/analysis/track/t%201?session=s1')).toMatchObject({
      name: 'track',
      params: { id: 't 1' },
      query: { session: 's1' },
    });
    expect(parseRoute('#/capture').name).toBe('capture');
    expect(parseRoute('#/config?s=mcp')).toMatchObject({ name: 'config', query: { s: 'mcp' } });
    expect(parseRoute('#/coach/r1')).toMatchObject({ name: 'coach', params: { id: 'r1' } });
    expect(parseRoute('#/help').name).toBe('help');
    expect(parseRoute('#/help?t=discord')).toMatchObject({
      name: 'help',
      query: { t: 'discord' },
    });
    expect(parseRoute('#/help/no-signal')).toMatchObject({
      name: 'help',
      params: { id: 'no-signal' },
    });
    expect(parseRoute('#/help/a/b').name).toBe('notFound');
    expect(routes.help()).toBe('#/help');
    expect(routes.help('discord')).toBe('#/help?t=discord');
    expect(routes.help(undefined, 'no-signal')).toBe('#/help/no-signal');
    expect(isAnalysisRoute(parseRoute('#/help'))).toBe(true);
    expect(parseRoute('#/nada').name).toBe('notFound');
    expect(parseRoute('#/analysis/x/y/z').name).toBe('notFound');
    expect(isAnalysisRoute(parseRoute('#/config'))).toBe(true);
    expect(isAnalysisRoute(parseRoute(''))).toBe(false);
  });

  it('round-trips the comparison query', () => {
    const h = routes.compare({ lap: 'L 1', ref: 'personalBest', extra: ['a', 'b'] });
    expect(h).toBe('#/analysis/compare?lap=L%201&ref=personalBest&extra=a%2Cb');
    const r = parseRoute(h);
    expect(r.name).toBe('compare');
    expect(r.query).toEqual({ lap: 'L 1', ref: 'personalBest', extra: 'a,b' });
    expect(href('/coach', { a: null, b: '', c: 0 })).toBe('#/coach?c=0');
  });
});

describe('lap time parsing', () => {
  it('accepts the usual forms', () => {
    expect(parseLapTime('1:30.960')).toBe(90960);
    expect(parseLapTime('1:30,960')).toBe(90960);
    expect(parseLapTime('1:30.96')).toBe(90960);
    expect(parseLapTime(' 1:30.9 ')).toBe(90900);
    expect(parseLapTime('1:30')).toBe(90000);
    expect(parseLapTime('90.960')).toBe(90960);
    expect(parseLapTime('59,5')).toBe(59500);
    expect(parseLapTime('1:02:03.5')).toBe(3723500);
  });

  it('rejects invalid input', () => {
    for (const s of ['', 'abc', '1:60.000', '1:30.9601', '-1:30', '1::30', '0', '1:30.']) {
      expect(parseLapTime(s), s).toBeNull();
    }
  });

  it('formats for the input', () => {
    expect(formatLapTimeInput(90960)).toBe('1:30.960');
    expect(formatLapTimeInput(5007)).toBe('0:05.007');
    expect(formatLapTimeInput(null)).toBe('');
  });
});

describe('SSE parser', () => {
  const collect = () => {
    const out: SseMessage[] = [];
    return { out, p: createSseParser((m) => out.push(m)) };
  };

  it('parses events split across chunks', () => {
    const { out, p } = collect();
    p.push('event: start\ndata: {"reportId":"r1"}\n\nevent: te');
    p.push('xt\ndata: {"delta":"Ol');
    p.push('á"}\n');
    expect(out).toHaveLength(1);
    p.push('\n');
    expect(out.map((m) => m.event)).toEqual(['start', 'text']);
    expect(JSON.parse(out[1]!.data)).toEqual({ delta: 'Olá' });
  });

  it('handles CRLF split between chunks, comments, multi-line data and the default event', () => {
    const { out, p } = collect();
    p.push(': keep-alive\r');
    p.push('\ndata: a\r\ndata: b\r');
    p.push('\n\r\n');
    p.push('data:c\r\rignored-field\n');
    p.end();
    expect(out).toEqual([
      { event: 'message', data: 'a\nb', id: null },
      { event: 'message', data: 'c', id: null },
    ]);
  });

  it('flushes a final event without a blank line and ignores events without data', () => {
    const { out, p } = collect();
    p.push('event: ping\n\nevent: done\ndata: {"ok":true}');
    p.end();
    expect(out).toEqual([{ event: 'done', data: '{"ok":true}', id: null }]);
  });
});

describe('markdown', () => {
  it('parses headings, emphasis, code, lists and tables', () => {
    const md = [
      '## Resumo',
      '',
      'Você perdeu **0,4 s** na *T1* com `brakePoint_m`.',
      '',
      '- item 1',
      '- item 2',
      '  - sub',
      '1. primeiro',
      '2. segundo',
      '',
      '| Curva | Perda |',
      '|:--|--:|',
      '| T1 | +0,2 |',
      '',
      '```',
      'a < b',
      '```',
    ].join('\n');
    const b = parseMarkdown(md);
    expect(b.map((x) => x.t)).toEqual(['h', 'p', 'ul', 'ol', 'table', 'code']);
    const ul = b[2] as Extract<(typeof b)[number], { t: 'ul' }>;
    expect(ul.items).toHaveLength(2);
    expect(ul.items[1]!.sub?.t).toBe('ul');
    const table = b[4] as Extract<(typeof b)[number], { t: 'table' }>;
    expect(table.align).toEqual(['left', 'right']);
    expect(inlineText(table.rows[0]![1]!)).toBe('+0,2');
    expect(parseInline('**a** _b_ `c`').map((n) => n.t)).toEqual([
      'strong',
      'text',
      'em',
      'text',
      'code',
    ]);
    // snake_case words are not italic
    expect(parseInline('brake_point_m')).toEqual([{ t: 'text', v: 'brake_point_m' }]);
  });

  it('keeps HTML as text and drops unsafe links', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('https://x.y')).toBe('https://x.y');
    expect(safeHref('#/config')).toBe('#/config');
    const html = renderToStaticMarkup(
      createElement(Markdown, {
        text: '# <img src=x onerror=alert(1)>\n\n<script>alert(1)</script> [x](javascript:alert(1)) [ok](https://a.b)\n\n| <b>h</b> |\n|---|\n| <i>c</i> |',
      }),
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('href="https://a.b"');
  });

  it('renders an unterminated fence while streaming', () => {
    const b = parseMarkdown('texto\n```json\n{"a":1');
    expect(b[1]).toEqual({ t: 'code', lang: 'json', v: '{"a":1' });
  });
});

describe('chart data', () => {
  const traces: ApiTraces = {
    fromM: 0,
    toM: 6,
    stepM: 2,
    distanceM: [0, 2, 4, 6],
    channels: ['speed', 'throttle', 'x', 'z'],
    laps: [
      {
        lapId: 'a',
        channels: {
          speed: [100, 110, null, 130],
          throttle: [1, 0.5, 0, 1],
          x: [0, 1, 2, 3],
          z: [0, 0, 0, 0],
        },
      },
      {
        lapId: 'b',
        channels: {
          speed: [90, 100, 110, 120],
          throttle: [1, 1, 1, 1],
          x: [0, 1, 2, 3],
          z: [1, 1, 1, 1],
        },
      },
    ],
  };

  it('shapes uPlot data with scaling and nulls', () => {
    const throttle = COMPARE_PANELS.find((p) => p.key === 'throttle')!;
    const d = panelData(traces, throttle, ['a', 'b']);
    expect(d[0]).toEqual([0, 2, 4, 6]);
    expect(d[1]).toEqual([100, 50, 0, 100]);
    expect(lapSeries(traces, 'a', 'speed')).toEqual([100, 110, null, 130]);
    expect(lapSeries(traces, 'zz', 'speed')).toEqual([null, null, null, null]);
    expect(isAllNull(lapSeries(traces, 'a', 'steering'))).toBe(true);
  });

  it('interpolates by distance and finds the nearest point', () => {
    const grid = traces.distanceM;
    expect(gridIndex(grid, -1)).toBe(-1);
    expect(gridIndex(grid, 3)).toBe(1);
    expect(gridIndex(grid, 9)).toBe(3);
    const b = lapSeries(traces, 'b', 'speed');
    expect(valueAt(grid, b, 3)).toBe(105);
    expect(valueAt(grid, lapSeries(traces, 'a', 'speed'), 4.5)).toBeNull();
    expect(nearestIndex([0, 1, 2, 3], [0, 0, 0, 0], 2.2, 0.3)).toBe(2);
  });

  it('computes corner zoom ranges', () => {
    const row = {
      zone: { fromM: 380, toM: 600 },
      a: { brakePointM: 390 },
      b: { brakePointM: 370 },
    } as unknown as CornerComparisonRow;
    expect(cornerRange({ entryM: 450, exitM: 520 }, row, 4000)).toEqual([345, 580]);
    expect(cornerRange({ entryM: 30, exitM: 3990 }, null, 4000)).toEqual([0, 4000]);
  });

  it('colours diffs by the better direction', () => {
    const brake = CORNER_METRICS.find((m) => m.key === 'brakePointM')!;
    const pickup = CORNER_METRICS.find((m) => m.key === 'throttlePickupM')!;
    expect(metricTone(brake, 12)).toBe('gain');
    expect(metricTone(brake, -12)).toBe('loss');
    expect(metricTone(brake, 3)).toBe('neutral');
    expect(metricTone(pickup, 20)).toBe('loss');
    expect(metricTone(pickup, null)).toBe('neutral');
    expect(timeTone(120)).toBe('loss');
    expect(timeTone(-50)).toBe('gain');
    expect(timeTone(4)).toBe('neutral');
    expect(signed(-3.46, 1)).toBe('−3,5');
    expect(signed(0.01, 1)).toBe('±0,0');
  });

  it('sorts rows by time lost', () => {
    const rows = [
      { corner: { index: 0 }, timeLostMs: 10 },
      { corner: { index: 1 }, timeLostMs: 90 },
      { corner: { index: 2 }, timeLostMs: -5 },
    ] as unknown as CornerComparisonRow[];
    expect(sortRows(rows, 'timeLost').map((r) => r.corner.index)).toEqual([1, 0, 2]);
    expect(sortRows(rows, 'order').map((r) => r.corner.index)).toEqual([0, 1, 2]);
  });
});

describe('labels', () => {
  it('translates capture issues', () => {
    expect(captureIssueLabel('timeMismatch')).toMatch(/ranking/);
    expect(captureIssueLabel('xyz')).toContain('xyz');
  });
});

describe('links saved before the routes were renamed to English', () => {
  it('rewrites the old hashes and keeps the current ones as they are', () => {
    expect(canonicalHash('#/inicio')).toBe('#/home');
    expect(canonicalHash('#/analise')).toBe('#/analysis');
    expect(canonicalHash('#/analise/pista/t1?tab=sessoes&session=s')).toBe(
      '#/analysis/track/t1?tab=sessions&session=s',
    );
    expect(canonicalHash('#/analise/sessao/abc/resumo')).toBe('#/analysis/session/abc/summary');
    expect(canonicalHash('#/analise/volta/x?ref=auto&modo=tempo')).toBe(
      '#/analysis/lap/x?ref=auto&mode=time',
    );
    expect(canonicalHash('#/guia?q=a&classe=4&topico=classe')).toBe(
      '#/guide?q=a&class=4&topic=class',
    );
    expect(canonicalHash('#/ajuda?t=discord')).toBe('#/help?t=discord');
    expect(canonicalHash('#/ajuda/sem-sinal')).toBe('#/help/no-signal');
    expect(canonicalHash('#/config?s=engenheiro')).toBe('#/config?s=engineer');
    expect(canonicalHash('#/analysis/track/x?from=diarias')).toBe('#/analysis/track/x?from=dailies');
    expect(canonicalHash('#/painel')).toBe('#/live');
    for (const h of [
      '#/',
      '#/home',
      '#/analysis/track/x?tab=tasks',
      '#/config?s=engineer',
      '#/coach',
    ]) {
      expect(canonicalHash(h)).toBe(h);
    }
    expect(parseRoute('#/analise/pista/abc?tab=curvas')).toMatchObject({
      name: 'track',
      params: { id: 'abc' },
      query: { tab: 'corners' },
    });
  });
});
