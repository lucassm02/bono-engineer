import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDesktopState, readDesktopState, writeDesktopState } from './state-file.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'gt7-desktop-'));
  dirs.push(d);
  return d;
};

describe('desktop state file', () => {
  it('missing or corrupt files give defaults', () => {
    const d = tmp();
    expect(readDesktopState(join(d, 'nope.json'))).toEqual({ window: null, trayHintShown: false });
    writeFileSync(join(d, 'bad.json'), '{not json');
    expect(readDesktopState(join(d, 'bad.json'))).toEqual({ window: null, trayHintShown: false });
  });

  it('writes (creating the folder) and reads back', () => {
    const file = join(tmp(), 'sub', 'state.json');
    const state = {
      window: { x: 1, y: 2, width: 1000, height: 700, maximized: false },
      trayHintShown: true,
    };
    writeDesktopState(file, state);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(state);
    expect(readDesktopState(file)).toEqual(state);
  });

  it('ignores a bad window inside an otherwise valid file', () => {
    expect(parseDesktopState({ window: { width: 1 }, trayHintShown: true })).toEqual({
      window: null,
      trayHintShown: true,
    });
  });
});

describe('data folder chosen by the user', () => {
  it('is read back and ignored when empty or not a string', () => {
    expect(parseDesktopState({ dataDir: 'D:OneDriveBono' }).dataDir).toBe('D:OneDriveBono');
    expect(parseDesktopState({ dataDir: '   ' }).dataDir).toBeUndefined();
    expect(parseDesktopState({ dataDir: 42 }).dataDir).toBeUndefined();
    expect(parseDesktopState(null).dataDir).toBeUndefined();
  });
});
