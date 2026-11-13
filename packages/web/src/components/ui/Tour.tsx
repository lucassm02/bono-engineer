/**
 * Guided tour (spec 04): a dark mask with a cut-out around the anchor (`data-tour="…"`), a ring in
 * the accent colour and a balloon with title, text, "Passo X de Y", Voltar / Próximo / Pular tour.
 * No library. Keyboard: → or Enter next, ← back, Esc leaves; Tab stays inside the balloon. A step
 * whose anchor is not on screen (screen turned off in the profile, empty page) is skipped.
 * The steps, the geometry and the saved state live in `lib/tour.ts`; the store in `state/tour.ts`.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t as uiText, useLanguage } from '../../lib/i18n.ts';
import { navigate, parseRoute } from '../../lib/route.ts';
import {
  type BalloonSide,
  type Box,
  isOnScreen,
  padBox,
  placeBalloon,
  stepAfter,
  type TourStep,
  tourSteps,
  unionBox,
} from '../../lib/tour.ts';
import { goToView } from '../../state/actions.ts';
import { endTour, setTourIndex, useTour } from '../../state/tour.ts';
import { useUi } from '../../state/uiStore.ts';
import '../../styles/tour.css';

const FIND_TIMEOUT_MS = 1800;
const FIND_EVERY_MS = 60;
const REMEASURE_MS = 320;
const RING_PAD = 6;
const FOCUSABLE = 'button:not([disabled])';

interface Found {
  box: Box;
  el: Element;
}

/** Anchors of the step that are really on screen (the carousel mounts neighbours off to the side). */
function findAnchor(selector: string): Found | null {
  const vp = { w: window.innerWidth, h: window.innerHeight };
  const hits: { box: Box; el: Element }[] = [];
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect();
    const box = { x: r.left, y: r.top, w: r.width, h: r.height };
    if (isOnScreen(box, vp)) hits.push({ box, el });
  }
  const box = unionBox(hits.map((h) => h.box));
  const first = hits[0];
  return box && first ? { box, el: first.el } : null;
}

/** Same page? Compares the route name and the `s` query of settings. */
function onRoute(wanted: string): boolean {
  const a = parseRoute(location.hash);
  const b = parseRoute(wanted);
  return a.name === b.name && (b.name !== 'config' || a.query.s === b.query.s);
}

function Balloon({
  step,
  index,
  total,
  demo,
  box,
  onNext,
  onBack,
  onSkip,
}: {
  step: TourStep;
  index: number;
  total: number;
  demo: boolean;
  box: Box;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; side: BalloonSide } | null>(null);
  const last = index >= total - 1;

  // Place after the first paint, when the balloon has a size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vp = { w: window.innerWidth, h: window.innerHeight };
    setPos(placeBalloon(box, { w: el.offsetWidth, h: el.offsetHeight }, vp));
  }, [box]);

  // Each step: the balloon takes the focus, so a screen reader reads the title and the text.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the step changes
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [step.id]);

  return (
    <div
      ref={ref}
      className="tour-balloon"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      tabIndex={-1}
      data-side={pos?.side}
      data-ready={pos ? '1' : '0'}
      style={{ left: pos?.x ?? 0, top: pos?.y ?? 0 }}
    >
      <div className="tour-meta">
        <span className="tour-count num">{uiText('Passo {0} de {1}', index + 1, total)}</span>
        {demo && (
          <span className="ui-badge" data-tone="accent">
            {uiText('Demonstração')}
          </span>
        )}
      </div>
      <h2 id={titleId} className="tour-title">
        {step.title}
      </h2>
      <p id={bodyId} className="tour-body">
        {step.body}
      </p>
      <div className="tour-actions">
        <button type="button" className="ui-btn tour-skip" data-variant="ghost" onClick={onSkip}>
          {uiText('Pular tour')}
        </button>
        <span className="tour-spacer" />
        {index > 0 && (
          <button type="button" className="ui-btn" data-variant="secondary" onClick={onBack}>
            {uiText('Voltar')}
          </button>
        )}
        <button type="button" className="ui-btn" onClick={onNext}>
          {last ? uiText('Concluir') : uiText('Próximo')}
        </button>
      </div>
    </div>
  );
}

