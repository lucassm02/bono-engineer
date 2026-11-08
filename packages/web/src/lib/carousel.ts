/** Circular carousel index helpers. */

/** Wraps any integer index into 0..count-1 (count ≥ 1). */
export function wrapIndex(i: number, count: number): number {
  if (count <= 0) return 0;
  return ((i % count) + count) % count;
}

/** Index after moving `step` positions in a circular list. */
export function stepIndex(i: number, step: number, count: number): number {
  return wrapIndex(i + step, count);
}

/** Slot roles rendered by the carousel, left to right. */
export type SlotRole = 'prev' | 'cur' | 'next';

/**
 * Slots rendered by the carousel (indices into the view list): previous, current and next.
 * With a single view there are no neighbours.
 */
export function carouselSlots(current: number, count: number): { role: SlotRole; index: number }[] {
  const cur = wrapIndex(current, count);
  if (count <= 1) return [{ role: 'cur', index: cur }];
  return [
    { role: 'prev', index: wrapIndex(cur - 1, count) },
    { role: 'cur', index: cur },
    { role: 'next', index: wrapIndex(cur + 1, count) },
  ];
}

/** Which slot the scroller settled on, given scrollLeft and slot width. */
export function settledSlot(scrollLeft: number, slotWidth: number, slotCount: number): number {
  if (slotWidth <= 0) return 0;
  const s = Math.round(scrollLeft / slotWidth);
  return s < 0 ? 0 : Math.min(s, slotCount - 1);
}
