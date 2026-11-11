import { isSafeToPrompt, SAFE_SPEED_KMH } from '../lib/liveContext.ts';
import { useLiveContext } from '../state/liveContext.ts';
import { useUi } from '../state/uiStore.ts';

/**
 * May the app ask the driver something right now? True with the car stopped (< 10 km/h), the game
 * paused or in a menu, or no data at all; false while driving. Every prompt of specs 05 and 06
 * (the "Pista de hoje" sheet, the mismatch notice, the opening chip) goes through here.
 */
export function useSafeToPrompt(): boolean {
  const state = useUi((s) => s.liveState);
  const stopped = useLiveContext((s) => s.stopped);
  return isSafeToPrompt({ state, speedKmh: stopped ? 0 : SAFE_SPEED_KMH });
}