export default function Tour() {
  const active = useTour((s) => s.active);
  const index = useTour((s) => s.index);
  const demo = useTour((s) => s.demo);
  const language = useLanguage();
  const [anchor, setAnchor] = useState<{ id: string; box: Box } | null>(null);
  const [announce, setAnnounce] = useState('');
  const dir = useRef<1 | -1>(1);
  const anchorEl = useRef<Element | null>(null);
  const lost = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the text follows the language
  const steps = useMemo(() => (active ? tourSteps(active) : []), [active, language]);
  const step = steps[index];
  const total = steps.length;

  const go = useCallback(
    (by: 1 | -1) => {
      dir.current = by;
      const next = stepAfter(useTour.getState().index, by, total);
      if (next === null) {
        // past the last step: done; before the first one: stay (a skipped first step looks forward)
        if (by === 1) endTour('done');
        else dir.current = 1;
        return;
      }
      setTourIndex(next);
    },
    [total],
  );

  // Open the page / screen the step needs, then wait for the anchor; no anchor = skip the step.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `go` and `language` are stable here
  useEffect(() => {
    if (!active || !step) return;
    lost.current = 0;
    if (step.route && !onRoute(step.route)) navigate(step.route);
    if (step.views) {
      const ui = useUi.getState();
      const view = step.views.find((v) => ui.profile.views.includes(v));
      if (view && ui.currentView !== view && !step.views.includes(ui.currentView)) {
        goToView(view, 'picker');
      }
    }
    const started = Date.now();
    const timer = setInterval(() => {
      let found = findAnchor(step.selector);
      if (!found && active === 'analysis') {
        const offscreen = [...document.querySelectorAll(step.selector)].find((el) => {
          const bounds = el.getBoundingClientRect();
          return bounds.width > 0 && bounds.height > 0;
        });
        offscreen?.scrollIntoView({ block: 'center', behavior: 'instant' });
        found = findAnchor(step.selector);
      }
      if (found) {
        clearInterval(timer);
        anchorEl.current = found.el;
        const vp = { w: window.innerWidth, h: window.innerHeight };
        // Long pages: bring the anchor into view first (never for the live carousel).
        if (found.box.y < 0 || found.box.y + found.box.h > vp.h) {
          found.el.scrollIntoView({ block: 'center', behavior: 'instant' });
          const again = findAnchor(step.selector);
          setAnchor({ id: step.id, box: padBox(again?.box ?? found.box, RING_PAD, vp) });
        } else {
          setAnchor({ id: step.id, box: padBox(found.box, RING_PAD, vp) });
        }
        setAnnounce(`${uiText('Passo {0} de {1}', index + 1, total)}. ${step.title}. ${step.body}`);
      } else if (Date.now() - started > FIND_TIMEOUT_MS) {
        clearInterval(timer);
        go(dir.current);
      }
    }, FIND_EVERY_MS);
    return () => clearInterval(timer);
  }, [active, step?.id, language]);

  // Keep the cut-out on the anchor: resize, rotation, scroll and layout changes.
  useEffect(() => {
    if (!active || !step || anchor?.id !== step.id) return;
    const measure = () => {
      const found = findAnchor(step.selector);
      const vp = { w: window.innerWidth, h: window.innerHeight };
      if (!found) {
        lost.current += 1;
        if (lost.current > 4) go(dir.current);
        return;
      }
      lost.current = 0;
      const next = padBox(found.box, RING_PAD, vp);
      setAnchor((cur) => {
        const c = cur?.box;
        return cur && c && c.x === next.x && c.y === next.y && c.w === next.w && c.h === next.h
          ? cur
          : { id: step.id, box: next };
      });
    };
    const timer = setInterval(measure, REMEASURE_MS);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    window.addEventListener('scroll', measure, true);
    const ro = new ResizeObserver(measure);
    if (anchorEl.current) ro.observe(anchorEl.current);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      window.removeEventListener('scroll', measure, true);
      ro.disconnect();
    };
  }, [active, step, anchor?.id, go]);

  // Keyboard, in the capture phase of the window so the screens below never see the keys.
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const onButton = e.target instanceof HTMLButtonElement;
      if (e.key === 'Escape') {
        endTour('skipped');
      } else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !onButton)) {
        go(1);
      } else if (e.key === 'ArrowLeft') {
        go(-1);
      } else if (e.key === 'Tab') {
        const list = Array.from(
          document.querySelectorAll<HTMLElement>(`.tour-balloon ${FOCUSABLE}`),
        );
        const balloon = document.querySelector('.tour-balloon');
        const head = list[0];
        const tail = list[list.length - 1];
        const inside = balloon?.contains(document.activeElement) ?? false;
        if (!head || !tail) {
          e.preventDefault();
        } else if (e.shiftKey && (document.activeElement === head || !inside)) {
          e.preventDefault();
          tail.focus();
        } else if (!e.shiftKey && (document.activeElement === tail || !inside)) {
          e.preventDefault();
          head.focus();
        }
        e.stopPropagation();
        return;
      } else if (e.key === 'Enter' || e.key === ' ') {
        // a focused button handles its own activation
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      if (e.key !== 'Enter') e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previous?.focus?.({ preventScroll: true });
    };
  }, [active, go]);

  if (!active || !step) return null;
  const box = anchor?.id === step.id ? anchor.box : null;
  return createPortal(
    <div className="tour-root" data-no-gesture>
      <div className="tour-block" data-empty={anchor ? undefined : '1'} aria-hidden="true" />
      {anchor && (
        <div
          className="tour-spot"
          aria-hidden="true"
          style={{
            left: anchor.box.x,
            top: anchor.box.y,
            width: anchor.box.w,
            height: anchor.box.h,
          }}
        />
      )}
      {box && (
        <Balloon
          step={step}
          index={index}
          total={total}
          demo={demo}
          box={box}
          onNext={() => go(1)}
          onBack={() => go(-1)}
          onSkip={() => endTour('skipped')}
        />
      )}
      <div className="tour-sr" aria-live="polite">
        {announce}
      </div>
    </div>,
    document.body,
  );
}
