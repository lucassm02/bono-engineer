/**
 * Automatic console discovery (zero-config): unicast sweep of the local subnets.
 *
 * The PS4/PS5 does not answer a heartbeat sent to the broadcast address on most networks, but it
 * does answer a heartbeat sent straight to its IP (UDP 33739) as soon as GT7 is running on a
 * track. So the way to find it is to send that 1-byte heartbeat to every host of the /24(s) the PC
 * is on and wait for the first one that streams back a packet that decrypts to a valid GT7 magic.
 *
 * This module only knows how to *plan* and *send* the sweep (pure helpers + {@link ConsoleDiscovery});
 * recognising the console is the ingestor's job (it owns the socket on port 33740, so the replies
 * arrive there, and it already decrypts/validates packets).
 */

import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { type NetworkInterfaceInfo, networkInterfaces } from 'node:os';

// ---------------------------------------------------------------------------------------------
// IPv4 helpers
// ---------------------------------------------------------------------------------------------

/** Dotted IPv4 → unsigned 32-bit integer, null when malformed. */
export function ipToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const b = Number(p);
    if (b > 255) return null;
    n = n * 256 + b;
  }
  return n;
}

export function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** Number of leading 1 bits of a contiguous netmask; null when not a valid mask. */
export function prefixLength(netmask: string): number | null {
  const m = ipToInt(netmask);
  if (m === null) return null;
  let bits = 0;
  let seenZero = false;
  for (let i = 31; i >= 0; i--) {
    const one = ((m >>> i) & 1) === 1;
    if (one) {
      if (seenZero) return null;
      bits++;
    } else {
      seenZero = true;
    }
  }
  return bits;
}

