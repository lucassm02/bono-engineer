/** Rules of the "session ended" card on Início (spec 12). */

/** How long after it ended a session still gets the card (ms). */
export const RECENT_SESSION_MS = 3 * 60 * 60 * 1000;

/** Whether the session is recent, finished, had laps, was driven live and was not seen yet. */
export function shouldOfferSummary(
  s: { id: string; endedAt: number | null; lapCount: number; mode: string },
  seen: readonly string[],
  now = Date.now(),
): boolean {
  return (
    s.mode === 'live' &&
    s.endedAt !== null &&
    s.lapCount > 0 &&
    now - s.endedAt <= RECENT_SESSION_MS &&
    !seen.includes(s.id)
  );
}
