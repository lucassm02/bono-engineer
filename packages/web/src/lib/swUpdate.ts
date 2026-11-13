/**
 * "Nova versão — atualizar": the PWA service worker (vite-plugin-pwa, `registerType: 'autoUpdate'`)
 * downloads a new build in the background and takes control by itself (skipWaiting + clientsClaim),
 * but the page that is already open keeps running the old JavaScript until it is reloaded.
 * This module notices that moment (a `controllerchange` on a page that already had a worker),
 * checks for updates periodically and tells the UI so it can offer a reload.
 */

import { create } from 'zustand';

/** The slice of `ServiceWorkerContainer` that is used (so it can be tested with a fake). */
export interface ServiceWorkerLike {
  controller: unknown;
  addEventListener(type: 'controllerchange', listener: () => void): void;
  removeEventListener(type: 'controllerchange', listener: () => void): void;
  getRegistration?(): Promise<{ update(): Promise<unknown> } | undefined>;
}

/** How often an open page asks the server whether a new build exists (ms). */
export const UPDATE_CHECK_MS = 30 * 60_000;

/**
 * Calls `onUpdate` once when a new worker takes over a page that was already controlled (the very
 * first install also fires `controllerchange`; that is not an update). Returns a stop function.
 */
export function watchServiceWorkerUpdates(sw: ServiceWorkerLike, onUpdate: () => void): () => void {
  const hadController = !!sw.controller;
  let fired = false;
  const on = () => {
    if (!hadController || fired) return;
    fired = true;
    onUpdate();
  };
  sw.addEventListener('controllerchange', on);
  return () => sw.removeEventListener('controllerchange', on);
}

interface SwUpdateState {
  available: boolean;
  dismissed: boolean;
}

export const useSwUpdate = create<SwUpdateState>()(() => ({ available: false, dismissed: false }));

export function dismissSwUpdate(): void {
  useSwUpdate.setState({ dismissed: true });
}

/** Reloads the page, which now gets the new build from the worker that already took over. */
export function applySwUpdate(): void {
  location.reload();
}

let started = false;

/** Starts watching (once). Safe where service workers do not exist (http on the LAN, tests). */
export function startSwUpdateWatch(): void {
  if (started || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  started = true;
  const sw = navigator.serviceWorker;
  watchServiceWorkerUpdates(sw, () => useSwUpdate.setState({ available: true, dismissed: false }));
  if (import.meta.env.PROD) void sw.register('/sw.js').catch(() => {});
  const check = () => {
    sw.getRegistration()
      .then((r) => r?.update())
      .catch(() => {});
  };
  setInterval(check, UPDATE_CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}
