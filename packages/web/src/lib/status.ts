/** Which status screen/banner to show (pure). */

export type StatusKind =
  | 'none'
  | 'connectingServer'
  | 'noServer'
  | 'noConsole'
  | 'menu'
  | 'paused'
  | 'switchingFormat';

/** Pure decision of which status to show (exported for tests). */
export function statusKind(s: {
  source: 'server' | 'mock';
  wsStatus: 'idle' | 'connecting' | 'open' | 'closed';
  wsEverOpened: boolean;
  wsAttempt: number;
  liveState: string | null;
}): StatusKind {
  if (s.source === 'server') {
    if (s.wsStatus !== 'open') {
      return !s.wsEverOpened && s.wsAttempt < 1 ? 'connectingServer' : 'noServer';
    }
    if (s.liveState === null || s.liveState === 'disconnected' || s.liveState === 'connecting') {
      return 'noConsole';
    }
  }
  if (s.liveState === 'menu') return 'menu';
  if (s.liveState === 'paused') return 'paused';
  if (s.liveState === 'switchingFormat') return 'switchingFormat';
  return 'none';
}
