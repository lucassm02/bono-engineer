import { resolve } from 'node:path';
import { defaultDataDir, resolveDataDir } from '@gt7/core';
import { describe, expect, it } from 'vitest';
import { dataDirFromArgs } from './data-dir.ts';

describe('dataDirFromArgs', () => {
  it('--data (two forms) wins over everything', () => {
    const env = { GT7_DATA: 'C:\\env\\data' };
    expect(dataDirFromArgs(['--data', 'minha-pasta'], env)).toBe(resolve('minha-pasta'));
    expect(dataDirFromArgs(['--data=outra'], env)).toBe(resolve('outra'));
  });

  it('GT7_DATA / GT7_DATA_DIR come next', () => {
    expect(dataDirFromArgs([], { GT7_DATA: 'a' })).toBe(resolve('a'));
    expect(dataDirFromArgs([], { GT7_DATA_DIR: 'b' })).toBe(resolve('b'));
  });

  it('without anything uses the same per-user folder as the app (not <repo>/data)', () => {
    const got = dataDirFromArgs([], {});
    expect(got).toBe(resolveDataDir({ env: {} }));
    expect(got).toBe(defaultDataDir({ env: {} }));
    expect(got).not.toBe(resolve(import.meta.dirname, '../../../data'));
  });
});