/** RFC 1918 private ranges (10/8, 172.16/12, 192.168/16). */
export function isPrivateIPv4(ip: string): boolean {
  const n = ipToInt(ip);
  if (n === null) return false;
  const a = n >>> 24;
  const b = (n >>> 16) & 255;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function isLoopbackIPv4(ip: string): boolean {
  const n = ipToInt(ip);
  return n !== null && n >>> 24 === 127;
}

// ---------------------------------------------------------------------------------------------
// Scan plan
// ---------------------------------------------------------------------------------------------

/** Interface names that are usually virtual (Hyper-V/WSL/VPN/VMs): scanned last. */
const VIRTUAL_IFACE =
  /(vethernet|wsl|hyper-v|virtualbox|vbox|vmware|vmnet|docker|loopback|bluetooth|tailscale|zerotier|hamachi|utun|tun|tap|npcap|radmin)/i;

export interface ScanSubnet {
  /** Interface name (e.g. "Wi-Fi"). */
  iface: string;
  /** Local address of the PC on this network. */
  localAddress: string;
  /** Scanned network in CIDR form (always /24 or more specific), e.g. "192.168.0.0/24". */
  cidr: string;
  /** Directed broadcast address of the scanned network. */
  broadcast: string;
  /** Candidate host addresses (network/broadcast/own address excluded), ascending. */
  hosts: string[];
  /** Interface looks virtual (Hyper-V/WSL/VPN): scanned after the real ones. */
  virtual: boolean;
}

export interface PlanScanOptions {
  /** Also plan loopback (127.x) interfaces — tests only. */
  allowLoopback?: boolean;
}

/**
 * Subnets to sweep: one per active private IPv4 interface. The scanned range is capped at a /24:
 * with a shorter mask (/16, /20…) only the /24 that contains the local address is swept; with a
 * longer mask (/25, /26…) the real, smaller network is swept. Duplicate networks are merged and
 * real interfaces come before virtual ones. Link-local (169.254), public and IPv6 are ignored.
 */
export function planScanSubnets(
  ifaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
  opts: PlanScanOptions = {},
): ScanSubnet[] {
  const out: ScanSubnet[] = [];
  const seen = new Set<string>();
  for (const [name, list] of Object.entries(ifaces)) {
    for (const info of list ?? []) {
      const fam = info.family as string | number;
      if (fam !== 'IPv4' && fam !== 4) continue;
      const loop = isLoopbackIPv4(info.address);
      if (loop ? !opts.allowLoopback : info.internal || !isPrivateIPv4(info.address)) continue;
      const ip = ipToInt(info.address);
      const bits = prefixLength(info.netmask);
      if (ip === null || bits === null || bits >= 31) continue; // /31 and /32: no host range
      const eff = Math.max(24, bits);
      const mask = eff === 0 ? 0 : (0xffffffff << (32 - eff)) >>> 0;
      const network = (ip & mask) >>> 0;
      const broadcast = (network | (~mask >>> 0)) >>> 0;
      const cidr = `${intToIp(network)}/${eff}`;
      if (seen.has(cidr)) continue;
      seen.add(cidr);
      const hosts: string[] = [];
      for (let h = network + 1; h < broadcast; h++) {
        if (h !== ip) hosts.push(intToIp(h));
      }
      out.push({
        iface: name,
        localAddress: info.address,
        cidr,
        broadcast: intToIp(broadcast),
        hosts,
        virtual: VIRTUAL_IFACE.test(name),
      });
    }
  }
  // stable: real interfaces first, discovery order otherwise
  return out
    .map((s, i) => ({ s, i }))
    .sort((a, b) => Number(a.s.virtual) - Number(b.s.virtual) || a.i - b.i)
    .map((x) => x.s);
}

// ---------------------------------------------------------------------------------------------
// ARP hints (order only, never a requirement)
// ---------------------------------------------------------------------------------------------

export interface ArpEntry {
  ip: string;
  /** Lower-case, zero-padded, colon separated ("aa:bb:cc:00:11:22"). */
  mac: string;
  /** Hostname when the OS printed one (Linux/macOS `arp -a`). */
  hostname: string | null;
}

/**
 * OUI prefixes registered to Sony Interactive Entertainment / Sony Computer Entertainment (the
 * network cards of PS4/PS5). A heuristic for ordering the sweep only: a console with an
 * unlisted prefix is still found, just in plain address order.
 */
export const PLAYSTATION_OUIS: readonly string[] = [
  '00:04:1f',
  '00:13:a9',
  '00:15:c1',
  '00:19:c5',
  '00:1d:0d',
  '00:1f:a7',
  '00:24:8d',
  '00:d9:d1',
  '00:e0:36',
  '0c:fe:45',
  '28:0d:fc',
  '2c:cc:44',
  '3c:cd:93',
  '70:9e:29',
  '78:c8:81',
  'a8:e3:ee',
  'bc:60:a7',
  'c8:63:f1',
  'f8:46:1c',
  'fc:0f:e6',
];

export function normalizeMac(raw: string): string | null {
  const parts = raw.split(/[:-]/);
  if (parts.length !== 6) return null;
  const out: string[] = [];
  for (const p of parts) {
    if (!/^[0-9a-f]{1,2}$/i.test(p)) return null;
    out.push(p.toLowerCase().padStart(2, '0'));
  }
  return out.join(':');
}

export function isSonyMac(mac: string): boolean {
  const m = normalizeMac(mac);
  return m !== null && PLAYSTATION_OUIS.includes(m.slice(0, 8));
}

const ARP_LINE = /(\d{1,3}(?:\.\d{1,3}){3})\)?[^\n]*?\b((?:[0-9a-f]{1,2}[:-]){5}[0-9a-f]{1,2})\b/i;

/**
 * Parses `arp -a` output (Windows: `192.168.0.1  aa-bb-cc-dd-ee-ff  dynamic`; Linux/macOS:
 * `? (192.168.0.1) at aa:bb:cc:dd:ee:ff [ether] on eth0`). Broadcast/multicast/incomplete entries
 * are dropped.
 */
