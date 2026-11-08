import { PACKET_SIZES, PACKET_XOR_KEYS, type PacketFormat, TELEMETRY_MAGIC } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import {
  buildNonce,
  decryptPacket,
  encryptPacket,
  GT7_KEY,
  hasValidMagic,
  readSeed,
  salsaXor,
} from './crypto.ts';
import { encodePacket } from './encode.ts';
import { generateLaps } from './simulator/synthetic/index.ts';

const FORMATS: PacketFormat[] = ['A', 'B', '~', 'C'];

function samplePlain(format: PacketFormat): Uint8Array {
  const { packets } = generateLaps({ laps: 0, format, seed: 3 });
  return encodePacket(packets[200]!, format);
}

describe('crypto', () => {
  it('uses the first 32 bytes of the key string', () => {
    expect(new TextDecoder().decode(GT7_KEY)).toBe('Simulator Interface Packet GT7 v');
    expect(GT7_KEY.byteLength).toBe(32);
  });

  it('builds nonce = le32(iv1 ^ xor) || le32(iv1)', () => {
    const n = buildNonce(0x12345678, 0xdeadbeaf);
    const dv = new DataView(n.buffer);
    expect(dv.getUint32(0, true)).toBe((0x12345678 ^ 0xdeadbeaf) >>> 0);
    expect(dv.getUint32(4, true)).toBe(0x12345678);
    expect([...n.slice(4)]).toEqual([0x78, 0x56, 0x34, 0x12]);
  });

  it('has distinct XOR constants per format (A ends in AF, B in EF)', () => {
    expect(PACKET_XOR_KEYS.A).toBe(0xdeadbeaf);
    expect(PACKET_XOR_KEYS.B).toBe(0xdeadbeef);
    expect(PACKET_XOR_KEYS['~']).toBe(0x55fabb4f);
    expect(PACKET_XOR_KEYS.C).toBe(0xdeadbeef);
  });

  for (const f of FORMATS) {
    it(`round-trips format ${f} and detects it by length`, () => {
      const plain = samplePlain(f);
      expect(plain.byteLength).toBe(PACKET_SIZES[f]);
      const seed = 0xcafebabe;
      const cipher = encryptPacket(plain, f, seed);
      // seed is readable in clear at 0x40 of the ciphertext
      expect(readSeed(cipher)).toBe(seed);
      // ciphertext does not reveal the magic
      expect(hasValidMagic(cipher)).toBe(false);
      const dec = decryptPacket(cipher);
      expect(dec).not.toBeNull();
      expect(dec!.format).toBe(f);
      expect(dec!.xorMismatch).toBe(false);
      expect(new DataView(dec!.plain.buffer).getUint32(0, true)).toBe(TELEMETRY_MAGIC);
      // identical everywhere except the IV seed bytes 0x40..0x43
      const a = [...plain];
      const b = [...dec!.plain];
      for (let i = 0x40; i < 0x44; i++) {
        a[i] = 0;
        b[i] = 0;
      }
      expect(b).toEqual(a);
    });
  }

  it('bytes 0x40..0x43 of the decrypted plaintext are seed ^ keystream (garbage), and re-encryption is exact', () => {
    const plain = samplePlain('A');
    const seed = 0x01020304;
    const cipher = encryptPacket(plain, 'A', seed);
    const dec = decryptPacket(cipher)!;
    const ks = salsaXor(new Uint8Array(PACKET_SIZES.A), seed, PACKET_XOR_KEYS.A);
    for (let i = 0; i < 4; i++) {
      expect(dec.plain[0x40 + i]).toBe((cipher[0x40 + i]! ^ ks[0x40 + i]!) & 0xff);
    }
    // encrypt(decrypt(c), seedOf(c)) === c byte for byte
    expect([...encryptPacket(dec.plain, 'A', readSeed(cipher))]).toEqual([...cipher]);
  });

  it('fails magic validation with the wrong XOR constant', () => {
    const plain = samplePlain('A');
    const cipher = encryptPacket(plain, 'A', 42);
    const wrong = salsaXor(cipher, 42, PACKET_XOR_KEYS.B);
    expect(hasValidMagic(wrong)).toBe(false);
    const right = salsaXor(cipher, 42, PACKET_XOR_KEYS.A);
    expect(hasValidMagic(right)).toBe(true);
    // strict decrypt with a forced wrong format fails
    expect(decryptPacket(cipher, { format: 'B', xorFallback: false })).toBeNull();
  });

  it('falls back to another XOR constant and reports the mismatch', () => {
    // a C-sized packet encrypted with the '~' constant (in case C's constant is wrong in reality)
    const plain = samplePlain('C');
    const cipher = salsaXor(plain, 7, PACKET_XOR_KEYS['~']);
    new DataView(cipher.buffer).setUint32(0x40, 7, true);
    const dec = decryptPacket(cipher);
    expect(dec).not.toBeNull();
    expect(dec!.xorMismatch).toBe(true);
    expect(dec!.xorKey).toBe(PACKET_XOR_KEYS['~']);
    expect(decryptPacket(cipher, { xorFallback: false })).toBeNull();
  });

  it('rejects unknown sizes and garbage without throwing', () => {
    expect(decryptPacket(new Uint8Array(100))).toBeNull();
    expect(decryptPacket(new Uint8Array(PACKET_SIZES.A))).toBeNull();
    const junk = new Uint8Array(PACKET_SIZES.B).map((_, i) => (i * 31) & 0xff);
    expect(decryptPacket(junk)).toBeNull();
  });
});
