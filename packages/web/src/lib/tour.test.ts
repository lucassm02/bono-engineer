import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseRoute } from './route.ts';
import {
  analysisTourSteps,
  isOnScreen,
  liveTourSteps,
  padBox,
  parseTourState,
  placeBalloon,
  selectorAnchors,
  stepAfter,
  TOUR_ANCHORS,
  TOUR_BODY_MAX,
  type TourStep,
  unionBox,
  withHint,
  withOutcome,
} from './tour.ts';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx$/.test(name) && !name.endsWith('.test.tsx')) out.push(path);
  }
  return out;
}

/** Every `data-tour="x"` written in the screens (JSX or object literal), not counting the tour itself. */
function declaredAnchors(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/data-tour=(?:"([^"]+)"|\{[^}]*?'([^']+)')/g)) {
      found.add(m[1] ?? m[2] ?? '');
    }
    // anchors passed through a field (`tour: 'nav-compare'` in the navigation tables)
    for (const m of text.matchAll(/\btour:\s*'([^']+)'/g)) found.add(m[1] ?? '');
  }
  return found;
}

const TOURS: [string, TourStep[]][] = [
  ['live', liveTourSteps()],
  ['analysis', analysisTourSteps()],
];

describe('tour contract', () => {
  const declared = declaredAnchors();

  it('has 7 steps on the live panel and 5 in the analysis area', () => {
    expect(liveTourSteps()).toHaveLength(7);
    expect(analysisTourSteps()).toHaveLength(5);
  });

  for (const [name, steps] of TOURS) {
    it(`${name}: every step points at an anchor that exists in the screens`, () => {
      for (const step of steps) {
        const names = selectorAnchors(step.selector);
        expect(names.length, step.id).toBeGreaterThan(0);
        for (const anchor of names) {
          expect(declared.has(anchor), `${name}/${step.id} → data-tour="${anchor}"`).toBe(true);
        }
      }
    });

    it(`${name}: ids are unique and the text fits the balloon`, () => {
      expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
      for (const step of steps) {
        expect(step.title.length, step.id).toBeGreaterThan(0);
        expect(step.body.length, step.id).toBeLessThanOrEqual(TOUR_BODY_MAX);
      }
    });

    it(`${name}: routes are real routes`, () => {
      for (const step of steps) {
        if (step.route) expect(parseRoute(step.route).name, step.id).not.toBe('notFound');
      }
    });
  }

  it('every anchor of the table is used by a step', () => {
    const used = new Set(TOURS.flatMap(([, s]) => s.flatMap((x) => selectorAnchors(x.selector))));
    for (const anchor of Object.values(TOUR_ANCHORS)) expect(used.has(anchor), anchor).toBe(true);
  });
});

describe('tour state', () => {
  it('reads anything safely', () => {
    expect(parseTourState(null)).toEqual({ hints: {} });
    expect(parseTourState('x')).toEqual({ hints: {} });
    expect(
      parseTourState({ live: 'done', analysis: 'nope', hints: { sessionSaved: true, x: true } }),
    ).toEqual({ live: 'done', hints: { sessionSaved: true } });
  });

  it('records outcomes and hints without touching the rest', () => {
    const s = withHint(withOutcome({ hints: {} }, 'live', 'skipped'), 'engineerSpoke');
    expect(s).toEqual({ live: 'skipped', hints: { engineerSpoke: true } });
    expect(withOutcome(s, 'live', 'done').hints).toEqual({ engineerSpoke: true });
  });
});

describe('tour geometry', () => {
  const vp = { w: 1000, h: 700 };
  const size = { w: 300, h: 150 };

  it('joins boxes and clips the padding to the screen', () => {
    expect(unionBox([])).toBeNull();
    expect(
      unionBox([
        { x: 10, y: 10, w: 20, h: 20 },
        { x: 100, y: 50, w: 10, h: 10 },
      ]),
    ).toEqual({ x: 10, y: 10, w: 100, h: 50 });
    expect(padBox({ x: 2, y: 2, w: 50, h: 50 }, 6, vp)).toEqual({ x: 0, y: 0, w: 58, h: 58 });
  });

  it('ignores anchors that sit outside the screen (carousel neighbours)', () => {
    expect(isOnScreen({ x: 1000, y: 0, w: 100, h: 100 }, vp)).toBe(false);
    expect(isOnScreen({ x: -120, y: 0, w: 100, h: 100 }, vp)).toBe(false);
    expect(isOnScreen({ x: 900, y: 0, w: 200, h: 100 }, vp)).toBe(true);
    expect(isOnScreen({ x: 0, y: 0, w: 0, h: 0 }, vp)).toBe(false);
  });

  it('puts the balloon below, above, beside, or over the free edge', () => {
    expect(placeBalloon({ x: 400, y: 100, w: 200, h: 80 }, size, vp).side).toBe('bottom');
    expect(placeBalloon({ x: 400, y: 560, w: 200, h: 80 }, size, vp).side).toBe('top');
    expect(placeBalloon({ x: 100, y: 20, w: 100, h: 660 }, size, vp).side).toBe('right');
    expect(placeBalloon({ x: 800, y: 20, w: 100, h: 660 }, size, vp).side).toBe('left');
    const big = placeBalloon({ x: 0, y: 0, w: 1000, h: 700 }, size, vp);
    expect(big.side).toBe('center');
  });

  it('never leaves the screen', () => {
    for (const target of [
      { x: 0, y: 0, w: 40, h: 40 },
      { x: 960, y: 660, w: 40, h: 40 },
      { x: 480, y: 330, w: 40, h: 40 },
      { x: 0, y: 300, w: 1000, h: 100 },
    ]) {
      const p = placeBalloon(target, size, vp);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + size.w).toBeLessThanOrEqual(vp.w);
      expect(p.y + size.h).toBeLessThanOrEqual(vp.h);
    }
  });

  it('walks the steps and stops at both ends', () => {
    expect(stepAfter(0, 1, 7)).toBe(1);
    expect(stepAfter(6, 1, 7)).toBeNull();
    expect(stepAfter(0, -1, 7)).toBeNull();
    expect(stepAfter(3, -1, 7)).toBe(2);
  });
});
