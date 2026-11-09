import type { NetworkInterfaceInfo } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ConsoleDiscovery,
  intToIp,
  ipToInt,
  isPrivateIPv4,
  isSonyMac,
  orderScanHosts,
  parseArpTable,
  planScanSubnets,
  prefixLength,
  toBatches,
} from './discovery.ts';

function nic(address: string, netmask: string, extra: Partial<NetworkInterfaceInfo> = {}) {
  return {
    address,
    netmask,
    family: 'IPv4',
    internal: false,
    mac: '00:00:00:00:00:00',
    cidr: null,
    ...extra,
  } as NetworkInterfaceInfo;
}

describe('IPv4 helpers', () => {
  it('converts, validates and measures masks', () => {
    expect(ipToInt('192.168.0.1')).toBe(0xc0a80001);
    expect(intToIp(0xc0a80001)).toBe('192.168.0.1');
    expect(ipToInt('192.168.0')).toBeNull();
    expect(ipToInt('192.168.0.256')).toBeNull();
    expect(ipToInt('a.b.c.d')).toBeNull();
    expect(prefixLength('255.255.255.0')).toBe(24);
    expect(prefixLength('255.255.0.0')).toBe(16);
    expect(prefixLength('255.255.255.192')).toBe(26);
    expect(prefixLength('255.0.255.0')).toBeNull();
  });

  it('knows the private ranges', () => {
    for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.15.4']) {
      expect(isPrivateIPv4(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '169.254.1.1', '127.0.0.1']) {
      expect(isPrivateIPv4(ip)).toBe(false);
    }
  });
});

describe('planScanSubnets', () => {
  it('lists the /24 hosts without the network, broadcast and own address', () => {
    const [s, ...rest] = planScanSubnets({ 'Wi-Fi': [nic('192.168.0.10', '255.255.255.0')] });
    expect(rest).toHaveLength(0);
    expect(s!.cidr).toBe('192.168.0.0/24');
    expect(s!.broadcast).toBe('192.168.0.255');
    expect(s!.hosts).toHaveLength(253);
    expect(s!.hosts[0]).toBe('192.168.0.1');
    expect(s!.hosts.at(-1)).toBe('192.168.0.254');
    expect(s!.hosts).not.toContain('192.168.0.10');
    expect(s!.hosts).not.toContain('192.168.0.0');
    expect(s!.hosts).not.toContain('192.168.0.255');
  });

  it('caps wide networks to the /24 of the local address', () => {
    const [s] = planScanSubnets({ eth0: [nic('10.1.7.33', '255.255.0.0')] });
    expect(s!.cidr).toBe('10.1.7.0/24');
    expect(s!.hosts).toHaveLength(253);
    expect(s!.hosts[0]).toBe('10.1.7.1');
  });

  it('keeps small networks small (/26 = 62 hosts, 61 without us)', () => {
    const [s] = planScanSubnets({ eth0: [nic('192.168.1.70', '255.255.255.192')] });
    expect(s!.cidr).toBe('192.168.1.64/26');
    expect(s!.hosts).toHaveLength(61);
    expect(s!.hosts[0]).toBe('192.168.1.65');
    expect(s!.hosts.at(-1)).toBe('192.168.1.126');
  });

  it('ignores public, link-local, loopback, internal, IPv6 and /31+ interfaces', () => {
    const plan = planScanSubnets({
      pub: [nic('8.8.4.4', '255.255.255.0')],
      ll: [nic('169.254.3.4', '255.255.0.0')],
      lo: [nic('127.0.0.1', '255.0.0.0', { internal: true })],
      int: [nic('192.168.5.5', '255.255.255.0', { internal: true })],
      v6: [nic('fe80::1', 'ffff:ffff:ffff:ffff::', { family: 'IPv6' })],
      p2p: [nic('10.0.0.1', '255.255.255.254')],
      host: [nic('10.0.0.2', '255.255.255.255')],
    });
    expect(plan).toEqual([]);
  });

  it('merges duplicate networks and puts virtual adapters last', () => {
    const plan = planScanSubnets({
      'vEthernet (WSL)': [nic('172.20.16.1', '255.255.240.0')],
      'Wi-Fi': [nic('192.168.0.10', '255.255.255.0')],
      Ethernet: [nic('192.168.0.11', '255.255.255.0'), nic('10.0.0.5', '255.255.255.0')],
    });
    expect(plan.map((s) => s.cidr)).toEqual(['192.168.0.0/24', '10.0.0.0/24', '172.20.16.0/24']);
    expect(plan[2]!.virtual).toBe(true);
    expect(plan[0]!.virtual).toBe(false);
  });

  it('can include loopback for tests', () => {
    const [s] = planScanSubnets(
      { lo: [nic('127.0.0.1', '255.255.255.0', { internal: true })] },
      { allowLoopback: true },
    );
    expect(s!.cidr).toBe('127.0.0.0/24');
    expect(s!.hosts).toHaveLength(253);
  });
});

