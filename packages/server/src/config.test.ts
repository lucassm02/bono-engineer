import { join, resolve } from 'node:path';
import { defaultDataDir } from '@gt7/core';
import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from './config.ts';

describe('parseConfig: zero-config defaults', () => {
  it('needs no argument: default port, per-user data folder, opens the browser', () => {
    const c = parseConfig([], {});
    expect(c.port).toBe(8770);
    expect(c.portExplicit).toBe(false);
    expect(c.dataDir).toBe(defaultDataDir({ env: {} }));
    expect(c.dataDirExplicit).toBe(false);
    expect(c.consoleIp).toBeNull();
    expect(c.liveFormat).toBeNull(); // automatic
    expect(c.sim).toBeNull();
    expect(c.open).toBe(true);
    // never inside the repository
    expect(c.dataDir).not.toContain(join('gt7', 'data'));
  });

  it('demo uses the demo subfolder of the per-user folder', () => {
    const c = parseConfig(['--sim'], {});
    expect(c.dataDir).toBe(join(defaultDataDir({ env: {} }), 'demo'));
    expect(c.dataDirExplicit).toBe(false);
  });

  it('--data and GT7_DATA / GT7_DATA_DIR still override (and --data wins)', () => {
    expect(parseConfig(['--data', 'minha-pasta'], {}).dataDir).toBe(resolve('minha-pasta'));
    expect(parseConfig([], { GT7_DATA: 'a' }).dataDir).toBe(resolve('a'));
    expect(parseConfig([], { GT7_DATA_DIR: 'b' }).dataDir).toBe(resolve('b'));
    const both = parseConfig(['--data', 'x'], { GT7_DATA: 'y' });
    expect(both.dataDir).toBe(resolve('x'));
    expect(both.dataDirExplicit).toBe(true);
    expect(parseConfig(['--sim', '--data', 'x'], {}).dataDir).toBe(resolve('x'));
  });

  it('port is explicit only when given', () => {
    expect(parseConfig(['--port', '9000'], {}).portExplicit).toBe(true);
    expect(parseConfig([], { GT7_PORT: '9001' })).toMatchObject({ port: 9001, portExplicit: true });
    expect(() => parseConfig(['--port', '0'], {})).toThrow(ConfigError);
  });

  it('keeps the advanced flags working', () => {
    const c = parseConfig(['--ps-ip', '192.168.0.20', '--format', 'B', '--no-open'], {});
    expect(c).toMatchObject({ consoleIp: '192.168.0.20', liveFormat: 'B', open: false });
    expect(() => parseConfig(['--ps-ip', 'abc'], {})).toThrow(/IPv4/);
    expect(() => parseConfig(['--format', 'Z'], {})).toThrow(/A, B/);
  });
});
