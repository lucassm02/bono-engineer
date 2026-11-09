/** Name of the driver of a reference lap when the user does not type one (Onda 10a). */

/** Used when a replay capture starts without a driver name. */
export const DEFAULT_REPLAY_DRIVER = 'Piloto do replay';

/** Longest driver name accepted by the capture and the reference metadata. */
export const MAX_DRIVER_NAME = 80;

/**
 * Trimmed, length-limited driver name; anything empty / not a string becomes
 * {@link DEFAULT_REPLAY_DRIVER}. Never throws.
 */
export function normalizeDriverName(input: unknown): string {
  if (typeof input !== 'string') return DEFAULT_REPLAY_DRIVER;
  const name = input.trim().replace(/\s+/g, ' ').slice(0, MAX_DRIVER_NAME).trim();
  return name || DEFAULT_REPLAY_DRIVER;
}
