import { describe, expect, it } from 'vitest';
import {
  decodeFlags,
  decodeGearByte,
  encodeFlags,
  encodeGearByte,
  formatFromLength,
  formatIncludes,
  hasFlag,
  isDriving,
  SimulatorFlags,
  wheelSlipRatios,
} from './telemetry.ts';
import { createDefaultDeviceProfile, isViewId, VIEW_IDS } from './ui.ts';

describe('telemetry helpers', () => {
  it('detects formats by length', () => {
    expect(formatFromLength(296)).toBe('A');
    expect(formatFromLength(316)).toBe('B');
    expect(formatFromLength(344)).toBe('~');
    expect(formatFromLength(368)).toBe('C');
    expect(formatFromLength(300)).toBeNull();
    expect(formatIncludes('C', 'B')).toBe(true);
    expect(formatIncludes('A', 'B')).toBe(false);
  });

  it('decodes and encodes the gear byte', () => {
    expect(decodeGearByte(0xf3)).toEqual({ gear: 3, suggested: null });
    expect(decodeGearByte(0x24)).toEqual({ gear: 4, suggested: 2 });
    expect(encodeGearByte(5, null)).toBe(0xf5);
    expect(encodeGearByte(1, 2)).toBe(0x21);
  });

  it('round-trips flags', () => {
    const f = SimulatorFlags.CarOnTrack | SimulatorFlags.TcsActive | SimulatorFlags.HasTurbo;
    const d = decodeFlags(f);
    expect(d.carOnTrack && d.tcsActive && d.hasTurbo).toBe(true);
    expect(d.paused).toBe(false);
    expect(encodeFlags(d)).toBe(f);
    expect(hasFlag(f, SimulatorFlags.TcsActive)).toBe(true);
    expect(isDriving(f)).toBe(true);
    expect(isDriving(f | SimulatorFlags.Paused)).toBe(false);
  });

  it('computes slip ratios', () => {
    const r = wheelSlipRatios({
      speedMps: 30,
      tyreRadius: [0.3, 0.3, 0.3, 0.3],
      wheelRps: [100, -100, 110, 90],
    });
    expect(r[0]).toBeCloseTo(0);
    expect(r[1]).toBeCloseTo(0);
    expect(r[2]).toBeCloseTo(0.1);
    expect(r[3]).toBeCloseTo(-0.1);
  });

  it('has 11 views and a valid default device profile', () => {
    expect(VIEW_IDS.length).toBe(11);
    const p = createDefaultDeviceProfile('abc');
    expect(p.views.every(isViewId)).toBe(true);
    expect(isViewId(p.startView)).toBe(true);
  });
});
