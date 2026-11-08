import { normalizeDeviceProfile } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { RollingHistory } from '../live/history.ts';
import { backoffMs, parseServerMessage, wsUrlFor } from '../net/wsClient.ts';
import { shiftLightLevel, shiftZone } from './shift.ts';
import { statusKind } from './status.ts';

describe('normalizeDeviceProfile (shared/ui.ts)', () => {
  it('fills defaults from garbage', () => {
    const p = normalizeDeviceProfile(null, 'dev');
    expect(p.deviceId).toBe('dev');
    expect(p.views[0]).toBe('corrida');
    expect(p.startView).toBe('corrida');
  });

  it('drops unknown / duplicate views and fixes the start view', () => {
    const p = normalizeDeviceProfile(
      { views: ['pneus', 'xyz', 'pneus', 'motor'], startView: 'mapa', deltaReference: 'bogus' },
      'dev',
    );
    expect(p.views).toEqual(['pneus', 'motor']);
    expect(p.startView).toBe('pneus');
    expect(p.deltaReference).toBe('personalBest');
  });

  it('never returns an empty carousel', () => {
    expect(normalizeDeviceProfile({ views: [] }, 'd').views.length).toBeGreaterThan(0);
  });
});

describe('shift lights', () => {
  const alert = { min: 6000, max: 8000 };
  it('levels', () => {
    expect(shiftLightLevel(5000, alert, 10)).toEqual({ lit: 0, limiter: false });
    expect(shiftLightLevel(7000, alert, 10)).toEqual({ lit: 5, limiter: false });
    expect(shiftLightLevel(8000, alert, 10)).toEqual({ lit: 10, limiter: true });
  });
  it('falls back when the game gives no range', () => {
    expect(shiftLightLevel(8800, { min: 0, max: 0 }, 10, 9000).limiter).toBe(true);
    expect(shiftLightLevel(3000, { min: 0, max: 0 }, 10, 9000).lit).toBe(0);
  });
  it('zones', () => {
    expect(shiftZone(0, 10)).toBe('green');
    expect(shiftZone(5, 10)).toBe('amber');
    expect(shiftZone(9, 10)).toBe('red');
  });
});

describe('ws client helpers', () => {
  it('backoff doubles and caps', () => {
    const mid = () => 0.5;
    expect(backoffMs(0, mid)).toBe(500);
    expect(backoffMs(1, mid)).toBe(1000);
    expect(backoffMs(3, mid)).toBe(4000);
    expect(backoffMs(20, mid)).toBe(10000);
    expect(backoffMs(0, () => 0)).toBe(400);
  });
  it('parses only valid messages', () => {
    expect(parseServerMessage('{"type":"pong","t":1,"serverTime":2}')?.type).toBe('pong');
    expect(parseServerMessage('nope')).toBeNull();
    expect(parseServerMessage('{"x":1}')).toBeNull();
    expect(parseServerMessage(new ArrayBuffer(2))).toBeNull();
  });
  it('builds the ws url from the page location', () => {
    expect(wsUrlFor({ protocol: 'http:', host: '192.168.0.10:8770' }, '/ws')).toBe(
      'ws://192.168.0.10:8770/ws',
    );
    expect(wsUrlFor({ protocol: 'https:', host: 'pc.local' }, '/ws')).toBe('wss://pc.local/ws');
  });
});

describe('status screen decision', () => {
  const base = {
    source: 'server' as const,
    wsStatus: 'open' as const,
    wsEverOpened: true,
    wsAttempt: 0,
    liveState: 'onTrack',
  };
  it('cases', () => {
    expect(statusKind(base)).toBe('none');
    expect(statusKind({ ...base, wsStatus: 'connecting', wsEverOpened: false })).toBe(
      'connectingServer',
    );
    expect(statusKind({ ...base, wsStatus: 'closed', wsAttempt: 2 })).toBe('noServer');
    expect(statusKind({ ...base, liveState: null })).toBe('noConsole');
    expect(statusKind({ ...base, liveState: 'disconnected' })).toBe('noConsole');
    expect(statusKind({ ...base, liveState: 'menu' })).toBe('menu');
    expect(statusKind({ ...base, liveState: 'paused' })).toBe('paused');
    expect(statusKind({ ...base, liveState: 'switchingFormat' })).toBe('switchingFormat');
    expect(statusKind({ ...base, source: 'mock', wsStatus: 'closed', liveState: 'onTrack' })).toBe(
      'none',
    );
  });
});

describe('rolling history', () => {
  it('keeps the last samples contiguous and windowed', () => {
    const h = new RollingHistory(5);
    for (let i = 0; i < 8; i++) h.push({ t: i, throttle: i * 10, brake: 0, speed: i });
    expect(Array.from(h.view('t'))).toEqual([3, 4, 5, 6, 7]);
    expect(Array.from(h.view('throttle', 2))).toEqual([60, 70]);
    expect(h.countWithin(2)).toBe(3);
    h.clear();
    expect(h.size).toBe(0);
    expect(h.countWithin(2)).toBe(0);
  });
});