describe('ARP hints', () => {
  it('parses the Windows table', () => {
    const text = [
      '',
      'Interface: 192.168.0.10 --- 0x7',
      '  Internet Address      Physical Address      Type',
      '  192.168.0.1           a4-2b-b0-11-22-33     dynamic',
      '  192.168.0.20          fc-0f-e6-aa-bb-cc     dynamic',
      '  192.168.0.255         ff-ff-ff-ff-ff-ff     static',
      '  224.0.0.22            01-00-5e-00-00-16     static',
    ].join('\r\n');
    const rows = parseArpTable(text);
    expect(rows.map((r) => r.ip)).toEqual(['192.168.0.1', '192.168.0.20']);
    expect(rows[1]!.mac).toBe('fc:0f:e6:aa:bb:cc');
    expect(isSonyMac(rows[1]!.mac)).toBe(true);
    expect(isSonyMac(rows[0]!.mac)).toBe(false);
  });

  it('parses Linux/macOS output (hostnames, short octets)', () => {
    const text = [
      'ps5.lan (192.168.0.30) at 0:d9:d1:1:2:3 [ether] on eth0',
      '? (192.168.0.1) at a4:2b:b0:11:22:33 on en0 ifscope [ethernet]',
      '? (192.168.0.99) at (incomplete) on en0 ifscope [ethernet]',
    ].join('\n');
    const rows = parseArpTable(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ ip: '192.168.0.30', mac: '00:d9:d1:01:02:03', hostname: 'ps5.lan' });
    expect(isSonyMac(rows[0]!.mac)).toBe(true);
    expect(rows[1]!.hostname).toBeNull();
  });

  it('orders: first hints, Sony neighbours, other neighbours, then the rest', () => {
    const hosts = ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4', '10.0.0.5', '10.0.0.6'];
    const ordered = orderScanHosts(hosts, {
      first: ['10.0.0.5', '10.9.9.9'],
      arp: [
        { ip: '10.0.0.4', mac: 'a4:2b:b0:11:22:33', hostname: null },
        { ip: '10.0.0.3', mac: 'fc:0f:e6:aa:bb:cc', hostname: null },
        { ip: '10.0.0.77', mac: 'fc:0f:e6:aa:bb:cc', hostname: null },
      ],
    });
    expect(ordered).toEqual([
      '10.0.0.5', // hint
      '10.0.0.3', // Sony OUI
      '10.0.0.4', // other neighbour
      '10.0.0.1',
      '10.0.0.2',
      '10.0.0.6',
    ]);
    expect(new Set(ordered).size).toBe(ordered.length);
  });

  it('without hints keeps the address order', () => {
    expect(orderScanHosts(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('toBatches', () => {
  it('splits in batches of at most N', () => {
    const items = Array.from({ length: 253 }, (_, i) => i);
    const b = toBatches(items, 64);
    expect(b.map((x) => x.length)).toEqual([64, 64, 64, 61]);
    expect(b.flat()).toEqual(items);
    expect(toBatches([], 64)).toEqual([]);
    expect(toBatches([1, 2, 3], 0)).toEqual([[1], [2], [3]]);
  });
});

describe('ConsoleDiscovery (fake timers, no network)', () => {
  afterEach(() => vi.useRealTimers());

  const IFACES = () => ({ 'Wi-Fi': [nic('192.168.0.10', '255.255.255.0')] });

  function make(extra: { needed?: () => boolean; send?: (ip: string) => void } = {}) {
    const sent: { ip: string; t: number }[] = [];
    const t0 = Date.now();
    const d = new ConsoleDiscovery({
      send: extra.send ?? ((ip) => sent.push({ ip, t: Date.now() - t0 })),
      needed: extra.needed ?? (() => true),
      interfaces: IFACES,
      arp: async () => [{ ip: '192.168.0.77', mac: 'fc:0f:e6:00:00:01', hostname: null }],
      priority: () => ['192.168.0.42'],
      broadcastAddresses: () => ['192.168.0.255'],
    });
    return { d, sent };
  }

  it('sends one round in batches of 64, hinted hosts and the broadcast first', async () => {
    vi.useFakeTimers();
    const { d, sent } = make();
    d.start();
    await vi.advanceTimersByTimeAsync(0);
    // after the first tick only the broadcast and the first batch (64 hosts) went out
    expect(sent[0]!.ip).toBe('192.168.0.255');
    expect(sent[1]!.ip).toBe('192.168.0.42'); // saved IP
    expect(sent[2]!.ip).toBe('192.168.0.77'); // Sony neighbour
    expect(sent.length).toBe(1 + 64);
    await vi.advanceTimersByTimeAsync(100);
    expect(sent.length).toBe(1 + 253);
    expect(new Set(sent.map((s) => s.ip)).size).toBe(254);
    expect(d.info.subnets).toEqual(['192.168.0.0/24']);
    expect(d.info.hostsProbed).toBe(253);
    expect(d.info.lastScanAt).not.toBeNull();
    expect(d.info.scanning).toBe(false);
    d.stop();
  });

  it('repeats every 5 s for 30 s, then every 15 s', async () => {
    vi.useFakeTimers();
    const { d, sent } = make();
    d.start();
    const rounds = () => sent.filter((s) => s.ip === '192.168.0.255').length;
    await vi.advanceTimersByTimeAsync(29_000);
    const fast = rounds();
    expect(fast).toBeGreaterThanOrEqual(5);
    expect(fast).toBeLessThanOrEqual(7);
    await vi.advanceTimersByTimeAsync(60_000);
    const slow = rounds() - fast;
    // 60 s at one round per ~15 s
    expect(slow).toBeGreaterThanOrEqual(3);
    expect(slow).toBeLessThanOrEqual(5);
    d.stop();
  });

  it('stays quiet while not needed and starts a fresh fast phase when needed again', async () => {
    vi.useFakeTimers();
    let needed = true;
    const { d, sent } = make({ needed: () => needed });
    d.start();
    await vi.advanceTimersByTimeAsync(1000);
    const first = sent.length;
    expect(first).toBeGreaterThan(200);
    needed = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent.length).toBe(first);
    needed = true;
    await vi.advanceTimersByTimeAsync(1500);
    expect(sent.length).toBeGreaterThan(first + 200);
    // counters restarted with the new search
    expect(d.info.hostsProbed).toBeLessThanOrEqual(253);
    d.stop();
  });

  it('restart() scans immediately and resets the counters', async () => {
    vi.useFakeTimers();
    const { d, sent } = make();
    d.start();
    await vi.advanceTimersByTimeAsync(2000);
    const before = sent.length;
    d.restart();
    await vi.advanceTimersByTimeAsync(10);
    expect(sent.length).toBeGreaterThan(before);
    await vi.advanceTimersByTimeAsync(200);
    expect(d.info.hostsProbed).toBe(253);
    d.stop();
  });

  it('survives a send that throws and does not send after stop()', async () => {
    vi.useFakeTimers();
    let n = 0;
    const { d } = make({
      send: () => {
        n++;
        throw new Error('ENOBUFS');
      },
    });
    d.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(n).toBe(254);
    d.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(n).toBe(254);
  });

  it('plans nothing (and does not fail) without a private network', async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const d = new ConsoleDiscovery({
      send: (ip) => sent.push(ip),
      needed: () => true,
      interfaces: () => ({}),
      arp: null,
    });
    d.start();
    await vi.advanceTimersByTimeAsync(6000);
    expect(sent).toEqual([]);
    expect(d.info.subnets).toEqual([]);
    expect(d.info.lastScanAt).not.toBeNull();
    d.stop();
  });
});
