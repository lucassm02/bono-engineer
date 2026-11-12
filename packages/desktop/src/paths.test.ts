import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bundledWebDist,
  electronUserDataDir,
  isInternalUrl,
  isOpenableExternally,
  loopbackHost,
  parsePageAction,
  serverUrl,
} from './paths.ts';

describe('electronUserDataDir', () => {
  it('uses LOCALAPPDATA on Windows, never the data folder (APPDATA)', () => {
    const dir = electronUserDataDir({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:UsersaAppDataLocal', APPDATA: 'C:UsersaAppDataRoaming' },
      home: 'C:Usersa',
    });
    expect(dir).toBe(join('C:UsersaAppDataLocal', 'Bono Engineer'));
    expect(dir).not.toContain('Roaming');
  });
  it('falls back to <home>AppDataLocal', () => {
    expect(electronUserDataDir({ platform: 'win32', env: {}, home: 'C:Usersa' })).toBe(
      join('C:Usersa', 'AppData', 'Local', 'Bono Engineer'),
    );
  });
  it('differs from the data folder name on macOS and Linux', () => {
    expect(electronUserDataDir({ platform: 'darwin', env: {}, home: '/Users/a' })).toBe(
      join('/Users/a', 'Library', 'Application Support', 'Bono Engineer Desktop'),
    );
    expect(
      electronUserDataDir({ platform: 'linux', env: { XDG_CONFIG_HOME: '/x' }, home: '/h' }),
    ).toBe(join('/x', 'bono-engineer-desktop'));
    expect(electronUserDataDir({ platform: 'linux', env: {}, home: '/h' })).toBe(
      join('/h', '.config', 'bono-engineer-desktop'),
    );
  });
});

describe('server address', () => {
  it('wildcard / localhost binds are reached through 127.0.0.1', () => {
    for (const h of ['0.0.0.0', '::', '', 'localhost']) expect(loopbackHost(h)).toBe('127.0.0.1');
    expect(loopbackHost('192.168.0.5')).toBe('192.168.0.5');
    expect(loopbackHost('::1')).toBe('[::1]');
  });
  it('builds the URL, with the token only when there is one', () => {
    expect(serverUrl('0.0.0.0', 8771)).toBe('http://127.0.0.1:8771/');
    expect(serverUrl('0.0.0.0', 8770, 'a b&c')).toBe('http://127.0.0.1:8770/?token=a%20b%26c');
  });
  it('finds the bundled dashboard next to the script', () => {
    expect(bundledWebDist(join('app', 'dist'))).toBe(join('app', 'dist', 'web'));
  });
});

describe('isInternalUrl', () => {
  it('accepts only our own server (loopback + port)', () => {
    expect(isInternalUrl('http://127.0.0.1:8770/#/inicio', 8770)).toBe(true);
    expect(isInternalUrl('http://localhost:8770/api/status', 8770)).toBe(true);
    expect(isInternalUrl('http://[::1]:8770/', 8770)).toBe(true);
    expect(isInternalUrl('http://127.0.0.1:8771/', 8770)).toBe(false);
    expect(isInternalUrl('http://127.0.0.1/', 8770)).toBe(false);
    expect(isInternalUrl('https://127.0.0.1:8770/', 8770)).toBe(false);
  });
  it('rejects other hosts, look-alikes and non-http schemes', () => {
    expect(isInternalUrl('https://example.com/', 8770)).toBe(false);
    expect(isInternalUrl('http://localhost.evil.com:8770/', 8770)).toBe(false);
    expect(isInternalUrl('http://127.0.0.1.evil.com:8770/', 8770)).toBe(false);
    expect(isInternalUrl('http://evil.com:8770/@127.0.0.1', 8770)).toBe(false);
    expect(isInternalUrl('file:///C:/Windows/win.ini', 8770)).toBe(false);
    expect(isInternalUrl('javascript:alert(1)', 8770)).toBe(false);
    expect(isInternalUrl('data:text/html,hi', 8770)).toBe(false);
    expect(isInternalUrl('not a url', 8770)).toBe(false);
  });
  it('also accepts the configured bind host', () => {
    expect(isInternalUrl('http://192.168.0.5:8770/', 8770, '192.168.0.5')).toBe(true);
    expect(isInternalUrl('http://192.168.0.6:8770/', 8770, '192.168.0.5')).toBe(false);
  });
});

describe('isOpenableExternally', () => {
  it('only http(s) goes to the system browser', () => {
    expect(isOpenableExternally('https://github.com/')).toBe(true);
    expect(isOpenableExternally('http://example.com/x')).toBe(true);
    expect(isOpenableExternally('file:///C:/x.exe')).toBe(false);
    expect(isOpenableExternally('javascript:alert(1)')).toBe(false);
    expect(isOpenableExternally('ms-msdt:/id')).toBe(false);
    expect(isOpenableExternally('')).toBe(false);
  });
});

describe('parsePageAction', () => {
  it('recognizes the error page buttons and nothing else', () => {
    expect(parsePageAction('bono-app://retry')).toBe('retry');
    expect(parsePageAction('bono-app://quit/')).toBe('quit');
    expect(parsePageAction('bono-app://default-data')).toBe('default-data');
    expect(parsePageAction('bono-app://format-c')).toBeNull();
    expect(parsePageAction('http://127.0.0.1:8770/')).toBeNull();
  });
});
