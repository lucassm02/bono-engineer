/**
 * Writes a synthetic session to a .gt7rec recording (no network involved).
 *
 *   npm run gen-recording -- [--profile pro|amateur] [--laps 5] [--seed 1] [--format C]
 *                            [--replay] [--menu] [--out data/recordings/x.gt7rec]
 */

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { encodePacket } from '../encode.ts';
import { RecordingWriter } from '../recording.ts';
import { generateLaps } from '../simulator/synthetic/index.ts';
import { fail, toFormat, toInt } from './args.ts';

const { values } = parseArgs({
  options: {
    profile: { type: 'string', default: 'pro' },
    laps: { type: 'string' },
    seed: { type: 'string' },
    format: { type: 'string', default: 'C' },
    replay: { type: 'boolean', default: false },
    menu: { type: 'boolean', default: false },
    out: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`Generate a synthetic .gt7rec recording.

Options:
  --profile pro|amateur   driver profile (default pro)
  --laps N                complete laps after the out lap (default 5)
  --seed N                seed (default 1)
  --format A|B|~|C        packet format to store (default C)
  --replay                mimic replay capture (smoothed inputs)
  --menu                  include menu/loading packets at the start
  --out FILE              output (default data/recordings/synthetic-<profile>-s<seed>.gt7rec)`);
  process.exit(0);
}

const profile = values.profile;
if (profile !== 'pro' && profile !== 'amateur') fail('--profile must be pro or amateur');
const laps = toInt(values.laps, 'laps', 5);
const seed = toInt(values.seed, 'seed', 1);
const format = toFormat(values.format, 'C');
const out = resolve(
  values.out ??
    `data/recordings/synthetic-${profile}-s${seed}${values.replay ? '-replay' : ''}.gt7rec`,
);

async function main(): Promise<void> {
  const gen = generateLaps({
    profile: profile as 'pro' | 'amateur',
    laps,
    seed,
    format,
    replay: values.replay,
    includeMenu: values.menu,
  });
  const startTime = Date.now();
  const writer = await RecordingWriter.open(out, {
    format,
    startTime,
    meta: {
      source: 'synthetic',
      profile,
      seed,
      laps: gen.laps,
      track: gen.track.name,
      replay: values.replay,
    },
    flushIntervalMs: 0,
  });
  const dtMs = 1000 / 60;
  gen.packets.forEach((p, i) => {
    writer.write(encodePacket(p, format), i * dtMs);
  });
  await writer.close();
  const times = gen.laps.map((l) => (l.timeMs / 1000).toFixed(3)).join(', ');
  console.log(`wrote ${writer.count} packets (${gen.laps.length} laps: ${times}) to ${out}`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