export function parseArpTable(text: string): ArpEntry[] {
  const out: ArpEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = ARP_LINE.exec(line);
    if (!m) continue;
    const ip = m[1]!;
    const mac = normalizeMac(m[2]!);
    if (!mac || ipToInt(ip) === null || mac === 'ff:ff:ff:ff:ff:ff') continue;
    if (mac.startsWith('01:00:5e') || mac === '00:00:00:00:00:00') continue;
    const host = /^\s*([^\s(?]+)\s+\(/.exec(line)?.[1] ?? null;
    out.push({ ip, mac, hostname: host });
  }
  return out;
}

export type ArpReader = () => Promise<ArpEntry[]>;

/** Reads the OS ARP cache with `arp -a` (no elevation needed). Never rejects. */
export const readArpTable: ArpReader = () =>
  new Promise((resolve) => {
    try {
      execFile('arp', ['-a'], { timeout: 3000, windowsHide: true }, (err, stdout) => {
        resolve(err ? [] : parseArpTable(String(stdout)));
      });
    } catch {
      resolve([]);
    }
  });

const PS_HOSTNAME = /(playstation|\bps[45]\b|sony|sie)/i;

export interface OrderHints {
  /** Probed first (e.g. the last known console IP). */
  first?: readonly string[];
  /** ARP table, used to bring Sony-looking hosts, then any known neighbour, forward. */
  arp?: readonly ArpEntry[];
}

/**
 * Orders the hosts of a sweep: `first` hints, then ARP neighbours that look like a PlayStation
 * (Sony OUI or hostname), then other ARP neighbours (they are alive), then the rest by address.
 * Only hosts of `hosts` are returned, each once.
 */
export function orderScanHosts(hosts: readonly string[], hints: OrderHints = {}): string[] {
  const inScope = new Set(hosts);
  const out: string[] = [];
  const used = new Set<string>();
  const push = (ip: string) => {
    if (inScope.has(ip) && !used.has(ip)) {
      used.add(ip);
      out.push(ip);
    }
  };
  for (const ip of hints.first ?? []) push(ip);
  const arp = hints.arp ?? [];
  for (const e of arp) {
    if (isSonyMac(e.mac) || (e.hostname && PS_HOSTNAME.test(e.hostname))) push(e.ip);
  }
  for (const e of arp) push(e.ip);
  for (const ip of hosts) push(ip);
  return out;
}

/** Splits `items` into consecutive batches of at most `size`. */
export function toBatches<T>(items: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------------------------

export interface ConsoleDiscoveryOptions {
  /** Sends one heartbeat to `ip` (console port, current packet format). Must not throw. */
  send: (ip: string) => void;
  /**
   * Whether a sweep is wanted right now (no console answering). Polled; when it is false the
   * scanner stays quiet and the next time it turns true a fresh fast phase begins.
   */
  needed: () => boolean;
  /** Probed first (the saved/last console IP). */
  priority?: () => readonly string[];
  /** Directed broadcasts sent at the start of each round (default: none). */
  broadcastAddresses?: () => readonly string[];
  /** Network interfaces (default `os.networkInterfaces`). */
  interfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
  /** ARP reader; `null` disables the hint (default `arp -a`). */
  arp?: ArpReader | null;
  allowLoopback?: boolean;
  /** Hosts per batch (default 64). */
  batchSize?: number;
  /** Pause between batches (default 20 ms). */
  batchDelayMs?: number;
  /** Round interval during the fast phase (default 5 s) and its length (default 30 s). */
  fastIntervalMs?: number;
  fastDurationMs?: number;
  /** Round interval afterwards (default 15 s). */
  slowIntervalMs?: number;
  /** How often `needed()` is polled while idle (default 1 s). */
  pollMs?: number;
  /** Clock (tests). */
  now?: () => number;
}

export interface DiscoveryInfo {
  /** CIDR networks of the last plan. */
  subnets: string[];
  /** Hosts probed since the current search began. */
  hostsProbed: number;
  /** Epoch ms when the last round started. */
  lastScanAt: number | null;
  /** A round is being sent right now. */
  scanning: boolean;
}

export interface ConsoleDiscoveryEvents {
  /** A round started (info.scanning = true) or finished. */
  scan: [DiscoveryInfo];
}

const ARP_CACHE_MS = 60_000;

/**
 * Repeats the sweep while the console is missing: every 5 s for the first 30 s of a search, then
 * every 15 s. Each round sends the heartbeat to the broadcast address(es) and then to every host
 * of every planned subnet, in batches, hinted hosts first.
 */
export class ConsoleDiscovery extends EventEmitter<ConsoleDiscoveryEvents> {
  readonly #o: Required<
    Pick<
      ConsoleDiscoveryOptions,
      | 'batchSize'
      | 'batchDelayMs'
      | 'fastIntervalMs'
      | 'fastDurationMs'
      | 'slowIntervalMs'
      | 'pollMs'
    >
  > &
    ConsoleDiscoveryOptions;
  readonly #now: () => number;
  #timer: NodeJS.Timeout | null = null;
  #running = false;
  #stopped = false;
  #round: Promise<void> | null = null;
  /** Start of the current search episode (null while idle / not needed). */
  #episodeAt: number | null = null;
  #nextRoundAt = 0;
  #subnets: ScanSubnet[] = [];
  #probed = 0;
  #lastScanAt: number | null = null;
  #arpCache: { at: number; entries: ArpEntry[] } | null = null;

  constructor(opts: ConsoleDiscoveryOptions) {
    super();
    this.#o = {
      ...opts,
      batchSize: opts.batchSize ?? 64,
      batchDelayMs: opts.batchDelayMs ?? 20,
      fastIntervalMs: opts.fastIntervalMs ?? 5000,
      fastDurationMs: opts.fastDurationMs ?? 30_000,
      slowIntervalMs: opts.slowIntervalMs ?? 15_000,
      pollMs: opts.pollMs ?? 1000,
    };
    this.#now = opts.now ?? Date.now;
  }

  get info(): DiscoveryInfo {
    return {
      subnets: this.#subnets.map((s) => s.cidr),
      hostsProbed: this.#probed,
      lastScanAt: this.#lastScanAt,
      scanning: this.#round !== null,
    };
  }

  /** Plans the subnets right away (so the UI can list them before the first round ends). */
  refreshPlan(): ScanSubnet[] {
    try {
      const ifaces = (this.#o.interfaces ?? networkInterfaces)();
      this.#subnets = planScanSubnets(ifaces, { allowLoopback: this.#o.allowLoopback ?? false });
    } catch {
      this.#subnets = [];
    }
    return this.#subnets;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#stopped = false;
    this.refreshPlan();
    this.#schedule(0);
  }

  stop(): void {
    this.#running = false;
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** Begins a new search episode: counters reset and a round starts immediately. */
  restart(): void {
    this.#episodeAt = null;
    this.#probed = 0;
    this.#nextRoundAt = 0;
    this.#arpCache = null;
    if (!this.#running) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#schedule(0);
  }

  /** Runs one round now (also used by tests); resolves when every batch has been sent. */
  scanNow(): Promise<void> {
    this.#round ??= this.#runRound().finally(() => {
      this.#round = null;
      this.emit('scan', this.info);
    });
    return this.#round;
  }

  // ------------------------------------------------------------------------------------------

  #schedule(delayMs: number): void {
    if (!this.#running) return;
    this.#timer = setTimeout(() => void this.#tick(), delayMs);
    this.#timer.unref?.();
  }

  async #tick(): Promise<void> {
    this.#timer = null;
    if (!this.#running) return;
    const now = this.#now();
    if (!this.#o.needed()) {
      // quiet: the next search starts from a fresh fast phase
      this.#episodeAt = null;
      return this.#schedule(this.#o.pollMs);
    }
    if (this.#episodeAt === null) {
      this.#episodeAt = now;
      this.#probed = 0;
      this.#nextRoundAt = 0;
    }
    if (now >= this.#nextRoundAt) {
      await this.scanNow();
      if (!this.#running) return;
      const after = this.#now();
      const fast = after - (this.#episodeAt ?? after) < this.#o.fastDurationMs;
      this.#nextRoundAt = after + (fast ? this.#o.fastIntervalMs : this.#o.slowIntervalMs);
    }
    const wait = Math.min(this.#o.pollMs, Math.max(0, this.#nextRoundAt - this.#now()));
    this.#schedule(wait);
  }

  async #hints(): Promise<ArpEntry[]> {
    const reader = this.#o.arp === undefined ? readArpTable : this.#o.arp;
    if (!reader) return [];
    const now = this.#now();
    if (this.#arpCache && now - this.#arpCache.at < ARP_CACHE_MS) return this.#arpCache.entries;
    const entries = await reader().catch(() => []);
    this.#arpCache = { at: now, entries };
    return entries;
  }

  async #runRound(): Promise<void> {
    this.#lastScanAt = this.#now();
    const plan = this.refreshPlan();
    this.emit('scan', this.info);
    const o = this.#o;
    for (const ip of o.broadcastAddresses?.() ?? []) this.#send(ip, false);
    const arp = await this.#hints();
    const first = o.priority?.() ?? [];
    // one flat probe list: hinted hosts of every subnet lead, then each subnet in plan order
    const all = orderScanHosts(
      plan.flatMap((s) => s.hosts),
      { first, arp },
    );
    const batches = toBatches(all, o.batchSize);
    for (let i = 0; i < batches.length; i++) {
      if (this.#stopped) return;
      for (const ip of batches[i]!) this.#send(ip, true);
      if (i < batches.length - 1) await delay(o.batchDelayMs);
    }
  }

  #send(ip: string, probe: boolean): void {
    try {
      this.#o.send(ip);
    } catch {
      // a failed send (no route, ENOBUFS) must not abort the sweep
    }
    if (probe) this.#probed++;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    t.unref?.();
  });
}
