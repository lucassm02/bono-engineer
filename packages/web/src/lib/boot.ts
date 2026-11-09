/**
 * Where the app opens when the address has no route (`/`): the live dashboard if a race is on (or
 * the demo is running), otherwise the history home. Pure so it can be tested.
 */

import type { ConnectionState, ServerStatus } from '@gt7/shared';

export type BootTarget = 'wait' | 'live' | 'home';

/** Console states where the driver wants the live dashboard. */
const RACING: ReadonlySet<ConnectionState> = new Set<ConnectionState>([
  'onTrack',
  'paused',
  'replay',
]);

export interface BootInput {
  source: 'server' | 'mock';
  wsStatus: 'idle' | 'connecting' | 'open' | 'closed';
  liveState: ConnectionState | null;
  serverStatus: Pick<ServerStatus, 'connection'> | null;
  /** The wait for the server's first status ran out. */
  timedOut: boolean;
}

export function bootTarget(i: BootInput): BootTarget {
  if (i.source === 'mock') return 'live';
  const state = i.liveState ?? i.serverStatus?.connection ?? null;
  if (i.wsStatus === 'open' && state !== null) return RACING.has(state) ? 'live' : 'home';
  return i.timedOut ? 'home' : 'wait';
}

/** True when the page was opened without any route (installed app / bare URL). */
export function openedWithoutRoute(hash: string, search: string): boolean {
  if (new URLSearchParams(search).get('mock') === '1') return false;
  return hash === '' || hash === '#';
}

/** How long the splash waits for the server before opening the home anyway. */
export const BOOT_WAIT_MS = 2500;
