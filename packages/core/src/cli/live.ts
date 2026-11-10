/**
 * Live CLI: connects to a console (or `npm run sim`) and prints a compact live line.
 *
 *   npm run live -- --ps-ip <ip> [--data <dir>] [--format ~|A|B|C] [--ref personalBest|sessionBest|reference]
 *                   [--ref-lap <lapId>] [--bind-port 33740] [--console-port 33739] [--no-record]
 */

import { parseArgs } from 'node:util';
import {
  DELTA_REFERENCE_KINDS,
  type DeltaReferenceKind,
  isPacketFormat,
  type LiveFrame,
  type PacketFormat,
  type SectorSplit,
} from '@gt7/shared';
import { Gt7Runtime } from '../runtime/runtime.ts';
import { resolveDataDir } from '../util/data-dir.ts';

const { values } = parseArgs({
  options: {
    'ps-ip': { type: 'string' },
    data: { type: 'string' },
    format: { type: 'string' },
    ref: { type: 'string' },
    'ref-lap': { type: 'string' },
    'bind-port': { type: 'string' },
    'console-port': { type: 'string' },
    'no-record': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: false,
});

if (values.help) {
  console.log(`GT7 live line (core runtime).

Options:
  --ps-ip IP            console IP (default: last saved, else automatic discovery)
  --data DIR            data dir (default: the per-user Bono Engineer folder)
  --format F            packet format ~ | A | B | C (default: saved, else ~)
  --ref KIND            delta reference: personalBest | sessionBest | reference
  --ref-lap ID          reference lap id (with --ref reference)
  --bind-port N         local UDP port (default 33740)
  --console-port N      console UDP port (default 33739)
  --no-record           do not record raw sessions`);
  process.exit(0);
}

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

const fmtArg = values.format;
if (fmtArg !== undefined && !isPacketFormat(fmtArg)) fail('--format must be one of A, B, ~, C');
const fmt: PacketFormat | undefined = fmtArg;
const refArg = values.ref;
if (refArg !== undefined && !(DELTA_REFERENCE_KINDS as readonly string[]).includes(refArg)) {
  fail('--ref must be personalBest, sessionBest or reference');
}
const ref = refArg as DeltaReferenceKind | undefined;
const toPort = (v: string | undefined, name: string) => {
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) fail(`--${name} must be an integer`);
  return n;
};
const bindPort = toPort(values['bind-port'], 'bind-port');
const consolePort = toPort(values['console-port'], 'console-port');

function fmtTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '-:--.---';
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

function fmtDelta(ms: number | null): string {
  if (ms === null) return '  --.---';
  const s = (ms / 1000).toFixed(3);
  return (ms >= 0 ? `+${s}` : s).padStart(8);
}

const SECTOR_MARK: Record<SectorSplit['status'], string> = {
  overallBest: 'P',
  personalBest: 'G',
  sessionBest: 'g',
  slower: 'y',
  pending: '.',
};

function line(f: LiveFrame): string {
  const sectors = f.sectors.map((s) => SECTOR_MARK[s.status]).join('') || '---';
  const fuel = f.fuel.lapsRemaining !== null ? `${f.fuel.lapsRemaining.toFixed(1)}v` : '--';
  const dist = f.distanceM !== null ? `${Math.round(f.distanceM)}m` : '--';
  return [
    `[${f.state}]`.padEnd(12),
    `L${f.lap.lap}${f.lap.totalLaps ? `/${f.lap.totalLaps}` : ''}`,
    fmtTime(f.lap.currentLapMs),
    `Δ${fmtDelta(f.lap.delta.ms)}`,
    `prev ${fmtTime(f.lap.predictedLapMs)}`,
    `S[${sectors}]`,
    `best ${fmtTime(f.lap.bestLapMs)}`,
    `${Math.round(f.car.speedKmh)}km/h g${f.car.gear}`,
    dist,
    `fuel ${fuel}`,
    f.track ? `${f.track.name}` : '',
  ].join('  ');
}

async function main(): Promise<void> {
  const runtime = new Gt7Runtime({
    dataDir: resolveDataDir({ override: values.data }),
    ...(values['ps-ip'] ? { consoleIp: values['ps-ip'] } : {}),
    ...(fmt ? { liveFormat: fmt } : {}),
    ...(values['no-record'] ? { record: false } : {}),
    ingestor: {
      ...(bindPort !== undefined ? { bindPort } : {}),
      ...(consolePort !== undefined ? { consolePort } : {}),
    },
  });
  if (ref) runtime.setDeltaReference(ref, values['ref-lap'] ?? null);
  let lastPrint = 0;
  const tty = process.stdout.isTTY;
  runtime.on('frame', (f) => {
    const now = Date.now();
    if (now - lastPrint < (tty ? 100 : 1000)) return;
    lastPrint = now;
    const l = line(f);
    if (tty)
      process.stdout.write(
        `\r${l.slice(0, (process.stdout.columns || 160) - 1).padEnd((process.stdout.columns || 160) - 1)}`,
      );
    else console.log(l);
  });
  runtime.on('lapCompleted', (e) => {
    const sectors = e.sectorTimesMs
      .map((s) => (s === null ? '--' : (s / 1000).toFixed(3)))
      .join(' | ');
    const tag = [
      e.isPersonalBest ? 'PB' : '',
      e.isSessionBest ? 'SB' : '',
      e.valid ? '' : `INVALID(${e.flags.join(',')})`,
    ]
      .filter(Boolean)
      .join(' ');
    process.stdout.write(tty ? '\n' : '');
    console.log(
      `LAP ${e.lapNumber}  ${fmtTime(e.timeMs)}  [${sectors}]  Δ ${fmtDelta(e.deltaMs)}  ${tag}`,
    );
  });
  runtime.on('sessionChanged', (s) => {
    if (s && s.lapCount === 0 && s.trackId === null) {
      process.stdout.write(tty ? '\n' : '');
      console.log(`session ${s.id} started (car ${s.carCode}, ${s.mode}, format '${s.format}')`);
    }
  });
  runtime.on('notice', (n) => {
    process.stdout.write(tty ? '\n' : '');
    console.log(`[${n.level}] ${n.code}: ${n.message}`);
  });
  await runtime.start();
  const s = runtime.getStatus();
  console.log(
    `listening (console ${s.consoleIp ?? 'discovery'}, format '${s.ingestor.format}', data ${runtime.store.dataDir})`,
  );
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    process.stdout.write('\n');
    runtime
      .close()
      .catch((e) => console.error(e))
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
