import { useEffect, useRef } from 'react';
import { animateStep, Carousel } from './components/Carousel.tsx';
import {
  Dots,
  EdgeArrows,
  LockButton,
  Notices,
  OverlayHeader,
  SourceBadge,
} from './components/Chrome.tsx';
import { LapPopup } from './components/LapPopup.tsx';
import { StatusLayer } from './components/StatusLayer.tsx';
import { useGestures } from './components/useGestures.ts';
import { ViewPicker } from './components/ViewPicker.tsx';
import type { GestureOutput } from './lib/gestures.ts';
import {
  closePicker,
  cycleDeltaReference,
  openPicker,
  setLocked,
  showOverlay,
} from './state/actions.ts';
import { useUi } from './state/uiStore.ts';

function onGesture(g: GestureOutput): void {
  const s = useUi.getState();
  if (s.pickerOpen || s.profile.locked) return;
  if (g === 'tap') showOverlay();
  else if (g === 'doubleTap') cycleDeltaReference();
  else if (g === 'longPress') openPicker();
}

function onKey(e: KeyboardEvent): void {
  if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
  const s = useUi.getState();
  if (e.key === 'Escape') {
    if (s.pickerOpen) closePicker();
    return;
  }
  if (s.pickerOpen) return;
  if (e.key.toLowerCase() === 'l') {
    setLocked(!s.profile.locked);
    return;
  }
  if (s.profile.locked) return;
  if (e.key === 'ArrowRight') animateStep(1);
  else if (e.key === 'ArrowLeft') animateStep(-1);
  else if (e.key === 'Enter') openPicker();
  else if (e.key.toLowerCase() === 'd') cycleDeltaReference();
  else if (e.key === ' ') showOverlay();
}

export function App() {
  const rootRef = useRef<HTMLDivElement>(null);
  const locked = useUi((s) => s.profile.locked);
  useGestures(rootRef, onGesture);

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app" ref={rootRef} data-locked={locked ? '1' : '0'}>
      <Carousel />
      <StatusLayer />
      <SourceBadge />
      <OverlayHeader />
      <EdgeArrows />
      <Dots />
      <LockButton />
      <LapPopup />
      <Notices />
      <ViewPicker />
    </div>
  );
}
