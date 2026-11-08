import { PACKET_SIZES, type PacketFormat, SimulatorFlags, type TelemetryPacket } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { encodePacket } from './encode.ts';
import { OFFSETS } from './layout.ts';
import { PacketParseError, parsePacket, tryParsePacket } from './parse.ts';
import { generateLaps, stripToFormat } from './simulator/synthetic/index.ts';

const FORMATS: PacketFormat[] = ['A', 'B', '~', 'C'];
const f32 = Math.fround;

/** Rounds every float field to float32 so it can be compared with a parsed packet. */
function toF32(p: TelemetryPacket): TelemetryPacket {
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === 'number') {
      // integer fields stay exact; pedals are rounded bytes already
      return Number.isInteger(v) ? v : f32(v);
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    }
    return v;
  };
  return walk(p) as TelemetryPacket;
}

function sample(format: PacketFormat): TelemetryPacket {
  const { packets } = generateLaps({ laps: 0, format: 'C', seed: 11 });
  const p = packets[400]!;
  return stripToFormat(p, format);
}

describe('parse / encode', () => {
  for (const f of FORMATS) {
    it(`round-trips format ${f}`, () => {
      const p = sample(f);
      const buf = encodePacket(p, f);
      expect(buf.byteLength).toBe(PACKET_SIZES[f]);
      const back = parsePacket(buf);
      expect(back.format).toBe(f);
      expect(back).toEqual(toF32(p));
    });
  }

  it('omits extended fields not present in the format', () => {
    const a = parsePacket(encodePacket(sample('C'), 'A'));
    expect(a.steeringAngle).toBeUndefined();
    expect(a.throttleRaw).toBeUndefined();
    expect(a.currentLapMs).toBeUndefined();
    const b = parsePacket(encodePacket(sample('C'), 'B'));
    expect(b.steeringAngle).toBeTypeOf('number');
    expect(b.throttleRaw).toBeUndefined();
    const t = parsePacket(encodePacket(sample('C'), '~'));
    expect(t.throttleRaw).toBeTypeOf('number');
    expect(t.surfaceTypes).toBeUndefined();
  });

  it('a longer packet can be parsed as a shorter format (formats are additive)', () => {
    const buf = encodePacket(sample('C'), 'C');
    const asA = parsePacket(buf, 'A');
    expect(asA.format).toBe('A');
    expect(asA.speedMps).toBe(parsePacket(buf).speedMps);
  });

  it('places fields at the documented offsets (study §5)', () => {
    const p: TelemetryPacket = {
      ...sample('C'),
      speedMps: 50,
      gear: 3,
      suggestedGear: 2,
      throttle: 200,
      brake: 17,
      carCode: 3455,
      flags: SimulatorFlags.CarOnTrack | SimulatorFlags.TcsActive,
      packetId: 123456,
      lapCount: 4,
      totalLaps: 10,
      bestLapMs: 91234,
      lastLapMs: -1,
      engineRpm: 7000,
      steeringAngle: 0.5,
      throttleRaw: 222,
      currentLapMs: 45678,
      surfaceTypes: ['T', 'C', 'G', 'S'],
      carCategory: 'GR3',
    };
    const buf = encodePacket(p, 'C');
    const dv = new DataView(buf.buffer);
    expect(dv.getUint32(0x00, true)).toBe(0x47375330);
    expect(dv.getFloat32(0x4c, true)).toBe(50);
    expect(dv.getFloat32(0x3c, true)).toBe(7000);
    expect(buf[0x90]).toBe(0x23); // high nibble suggested 2, low nibble gear 3
    expect(buf[0x91]).toBe(200);
    expect(buf[0x92]).toBe(17);
    expect(dv.getInt32(0x124, true)).toBe(3455);
    expect(dv.getUint16(0x8e, true)).toBe(0x0801);
    expect(dv.getInt32(0x70, true)).toBe(123456);
    expect(dv.getInt16(0x74, true)).toBe(4);
    expect(dv.getInt16(0x76, true)).toBe(10);
    expect(dv.getInt32(0x78, true)).toBe(91234);
    expect(dv.getInt32(0x7c, true)).toBe(-1);
    expect(dv.getFloat32(0x128, true)).toBe(0.5);
    expect(buf[0x13c]).toBe(222);
    expect(dv.getInt32(0x15c, true)).toBe(45678);
    expect(String.fromCharCode(...buf.slice(0x158, 0x15c))).toBe('TCGS');
    expect(String.fromCharCode(...buf.slice(0x16c, 0x16f))).toBe('GR3');
    expect(OFFSETS.carCode).toBe(0x124);
    expect(OFFSETS.flags).toBe(0x8e);
    const back = parsePacket(buf);
    expect(back.gear).toBe(3);
    expect(back.suggestedGear).toBe(2);
    expect(back.carCategory).toBe('GR3');
    expect(back.surfaceTypes).toEqual(['T', 'C', 'G', 'S']);
  });

  it('rejects bad magic and unknown sizes', () => {
    const buf = encodePacket(sample('A'), 'A');
    buf[0] = 0;
    expect(() => parsePacket(buf)).toThrow(PacketParseError);
    expect(tryParsePacket(buf)).toBeNull();
    expect(tryParsePacket(new Uint8Array(10))).toBeNull();
  });
});
