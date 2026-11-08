/**
 * Whether a captured "top" reference exists for a track, inferred from live frames (the WS
 * contract has no explicit field yet). When the server applies `reference` and reports no
 * reference lap (`delta.referenceLapId === null`) the track is marked as having none; any frame
 * with a reference lap marks it as available. Unknown tracks default to "available" so the
 * double-tap cycle tries it once.
 */

import type { DeltaReferenceKind } from '@gt7/shared';

export class ReferenceAvailability {
  private readonly known = new Map<string, boolean>();

  observe(
    trackKey: string,
    kind: DeltaReferenceKind,
    referenceLapId: string | null,
    onTrack: boolean,
  ): void {
    if (!onTrack || kind !== 'reference') return;
    this.known.set(trackKey, referenceLapId !== null);
  }

  available(trackKey: string): boolean {
    return this.known.get(trackKey) ?? true;
  }

  clear(): void {
    this.known.clear();
  }
}
