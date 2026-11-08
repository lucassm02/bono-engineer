/** Shift-light math (pure). */

export type ShiftZone = 'green' | 'amber' | 'red';

/**
 * Number of lit lights for an RPM inside the alert range [min, max] given by the game. Below `min`
 * nothing is lit; at or above `max` everything is lit and `limiter` is true (flash). When the game
 * reports no usable range (min ≥ max or zeros), a fallback of 72–96 % of `rpmCeiling` is used.
 */
export function shiftLightLevel(
  rpm: number,
  alert: { min: number; max: number },
  count: number,
  rpmCeiling = 9000,
): { lit: number; limiter: boolean } {
  let { min, max } = alert;
  if (!(max > min) || max <= 0) {
    min = rpmCeiling * 0.72;
    max = rpmCeiling * 0.96;
  }
  if (rpm >= max) return { lit: count, limiter: true };
  if (rpm <= min) return { lit: 0, limiter: false };
  return { lit: Math.min(count, Math.ceil(((rpm - min) / (max - min)) * count)), limiter: false };
}

/** Colour zone of light `i` (0-based) out of `count`: 40 % green, 35 % amber, rest red. */
export function shiftZone(i: number, count: number): ShiftZone {
  const f = (i + 1) / count;
  if (f <= 0.4) return 'green';
  if (f <= 0.75) return 'amber';
  return 'red';
}
