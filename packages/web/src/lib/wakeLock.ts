/**
 * Keeps the screen on while the dashboard is open.
 *
 * 1. Screen Wake Lock API (secure contexts only: https or localhost), re-acquired when the page
 *    becomes visible again.
 * 2. Fallback for plain-http LAN pages (NoSleep technique): a muted, inline, looping video playing
 *    a tiny canvas stream. Must start from a user gesture, so it is armed on the first pointerdown.
 * The UI also shows a hint to disable auto-lock, since neither path is guaranteed on every phone.
 */

import type { KeepAwakeMode } from '../state/uiStore.ts';

type Listener = (mode: KeepAwakeMode) => void;

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', cb: () => void): void;
}

let sentinel: WakeLockSentinelLike | null = null;
let video: HTMLVideoElement | null = null;
let canvasTimer: ReturnType<typeof setInterval> | null = null;

async function requestWakeLock(): Promise<boolean> {
  const wl = (
    navigator as Navigator & {
      wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
    }
  ).wakeLock;
  if (!wl || !window.isSecureContext) return false;
  try {
    sentinel = await wl.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
    return true;
  } catch {
    return false;
  }
}

async function startVideoFallback(): Promise<boolean> {
  if (video) {
    try {
      await video.play();
      return true;
    } catch {
      return false;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof canvas.captureStream !== 'function') return false;
  let on = false;
  const paint = () => {
    on = !on;
    ctx.fillStyle = on ? '#000' : '#010101';
    ctx.fillRect(0, 0, 2, 2);
  };
  paint();
  canvasTimer = setInterval(paint, 1000);
  const v = document.createElement('video');
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('muted', '');
  v.setAttribute('aria-hidden', 'true');
  v.style.cssText =
    'position:fixed;width:1px;height:1px;opacity:0.01;pointer-events:none;left:0;bottom:0;';
  v.srcObject = canvas.captureStream(1);
  document.body.appendChild(v);
  video = v;
  try {
    await v.play();
    return true;
  } catch {
    if (canvasTimer) clearInterval(canvasTimer);
    v.remove();
    video = null;
    return false;
  }
}

async function acquire(): Promise<KeepAwakeMode> {
  if (await requestWakeLock()) return 'wakeLock';
  if (await startVideoFallback()) return 'video';
  return 'none';
}

/** Arms keep-awake on the first user interaction and re-acquires it on visibility changes. */
export function setupKeepAwake(onMode: Listener): void {
  let armed = false;
  const onFirstInteraction = () => {
    if (armed) return;
    armed = true;
    window.removeEventListener('pointerdown', onFirstInteraction, true);
    window.removeEventListener('keydown', onFirstInteraction, true);
    void acquire().then(onMode);
  };
  window.addEventListener('pointerdown', onFirstInteraction, true);
  window.addEventListener('keydown', onFirstInteraction, true);
  document.addEventListener('visibilitychange', () => {
    if (!armed || document.visibilityState !== 'visible') return;
    if (sentinel && !sentinel.released) return;
    void acquire().then(onMode);
  });
}
