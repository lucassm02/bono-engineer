import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { Gt7Store } from '../store/store.ts';
import { Gt7Runtime, resolveRecordSetting, SETTINGS_KEYS } from './runtime.ts';

const dirs: string[] = [];
const stores: Gt7Store[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'gt7-record-default-'));
  dirs.push(d);
  return d;
}
function openStore(dir: string): Gt7Store {
  const s = Gt7Store.open(dir);
  stores.push(s);
  return s;
}
afterEach(async () => {
  for (const s of stores.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const session: Session = {
  id: 's1',
  trackId: null,
  carCode: 1,
  startedAt: 1000,
  endedAt: 2000,
  format: '~',
  mode: 'live',
  lapCount: 0,
  bestLapMs: null,
  recordingFile: null,
  notes: null,
};

describe('gravar pacotes brutos (padrão)', () => {
  it('instalação nova: desligado, e o valor é salvo para não mudar depois', () => {
    const store = openStore(tempDir());
    expect(resolveRecordSetting(store)).toBe(false);
    expect(store.getSetting(SETTINGS_KEYS.record)).toBe(false);
  });

  it('instalação existente sem valor salvo (já tem sessões): continua ligado', () => {
    const store = openStore(tempDir());
    store.saveSession(session);
    expect(resolveRecordSetting(store)).toBe(true);
    expect(store.getSetting(SETTINGS_KEYS.record)).toBe(true);
  });

  it('o valor salvo sempre vence, nos dois sentidos', () => {
    const fresh = openStore(tempDir());
    fresh.setSetting(SETTINGS_KEYS.record, true);
    expect(resolveRecordSetting(fresh)).toBe(true);

    const used = openStore(tempDir());
    used.saveSession(session);
    used.setSetting(SETTINGS_KEYS.record, false);
    expect(resolveRecordSetting(used)).toBe(false);
  });

  it('o runtime de uma instalação nova nasce com gravação bruta desligada', async () => {
    const dir = tempDir();
    const rt = new Gt7Runtime({ dataDir: dir, persistConsoleIp: false });
    expect(rt.getSettings().record).toBe(false);
    await rt.close();
    // reabrir não muda o valor
    const again = new Gt7Runtime({ dataDir: dir, persistConsoleIp: false });
    expect(again.getSettings().record).toBe(false);
    await again.close();
  });

  it('a opção explícita do programa continua mandando', async () => {
    const rt = new Gt7Runtime({ dataDir: tempDir(), record: true, persistConsoleIp: false });
    expect(rt.getSettings().record).toBe(true);
    await rt.close();
  });
});
