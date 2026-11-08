/**
 * Salsa20 packet cipher used by GT7's Simulator Interface (study §4).
 *
 * - key   = first 32 bytes of "Simulator Interface Packet GT7 ver 0.0"
 * - iv1   = u32le at 0x40 of the CIPHERTEXT (the seed is readable before decryption)
 * - iv2   = iv1 ^ XOR[format]
 * - nonce = le32(iv2) || le32(iv1), counter starts at 0, whole datagram is XORed.
 *
 * Because the whole buffer is XORed, bytes 0x40..0x43 of the decrypted plaintext are garbage
 * (seed ^ keystream); parsers skip them. {@link encryptPacket} mimics this faithfully: it writes the
 * seed into the ciphertext at 0x40, i.e. it sets plaintext[0x40..0x43] = seed ^ keystream before
 * XORing. Consequences:
 * - decrypt(encrypt(p, seed)) equals p everywhere except 0x40..0x43;
 * - encrypt(decrypt(c), seedOf(c)) === c exactly (byte-for-byte), so recordings of decrypted
 *   packets can be re-encrypted into the original datagrams.
 */

import {
  formatFromLength,
  PACKET_FORMATS,
  PACKET_XOR_KEYS,
  type PacketFormat,
  TELEMETRY_MAGIC,
} from '@gt7/shared';
import { salsa20 } from '@noble/ciphers/salsa.js';

const KEY_STRING = 'Simulator Interface Packet GT7 ver 0.0';
/** 32-byte Salsa20 key ("Simulator Interface Packet GT7 v"). */
export const GT7_KEY: Uint8Array = new TextEncoder().encode(KEY_STRING).slice(0, 32);

/** Offset of the plaintext IV seed in the ciphertext. */
export const IV_SEED_OFFSET = 0x40;

/** Builds the 8-byte Salsa20 nonce from the seed and the XOR constant. */
export function buildNonce(seed: number, xorKey: number): Uint8Array {
  const nonce = new Uint8Array(8);
  const dv = new DataView(nonce.buffer);
  const iv1 = seed >>> 0;
  const iv2 = (iv1 ^ xorKey) >>> 0;
  dv.setUint32(0, iv2, true);
  dv.setUint32(4, iv1, true);
  return nonce;
}

/** Reads the u32le IV seed at 0x40 of a ciphertext. */
export function readSeed(cipher: Uint8Array): number {
  return new DataView(cipher.buffer, cipher.byteOffset, cipher.byteLength).getUint32(
    IV_SEED_OFFSET,
    true,
  );
}

/** Raw Salsa20 XOR with the GT7 key and a seed/XOR-derived nonce (encrypt == decrypt). */
export function salsaXor(data: Uint8Array, seed: number, xorKey: number): Uint8Array {
  return salsa20(GT7_KEY, buildNonce(seed, xorKey), data);
}

/** True if the buffer starts with the GT7 magic (int32 LE 0x47375330). */
export function hasValidMagic(plain: Uint8Array): boolean {
  if (plain.byteLength < 4) return false;
  return (
    new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getUint32(0, true) ===
    TELEMETRY_MAGIC
  );
}

export interface DecryptResult {
  /** Format detected by datagram length. */
  format: PacketFormat;
  /** Decrypted plaintext (same length as the datagram). Bytes 0x40..0x43 are garbage. */
  plain: Uint8Array;
  /** XOR constant that produced a valid magic. */
  xorKey: number;
  /** True when the XOR constant of the length-detected format failed and another one worked. */
  xorMismatch: boolean;
}

export interface DecryptOptions {
  /**
   * Force a format instead of detecting it by length (the datagram must still be at least that
   * long; the whole datagram is decrypted).
   */
  format?: PacketFormat;
  /**
   * When the magic does not validate with the expected XOR constant, try the other known
   * constants (useful for the less-verified C format). Default true.
   */
  xorFallback?: boolean;
}

/**
 * Decrypts and validates a GT7 datagram. Returns null for unknown sizes or invalid magic.
 * Never throws for malformed input.
 */
export function decryptPacket(data: Uint8Array, opts: DecryptOptions = {}): DecryptResult | null {
  const format = opts.format ?? formatFromLength(data.byteLength);
  if (format === null || data.byteLength < IV_SEED_OFFSET + 4) return null;
  const seed = readSeed(data);
  const primary = PACKET_XOR_KEYS[format];
  const plain = salsaXor(data, seed, primary);
  if (hasValidMagic(plain)) return { format, plain, xorKey: primary, xorMismatch: false };
  if (opts.xorFallback === false) return null;
  const tried = new Set<number>([primary]);
  for (const f of PACKET_FORMATS) {
    const k = PACKET_XOR_KEYS[f];
    if (tried.has(k)) continue;
    tried.add(k);
    const p = salsaXor(data, seed, k);
    if (hasValidMagic(p)) return { format, plain: p, xorKey: k, xorMismatch: true };
  }
  return null;
}

/**
 * Encrypts a plaintext packet like the console does (see module doc). The input is not modified.
 * @param plain plaintext packet (length decides nothing here; `format` selects the XOR constant)
 * @param format packet format (selects the XOR constant)
 * @param seed u32 IV seed written at 0x40 of the ciphertext
 */
export function encryptPacket(plain: Uint8Array, format: PacketFormat, seed: number): Uint8Array {
  const s = seed >>> 0;
  const xorKey = PACKET_XOR_KEYS[format];
  const cipher = salsaXor(plain, s, xorKey);
  // Overwrite the seed in clear: equivalent to plaintext[0x40..] = seed ^ keystream.
  new DataView(cipher.buffer, cipher.byteOffset, cipher.byteLength).setUint32(
    IV_SEED_OFFSET,
    s,
    true,
  );
  return cipher;
}
