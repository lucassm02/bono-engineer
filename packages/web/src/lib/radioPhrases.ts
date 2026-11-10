/**
 * The radio phrase catalog lives in @gt7/shared (packages/shared/src/radio/phrases.ts) so the
 * radio decision engine and replays use the same fixed phrases as the voice packs.
 * This module keeps the web import path and the generator entry (scripts/radio-voices).
 */

export * from '@gt7/shared/radio-phrases';
