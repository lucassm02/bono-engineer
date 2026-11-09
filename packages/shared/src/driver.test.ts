import { describe, expect, it } from 'vitest';
import { DEFAULT_REPLAY_DRIVER, MAX_DRIVER_NAME, normalizeDriverName } from './driver.ts';

describe('normalizeDriverName', () => {
  it('uses the default for missing, empty or non-text names', () => {
    expect(normalizeDriverName(undefined)).toBe(DEFAULT_REPLAY_DRIVER);
    expect(normalizeDriverName(null)).toBe(DEFAULT_REPLAY_DRIVER);
    expect(normalizeDriverName('')).toBe(DEFAULT_REPLAY_DRIVER);
    expect(normalizeDriverName('   ')).toBe(DEFAULT_REPLAY_DRIVER);
    expect(normalizeDriverName(42)).toBe(DEFAULT_REPLAY_DRIVER);
  });

  it('trims, collapses spaces and limits the length', () => {
    expect(normalizeDriverName('  Kokichi   Fujita ')).toBe('Kokichi Fujita');
    expect(normalizeDriverName('x'.repeat(200))).toHaveLength(MAX_DRIVER_NAME);
  });
});
