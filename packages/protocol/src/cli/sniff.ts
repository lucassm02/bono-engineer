/**
 * Connects to a real or fake console and prints one compact line per second.
 *
 *   npm run sniff -- --ps-ip 192.168.0.50 [--format A|B|~|C] [--record file.gt7rec]
 *                    [--port 33740] [--console-port 33739] [--discover]
 */

import { parseArgs } from 'node:util';
import { suggestedGearOf, type TelemetryPacket } from '@gt7/shared';
import { Gt7Ingestor, type IngestedPacket } from '../ingestor.ts';
import { RecordingWriter } from '../recording.ts';
import { fail, onShutdown, toFormat, toInt } from './args.ts';

const { values } = parseArgs({
  options: {
    'ps-ip': { type: 'string' },
    format: { type: 'string', default: 'A' },
    record: { type: 'string' },
    port: { type: 'string' },
    'console-port': { type: 'string' },
    discover: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`GT7 telemetry sniffer.

Options:
  --ps-ip IP            console IP (PS5: Settings > Network > Connection status)
  --discover            try broadcast discovery instead of --ps-ip (network dependent)
  --format A|B|~|C      heartbeat / packet format (default A)
  --record FILE         record decrypted packets to a .gt7rec file
  --port N              local UDP port to bind (default 33740)
  --console-port N      console UDP port (default 33739)`);
  process.exit(0);
}

if (!values['ps-ip'] && !values.discover) fail('--ps-ip is required (or use --discover)');

const format = toFormat(values.format, 'A');
const ingestor = new Gt7Ingestor({
  ...(values['ps-ip'] ? { consoleIp: values['ps-ip'] } : {}),
  discovery: values.discover,
  format,
  bindPort: toInt(values.port, 'port', 33740),
  consolePort: toInt(values['console-port'], 'console-port', 33739),
});

let writer: RecordingWriter | null = null;
let last: TelemetryPacket | null = null;

function fmtLap(ms: number): string {
  if (ms < 0) return '--:--.---';
  return `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
}

ingestor.on('packet', (ip: IngestedPacket) => {
  last = ip.packet;
  if (writer) writer.write(ip.raw);
});
ingestor.on('state', (s, prev) => console.log(`[sniff] state ${prev} -> ${s}`));
ingestor.on('discovered', (ip) => console.log(`[sniff] console discovered at ${ip}`));
ingestor.on('warning', (e) => console.warn(`[sniff] warning: ${e.message}`));
ingestor.on('stats', (st) => {
  const p = last;
  if (!p) {
    console.log(
      `[sniff] ${st.state} hb=${st.heartbeatsSent} rx=${st.received} bad=${st.decryptFailures + st.invalidSize}`,
    );
    return;
  }
  const sug = suggestedGearOf(p);
  const kmh = (p.speedMps * 3.6).toFixed(1).padStart(6);
  const rpm = p.engineRpm.toFixed(0).padStart(5);
  console.log(
    `${kmh} km/h ${rpm} rpm G${p.gear}${sug !== null ? `(${sug})` : '   '} ` +
      `T${String(p.throttle).padStart(3)} B${String(p.brake).padStart(3)} ` +
      `lap ${p.lapCount}${p.totalLaps > 0 ? `/${p.totalLaps}` : ''} last ${fmtLap(p.lastLapMs)} best ${fmtLap(p.bestLapMs)} ` +
      `| ${p.format} ${st.rateHz.toFixed(0)}Hz loss ${st.lossPct.toFixed(1)}% (${st.lost}) flags 0x${p.flags.toString(16).padStart(4, '0')}` +
      (writer ? ` rec ${writer.count}` : ''),
  );
});

async function main(): Promise<void> {
  if (values.record) {
    writer = await RecordingWriter.open(values.record, {
      format,
      meta: { source: 'sniff', consoleIp: values['ps-ip'] ?? null },
    });
    console.log(`[sniff] recording to ${values.record}`);
  }
  await ingestor.start();
  console.log(
    `[sniff] listening on :${ingestor.options.bindPort}, heartbeat '${format}' -> ${
      values['ps-ip'] ?? 'broadcast'
    }:${ingestor.options.consolePort}`,
  );
}

onShutdown(async () => {
  await ingestor.stop();
  if (writer) {
    await writer.close();
    console.log(`[sniff] saved ${writer.count} packets to ${writer.path}`);
  }
});
main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
