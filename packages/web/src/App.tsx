import { PRODUCT_NAME } from '@gt7/shared';
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
import { ConsolePanelHost } from './components/ConsoleLink.tsx';
import { LapPopup } from './components/LapPopup.tsx';
import { LayoutEditor } from './components/LayoutEditor.tsx';
import { LiveEngineer } from './components/LiveEngineer.tsx';
import { LiveMenuSheet, MenuButton } from './components/LiveMenu.tsx';
import { StatusLayer } from './components/StatusLayer.tsx';
import { useGestures } from './components/useGestures.ts';
import { ViewPicker } from './components/ViewPicker.tsx';
import type { GestureOutput } from './lib/gestures.ts';
import {
  closeLayoutEditor,
  closeMenu,
  closePicker,
  cycleDeltaReference,
  openPicker,
  setLocked,
  showOverlay,
  toggleMenu,
} from './state/actions.ts';
import { handleDoubleTapOverride } from './state/gestureOverride.ts';
import { useUi } from './state/uiStore.ts';

function onGesture(g: GestureOutput): void {
  const s = useUi.getState();
  if (s.pickerOpen || s.menuOpen || s.layoutEditorOpen || s.profile.locked || s.connectionPanelOpen)
    return;
  if (g === 'tap') showOverlay();
  else if (g === 'doubleTap') {
    if (!handleDoubleTapOverride()) cycleDeltaReference();
  } else if (g === 'longPress') openPicker();
}

function onKey(e: KeyboardEvent): void {
  if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
  const s = useUi.getState();
  if (e.key === 'Escape') {
    if (s.layoutEditorOpen) closeLayoutEditor();
    else if (s.menuOpen) closeMenu();
    else if (s.pickerOpen) closePicker();
    return;
  }
  if (s.onboarding === 'active' || s.connectionPanelOpen) return;
  if (e.key.toLowerCase() === 'm' && !s.pickerOpen && !s.layoutEditorOpen) {
    toggleMenu();
    return;
  }
  if (s.pickerOpen || s.menuOpen || s.layoutEditorOpen) return;
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
    document.title = PRODUCT_NAME;
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
      <LiveEngineer />
      <MenuButton />
      <LockButton />
      <LapPopup />
      <Notices />
      <LiveMenuSheet />
      <ViewPicker />
      <LayoutEditor />
      <ConsolePanelHost />
    </div>
  );
}
