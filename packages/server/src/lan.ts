/**
 * LAN addresses where the dashboard is reachable (for the phone) and QR codes.
 */

import { type NetworkInterfaceInfo, networkInterfaces } from 'node:os';
import QRCode from 'qrcode';

export type InterfacesFn = () => NodeJS.Dict<NetworkInterfaceInfo[]>;

export interface LanAddress {
  address: string;
  iface: string;
  score: number;
}

/** Interface names that are usually virtual (Hyper-V/WSL/VPN/VMs): ranked last. */
const VIRTUAL_IFACE =
  /(vethernet|wsl|hyper-v|virtualbox|vbox|vmware|vmnet|docker|loopback|bluetooth|tailscale|zerotier|hamachi|utun|tun|tap|npcap|radmin)/i;

function scoreAddress(address: string, iface: string): number {
  let s = 0;
  if (address.startsWith('192.168.')) s += 30;
  else if (address.startsWith('10.')) s += 20;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) s += 10;
  if (VIRTUAL_IFACE.test(iface)) s -= 50;
  if (/(wi-?fi|wlan|wireless|ethernet|eth\d|en\d)/i.test(iface)) s += 5;
  return s;
}

/** Non-internal IPv4 addresses (no link-local 169.254.x), best candidate first. */
export function lanAddresses(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]>): LanAddress[] {
  const out: LanAddress[] = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const info of list ?? []) {
      const fam = info.family as string | number;
      if (fam !== 'IPv4' && fam !== 4) continue;
      if (info.internal || info.address.startsWith('169.254.')) continue;
      if (out.some((a) => a.address === info.address)) continue;
      out.push({ address: info.address, iface: name, score: scoreAddress(info.address, name) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

export function urlFor(host: string, port: number, token?: string | null): string {
  const base = `http://${host}:${port}/`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

export interface LanResolverOptions {
  port: number;
  /** Bind host: 0.0.0.0/:: = all interfaces, otherwise only that address is reachable. */
  host: string;
  token?: string | null;
  interfaces?: InterfacesFn;
  /** Cache time for the interface scan (default 10 s). */
  cacheMs?: number;
}

/** Resolves (and caches) the LAN URLs. */
export class LanResolver {
  readonly port: number;
  readonly host: string;
  readonly token: string | null;
  readonly #interfaces: InterfacesFn;
  readonly #cacheMs: number;
  #cache: { at: number; addrs: LanAddress[] } | null = null;
  #qr = new Map<string, string>();

  constructor(opts: LanResolverOptions) {
    this.port = opts.port;
    this.host = opts.host;
    this.token = opts.token ?? null;
    this.#interfaces = opts.interfaces ?? networkInterfaces;
    this.#cacheMs = opts.cacheMs ?? 10_000;
  }

  addresses(): LanAddress[] {
    const now = Date.now();
    if (this.#cache && now - this.#cache.at < this.#cacheMs) return this.#cache.addrs;
    let addrs: LanAddress[];
    if (this.host === '0.0.0.0' || this.host === '::' || this.host === '') {
      try {
        addrs = lanAddresses(this.#interfaces());
      } catch {
        addrs = [];
      }
    } else if (this.host === '127.0.0.1' || this.host === 'localhost' || this.host === '::1') {
      addrs = [];
    } else {
      addrs = [{ address: this.host, iface: 'bind', score: 100 }];
    }
    this.#cache = { at: now, addrs };
    return addrs;
  }

  /** LAN URLs without token (for display / status). */
  urls(): string[] {
    return this.addresses().map((a) => urlFor(a.address, this.port));
  }

  /** Best LAN URL, with the token when one is configured. */
  preferredUrl(): string | null {
    const a = this.addresses()[0];
    return a ? urlFor(a.address, this.port, this.token) : null;
  }

  localUrl(): string {
    return urlFor('localhost', this.port);
  }

  /** QR code SVG data URL for `url` (cached). */
  async qrDataUrl(url: string): Promise<string> {
    const hit = this.#qr.get(url);
    if (hit) return hit;
    const svg = await qrSvg(url);
    const data = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    this.#qr.set(url, data);
    return data;
  }
}

export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
}

/** Small QR for the terminal (half-block characters). */
export function qrTerminal(text: string): Promise<string> {
  return QRCode.toString(text, { type: 'terminal', small: true, errorCorrectionLevel: 'L' });
}
