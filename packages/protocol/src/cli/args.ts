/** Tiny helpers shared by the CLIs. */

import { isPacketFormat, type PacketFormat } from '@gt7/shared';

export function toInt(v: string | undefined, name: string, def: number): number {
  if (v === undefined) return def;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be an integer (got "${v}")`);
  return n;
}

export function toFormat(v: string | undefined, def: PacketFormat): PacketFormat {
  if (v === undefined) return def;
  if (!isPacketFormat(v)) throw new Error(`--format must be one of A, B, ~, C (got "${v}")`);
  return v;
}

export function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

/** Installs SIGINT/SIGTERM handlers that run `cleanup` once, then exit. */
export function onShutdown(cleanup: () => Promise<void>): void {
  let done = false;
  const handler = () => {
    if (done) return;
    done = true;
    cleanup()
      .catch((e) => console.error(e))
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
}
