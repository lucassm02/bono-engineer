/**
 * Fake GT7 console.
 *
 *   npm run sim -- [--profile pro|amateur] [--seed N] [--laps N] [--port 33739] [--host 0.0.0.0]
 *                  [--target-port 33740] [--recording file.gt7rec] [--replay] [--no-menu]
 *                  [--heartbeat-timeout ms] [--format-lock ms] [--rate 60]
 */

import { parseArgs } from 'node:util';
import { FakeConsole, type FakeConsoleSource } from '../simulator/fake-console.ts';
import { fail, onShutdown, toInt } from './args.ts';

const { values } = parseArgs({
  options: {
    profile: { type: 'string', default: 'pro' },
    seed: { type: 'string' },
    laps: { type: 'string' },
    port: { type: 'string' },
    host: { type: 'string', default: '0.0.0.0' },
    'target-port': { type: 'string' },
    recording: { type: 'string' },
    replay: { type: 'boolean', default: false },
    'no-menu': { type: 'boolean', default: false },
    'heartbeat-timeout': { type: 'string' },
    'format-lock': { type: 'string' },
    rate: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: false,
});

if (values.help) {
  console.log(`Fake GT7 console (UDP). Waits for heartbeats and streams encrypted packets.

Options:
  --profile pro|amateur     synthetic driver profile (default pro)
  --seed N                  deterministic seed (default 1)
  --laps N                  restart the synthetic session (menu + out lap) after N laps (default: endless)
  --port N                  heartbeat port to listen on (default 33739)
  --host ADDR               bind address (default 0.0.0.0)
  --target-port N           port packets are sent to (default 33740)
  --recording FILE          replay a .gt7rec recording instead of synthetic data (loops)
  --replay                  mimic replay capture (smoothed inputs, no fuel use)
  --no-menu                 skip menu/loading packets at session start
  --heartbeat-timeout MS    stop streaming after MS without heartbeat (default 20000)
  --format-lock MS          format can change after MS without heartbeat (default 10000)
  --rate HZ                 packet rate for synthetic data (default 60)`);
  process.exit(0);
}

const profile = values.profile;
if (profile !== 'pro' && profile !== 'amateur') fail('--profile must be pro or amateur');
const seed = toInt(values.seed, 'seed', 1);
const lapsLimit = toInt(values.laps, 'laps', 0);

const source: FakeConsoleSource = values.recording
  ? { kind: 'recording', file: values.recording, loop: true }
  : {
      kind: 'synthetic',
      profile,
      seed,
      replay: values.replay,
      includeMenu: !values['no-menu'],
    };

function makeConsole(sessionSeed: number): FakeConsole {
  const src: FakeConsoleSource =
    source.kind === 'synthetic' ? { ...source, seed: sessionSeed } : source;
  return new FakeConsole({
    port: toInt(values.port, 'port', 33739),
    host: values.host,
    targetPort: toInt(values['target-port'], 'target-port', 33740),
    heartbeatTimeoutMs: toInt(values['heartbeat-timeout'], 'heartbeat-timeout', 20_000),
    formatLockMs: toInt(values['format-lock'], 'format-lock', 10_000),
    rateHz: toInt(values.rate, 'rate', 60),
    seed: sessionSeed,
    source: src,
  });
}

let fake = makeConsole(seed);
let sessionNo = 0;

function wire(c: FakeConsole): void {
  let lastHbLog = 0;
  c.on('heartbeat', (fmt, addr) => {
    const now = Date.now();
    if (now - lastHbLog > 10_000) {
      lastHbLog = now;
      console.log(`[sim] heartbeat '${fmt}' from ${addr}`);
    }
  });
  c.on('formatLocked', (fmt) => console.log(`[sim] format locked: '${fmt}'`));
  c.on('streaming', (active, target, fmt) =>
    console.log(
      active
        ? `[sim] streaming '${fmt}' to ${target}:${c.options.targetPort} @ ${c.options.rateHz} Hz`
        : '[sim] streaming stopped (no heartbeat)',
    ),
  );
  c.on('warning', (e) => console.warn(`[sim] warning: ${e.message}`));
}

async function main(): Promise<void> {
  wire(fake);
  await fake.start();
  const src = fake.options.source;
  console.log(
    `[sim] fake GT7 console listening on ${values.host}:${fake.options.port} ` +
      (src.kind === 'recording'
        ? `(recording ${src.file})`
        : `(synthetic, profile=${profile}, seed=${seed}${values.replay ? ', replay' : ''})`),
  );
  let reported = 0;
  setInterval(async () => {
    const syn = fake.synthetic;
    if (!syn) return;
    const laps = syn.completedLaps;
    while (reported < laps.length) {
      const l = laps[reported++]!;
      const t = `${Math.floor(l.timeMs / 60000)}:${((l.timeMs % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
      console.log(
        `[sim] lap ${l.lapNumber} ${t}${l.mistakes.length ? ` (mistake: ${l.mistakes.join(',')})` : ''}`,
      );
    }
    if (lapsLimit > 0 && laps.length >= lapsLimit) {
      sessionNo++;
      console.log(`[sim] ${lapsLimit} laps done, restarting session #${sessionNo}`);
      await fake.stop();
      fake = makeConsole(seed + sessionNo);
      wire(fake);
      reported = 0;
      await fake.start();
    }
  }, 500);
}

onShutdown(() => fake.stop());
main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
