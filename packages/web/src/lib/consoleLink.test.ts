import type { ConsoleConnection } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import {
  agoText,
  describeLink,
  hostsProbedText,
  ipSourceLabel,
  isLinkFound,
  isValidIpv4,
  MOCK_CYCLE_STEP_MS,
  mockConsoleConnection,
  parseMockConn,
} from './consoleLink.ts';

const base: ConsoleConnection = {
  state: 'searching',
  consoleIp: null,
  source: null,
  subnets: ['192.168.0.0/24'],
  hostsProbed: 0,
  lastScanAt: null,
  lastPacketAt: null,
  hint: null,
};

describe('describeLink', () => {
  it('searching: busy, with the count of hosts tested', () => {
    const v = describeLink({ ...base, hostsProbed: 120 });
    expect(v.tone).toBe('busy');
    expect(v.busy).toBe(true);
    expect(v.title).toBe('Procurando o PS5 na rede…');
    expect(v.short).toBe('Procurando o PS5…');
    expect(v.detail).toContain('120 endereços testados');
    expect(describeLink(base).detail).not.toContain('testados');
  });

  it('found: names the IP and tells what to do', () => {
    const v = describeLink({
      ...base,
      state: 'found',
      consoleIp: '192.168.0.20',
      source: 'discovered',
    });
    expect(v.tone).toBe('info');
    expect(v.title).toBe(
      'Console encontrado (192.168.0.20) — abra o Gran Turismo 7 e entre numa pista',
    );
    expect(v.short).toBe('PS5 encontrado');
  });

  it('receiving is green and quiet; lost is yellow and reconnecting; idle is red', () => {
    expect(describeLink({ ...base, state: 'receiving' })).toMatchObject({
      tone: 'ok',
      title: 'Recebendo telemetria',
      busy: false,
      detail: null,
    });
    expect(describeLink({ ...base, state: 'lost' })).toMatchObject({
      tone: 'warn',
      title: 'Sinal perdido — reconectando…',
      busy: true,
    });
    const idle = describeLink({ ...base, state: 'idle', hint: 'Porta ocupada.' });
    expect(idle.tone).toBe('bad');
    expect(idle.detail).toBe('Porta ocupada.');
  });

  it('uses the server hint when there is one, a default otherwise', () => {
    expect(describeLink({ ...base, state: 'lost', hint: 'Dica do servidor.' }).detail).toBe(
      'Dica do servidor.',
    );
    expect(describeLink({ ...base, state: 'lost' }).detail).toContain('parou de enviar');
  });

  it('no data from the server yet', () => {
    expect(describeLink(null).tone).toBe('warn');
  });
});

describe('texts and helpers', () => {
  it('plural of hosts', () => {
    expect(hostsProbedText(1)).toBe('1 endereço testado');
    expect(hostsProbedText(253)).toBe('253 endereços testados');
  });

  it('ip source labels', () => {
    expect(ipSourceLabel('discovered')).toBe('encontrado automaticamente');
    expect(ipSourceLabel('manual')).toBe('fixado por você');
    expect(ipSourceLabel(null)).toBe('ainda não encontrado');
  });

  it('isLinkFound', () => {
    expect(isLinkFound('found')).toBe(true);
    expect(isLinkFound('receiving')).toBe(true);
    expect(isLinkFound('lost')).toBe(true);
    expect(isLinkFound('searching')).toBe(false);
    expect(isLinkFound('idle')).toBe(false);
    expect(isLinkFound(null)).toBe(false);
  });

  it('agoText', () => {
    const now = 1_000_000;
    expect(agoText(null, now)).toBe('nunca');
    expect(agoText(now - 1000, now)).toBe('agora');
    expect(agoText(now - 12_000, now)).toBe('há 12 s');
    expect(agoText(now - 3 * 60_000, now)).toBe('há 3 min');
    expect(agoText(now - 5 * 3600_000, now)).toBe('há 5 h');
  });
});

describe('isValidIpv4', () => {
  it.each(['192.168.0.20', '10.0.0.1', ' 172.16.5.4 ', '8.8.8.8'])('accepts %s', (ip) => {
    expect(isValidIpv4(ip)).toBe(true);
  });
  it.each([
    '',
    '192.168.0',
    '192.168.0.256',
    '192.168.0.1.5',
    'a.b.c.d',
    '192.168.00.1',
    '192.168.0.01',
    '0.0.0.0',
    '255.255.255.255',
    '192,168,0,1',
    '192.168.0.-1',
  ])('rejects "%s"', (ip) => {
    expect(isValidIpv4(ip)).toBe(false);
  });
});

describe('demo (?mockConn)', () => {
  it('parses the parameter', () => {
    expect(parseMockConn('cycle')).toBe('cycle');
    expect(parseMockConn('lost')).toBe('lost');
    expect(parseMockConn('searching')).toBe('searching');
    expect(parseMockConn('bogus')).toBe('receiving');
    expect(parseMockConn(null)).toBe('receiving');
  });

  it('fixed states are consistent with the real contract', () => {
    const rec = mockConsoleConnection('receiving', 0, 50_000);
    expect(rec).toMatchObject({ state: 'receiving', source: 'simulator', hint: null });
    expect(rec.lastPacketAt).toBe(50_000);
    const srch = mockConsoleConnection('searching', 1000);
    expect(srch.consoleIp).toBeNull();
    expect(srch.source).toBeNull();
    expect(srch.hostsProbed).toBe(50);
    expect(mockConsoleConnection('searching', 10_000_000).hostsProbed).toBe(253);
  });

  it('cycle walks searching → found → receiving → lost and restarts', () => {
    const at = (k: number) => mockConsoleConnection('cycle', k * MOCK_CYCLE_STEP_MS + 100).state;
    expect([at(0), at(1), at(2), at(3), at(4)]).toEqual([
      'searching',
      'found',
      'receiving',
      'lost',
      'searching',
    ]);
  });
});
