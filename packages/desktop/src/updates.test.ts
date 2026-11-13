import { createHash } from 'node:crypto';
import { mkdtempSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { NsisUpdater } from 'electron-updater';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopUpdates, newerVersion, parseReleaseNotes } from './updates.ts';

vi.mock('electron-updater', () => ({ autoUpdater: null }));

const note = (version: string) => ({ version, date: '2026-11-13', markdown: '- Changes.' });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('desktop update checks', () => {
  it('accepts only newer stable versions', () => {
    expect(newerVersion('1.10.0', '1.9.9')).toBe(true);
    expect(newerVersion('1.9.9', '1.10.0')).toBe(false);
    expect(newerVersion('1.10.0', '1.10.0')).toBe(false);
    expect(newerVersion('1.10.1-beta.1', '1.10.0')).toBe(false);
  });

  it('rejects wrong-version notes and keeps version-specific entries', () => {
    expect(parseReleaseNotes({ version: '1.2.0', entries: [note('1.1.0')] }, '1.2.0')).toEqual([]);
    expect(
      parseReleaseNotes(
        {
          version: '1.2.0',
          entries: [note('1.2.0'), note('2.0.0'), note('1.1.0'), note('1.1.0')],
        },
        '1.2.0',
      ),
    ).toEqual([note('1.2.0'), note('1.1.0')]);
  });

  it('loads notes offline after updating and preserves the acknowledgement', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bono-update-test-'));
    try {
      const notesFile = join(dir, 'release-notes.json');
      const entries = [note('1.3.0'), note('1.2.0'), note('1.1.0')];
      writeFileSync(notesFile, JSON.stringify({ version: '1.3.0', entries }));
      const save = vi.fn();
      const updates = new DesktopUpdates({
        mode: 'development',
        version: '1.3.0',
        previousVersion: '1.1.0',
        notesFile,
        save,
        publish: vi.fn(),
        chooseDestination: vi.fn(),
        prepareInstall: vi.fn(),
        installFailed: vi.fn(),
        log: vi.fn(),
      });
      expect(updates.status.showInstalledNotes).toBe(true);
      expect(updates.status.installedNotes).toEqual(entries.slice(0, 2));
      updates.markNotesRead();
      expect(updates.status.showInstalledNotes).toBe(false);
      expect(save).toHaveBeenCalledWith('seenVersion', '1.3.0');
      expect(save).toHaveBeenCalledWith('lastVersion', '1.3.0');
    } finally {
      rmSync(join(dir, 'release-notes.json'), { force: true });
      rmdirSync(dir);
    }
  });

  it('checks the feed, verifies the cached installer and installs only after confirmation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bono-nsis-test-'));
    const installer = join(dir, 'Bono-Engineer-Setup-1.2.0.exe');
    try {
      const bytes = Buffer.from('installer');
      writeFileSync(installer, bytes);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const sha512 = createHash('sha512').update(bytes).digest('base64');
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(
            Response.json({
              tag_name: 'v1.2.0',
              draft: false,
              prerelease: false,
              assets: [
                { name: basename(installer), size: bytes.length, digest: 'sha256:' + sha256 },
              ],
            }),
          )
          .mockResolvedValueOnce(Response.json({ version: '1.2.0', entries: [note('1.2.0')] })),
      );
      const updater = {
        on: vi.fn(),
        checkForUpdates: vi.fn().mockResolvedValue({
          isUpdateAvailable: true,
          updateInfo: {
            version: '1.2.0',
            files: [{ url: basename(installer), size: bytes.length, sha512 }],
          },
        }),
        downloadUpdate: vi.fn().mockResolvedValue([installer]),
        quitAndInstall: vi.fn(),
      };
      const prepareInstall = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      const updates = new DesktopUpdates(
        {
          mode: 'installed',
          version: '1.1.0',
          notesFile: '',
          save: vi.fn(),
          publish: vi.fn(),
          chooseDestination: vi.fn(),
          prepareInstall,
          installFailed: vi.fn(),
          log: vi.fn(),
        },
        updater as unknown as NsisUpdater,
      );

      await updates.check();
      expect(updates.status.phase).toBe('available');
      expect(updater.downloadUpdate).not.toHaveBeenCalled();
      await updates.download();
      expect(updates.status.phase).toBe('ready');
      expect(updater.quitAndInstall).not.toHaveBeenCalled();
      await updates.install();
      expect(updates.status).toMatchObject({ phase: 'ready', error: 'busy' });
      expect(updater.quitAndInstall).not.toHaveBeenCalled();

      writeFileSync(installer, 'tampered');
      await updates.install();
      expect(updates.status).toMatchObject({ phase: 'error', error: 'download' });
      expect(updater.quitAndInstall).not.toHaveBeenCalled();

      writeFileSync(installer, bytes);
      await updates.download();
      await updates.install();
      expect(updater.quitAndInstall).toHaveBeenCalledOnce();
      expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    } finally {
      rmSync(installer, { force: true });
      rmdirSync(dir);
    }
  });

  it('shows the stable release notes, then records a dismissal', async () => {
    const save = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          tag_name: 'v1.2.0',
          draft: false,
          prerelease: false,
          assets: [
            {
              name: 'Bono-Engineer-1.2.0-portable.exe',
              size: 12,
              digest: 'sha256:' + 'a'.repeat(64),
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json({ version: '1.2.0', entries: [note('1.2.0')] }));
    vi.stubGlobal('fetch', fetch);
    const updates = new DesktopUpdates({
      mode: 'portable',
      version: '1.1.0',
      notesFile: '',
      save,
      publish: vi.fn(),
      chooseDestination: vi.fn(),
      prepareInstall: vi.fn(),
      installFailed: vi.fn(),
      log: vi.fn(),
    });
    await updates.check();
    expect(updates.status).toMatchObject({
      phase: 'available',
      target: '1.2.0',
      notes: [note('1.2.0')],
    });
    expect(fetch).toHaveBeenLastCalledWith(
      'https://github.com/lucassm02/bono-engineer/releases/download/v1.2.0/release-notes.json',
      expect.anything(),
    );
    updates.dismiss();
    expect(updates.status.dismissed).toBe(true);
    expect(save).toHaveBeenCalledWith('dismissedVersion', '1.2.0');
  });
});
