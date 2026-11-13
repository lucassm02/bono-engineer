import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { mkdtemp, rename, rm, rmdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { DesktopUpdateStatus, ReleaseNote } from '@gt7/shared';
import { autoUpdater, type NsisUpdater } from 'electron-updater';

const REPO = 'lucassm02/bono-engineer';
const CHECK_INTERVAL = 6 * 60 * 60_000;
const CHECK_COOLDOWN = 10_000;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_NOTES = 512 * 1024;

interface ReleaseAsset {
  url: string;
  size: number;
  digest: string;
}

interface Candidate {
  version: string;
  asset: ReleaseAsset;
}

interface Options {
  mode: DesktopUpdateStatus['mode'];
  version: string;
  notesFile: string;
  previousVersion?: string | undefined;
  dismissedVersion?: string | undefined;
  seenVersion?: string | undefined;
  publish(status: DesktopUpdateStatus): void;
  save(key: 'lastVersion' | 'dismissedVersion' | 'seenVersion', version: string): void;
  chooseDestination(name: string): Promise<string | undefined>;
  prepareInstall(): Promise<boolean>;
  installFailed(): void;
  log(message: string): void;
}

export function newerVersion(candidate: string, installed: string): boolean {
  if (!VERSION.test(candidate) || !VERSION.test(installed)) return false;
  const a = candidate.split('.').map(BigInt);
  const b = installed.split('.').map(BigInt);
  const firstDifference = a.findIndex((part, i) => part !== b[i]);
  return firstDifference !== -1 && a[firstDifference]! > b[firstDifference]!;
}

export function parseReleaseNotes(value: unknown, target: string): ReleaseNote[] {
  if (typeof value !== 'object' || value === null) return [];
  const { version, entries } = value as { version?: unknown; entries?: unknown };
  if (version !== target || !Array.isArray(entries)) return [];
  const seen = new Set<string>();
  const notes = entries.filter(
    (note): note is ReleaseNote =>
      !!note &&
      typeof note === 'object' &&
      typeof note.version === 'string' &&
      (note.version === target || newerVersion(target, note.version)) &&
      typeof note.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(note.date) &&
      typeof note.markdown === 'string' &&
      note.markdown.trim().length > 0,
  );
  if (notes[0]?.version !== target) return [];
  return notes.filter((note) => {
    if (seen.has(note.version)) return false;
    seen.add(note.version);
    return true;
  });
}

function notesSince(notes: ReleaseNote[], from: string | undefined): ReleaseNote[] {
  return from ? notes.filter((note) => newerVersion(note.version, from)) : notes.slice(0, 1);
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Bono-Engineer' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || !response.body) throw new Error('HTTP ' + response.status);
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of Readable.fromWeb(response.body)) {
    length += chunk.byteLength;
    if (length > MAX_NOTES) throw new Error('Update metadata is too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function assetUrl(version: string, name: string): string {
  return 'https://github.com/' + REPO + '/releases/download/v' + version + '/' + name;
}

async function releaseCandidate(installed: string, portable: boolean): Promise<Candidate | null> {
  const data = (await fetchJson('https://api.github.com/repos/' + REPO + '/releases/latest')) as {
    tag_name?: string;
    draft?: boolean;
    prerelease?: boolean;
    assets?: { name: string; size: number; digest?: string }[];
  };
  if (!data.tag_name?.startsWith('v') || data.draft || data.prerelease) {
    throw new Error('Invalid stable release');
  }
  const version = data.tag_name.slice(1);
  if (!VERSION.test(version)) throw new Error('Invalid release version');
  if (!newerVersion(version, installed)) return null;
  const name = portable
    ? 'Bono-Engineer-' + version + '-portable.exe'
    : 'Bono-Engineer-Setup-' + version + '.exe';
  const file = data.assets?.find((asset) => asset.name === name);
  if (
    !file ||
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    !/^sha256:[a-f0-9]{64}$/i.test(file.digest ?? '')
  ) {
    throw new Error('Missing release executable or digest');
  }
  return {
    version,
    asset: { url: assetUrl(version, name), size: file.size, digest: file.digest!.slice(7) },
  };
}

async function downloadPortable(
  file: ReleaseAsset,
  destination: string,
  progress: (value: number) => void,
): Promise<void> {
  const temp = await mkdtemp(join(dirname(destination), '.bono-update-'));
  const partial = join(temp, 'download.exe');
  try {
    const response = await fetch(file.url, { signal: AbortSignal.timeout(10 * 60_000) });
    if (!response.ok || !response.body) throw new Error('HTTP ' + response.status);
    const hash = createHash('sha256');
    let bytes = 0;
    const verify = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > file.size) return callback(new Error('Update exceeds the expected size'));
        hash.update(chunk);
        progress((bytes / file.size) * 100);
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body),
      verify,
      createWriteStream(partial, { flags: 'wx' }),
    );
    if (bytes !== file.size || hash.digest('hex') !== file.digest.toLowerCase()) {
      throw new Error('Portable update failed integrity verification');
    }
    await rename(partial, destination);
  } finally {
    await rm(partial, { force: true }).catch(() => {});
    await rmdir(temp).catch(() => {});
  }
}

async function verifyInstaller(path: string, file: ReleaseAsset): Promise<void> {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += chunk.length;
    if (size > file.size) throw new Error('Installer exceeds the published size');
    hash.update(chunk);
  }
  if (size !== file.size || hash.digest('hex') !== file.digest.toLowerCase()) {
    throw new Error('Installer does not match the published GitHub asset');
  }
}

export class DesktopUpdates {
  readonly #updater: NsisUpdater | null;
  readonly #options: Options;
  #status: DesktopUpdateStatus;
  #candidate: Candidate | null = null;
  #installer: string | null = null;
  #operation: Promise<void> | null = null;
  #nextCheck = 0;

  constructor(
    options: Options,
    updater = options.mode === 'installed' ? (autoUpdater as NsisUpdater) : null,
  ) {
    this.#options = options;
    this.#updater = updater;
    let notes: ReleaseNote[] = [];
    try {
      notes = parseReleaseNotes(
        JSON.parse(readFileSync(options.notesFile, 'utf8')),
        options.version,
      );
    } catch (error) {
      options.log('Could not read bundled release notes: ' + String(error));
    }
    const upgraded =
      options.previousVersion && newerVersion(options.version, options.previousVersion);
    const showInstalledNotes =
      !!upgraded && options.seenVersion !== options.version && notes.length > 0;
    this.#status = {
      mode: options.mode,
      version: options.version,
      phase: 'idle',
      target: null,
      checkedAt: null,
      progress: null,
      error: null,
      notes: [],
      notesAvailable: false,
      installedNotes: notesSince(notes, showInstalledNotes ? options.previousVersion : undefined),
      showInstalledNotes,
      dismissed: false,
    };
    if (!showInstalledNotes) options.save('lastVersion', options.version);
    if (!updater) return;
    updater.logger = { info: options.log, warn: options.log, error: options.log };
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.disableWebInstaller = true;
    updater.on('error', (error) => {
      options.log('Update error: ' + error.message);
      if (this.#status.phase === 'installing') {
        this.#set({ phase: 'ready', error: 'install' });
        options.installFailed();
      }
    });
    updater.on('download-progress', ({ percent }) => this.#progress(percent));
  }

  get status(): DesktopUpdateStatus {
    return this.#status;
  }

  start(): void {
    if (this.#status.mode === 'development') return;
    setTimeout(() => void this.check(), 5_000).unref();
    setInterval(() => void this.check(), CHECK_INTERVAL).unref();
  }

  #set(patch: Partial<DesktopUpdateStatus>): void {
    this.#status = { ...this.#status, ...patch };
    this.#options.publish(this.#status);
  }

  #progress(value: number): void {
    const progress = Math.floor(Math.max(0, Math.min(value, 100)));
    if (this.#status.phase === 'downloading' && progress !== this.#status.progress) {
      this.#set({ progress });
    }
  }

  #run(action: () => Promise<void>): Promise<void> {
    if (this.#operation) return this.#operation;
    this.#operation = Promise.resolve()
      .then(action)
      .finally(() => {
        this.#operation = null;
      });
    return this.#operation;
  }

  check(): Promise<void> {
    if (
      this.#status.mode === 'development' ||
      this.#status.phase === 'installing' ||
      Date.now() < this.#nextCheck
    )
      return Promise.resolve();
    return this.#run(async () => {
      this.#nextCheck = Date.now() + CHECK_COOLDOWN;
      const previous = this.#status.phase;
      this.#set({ phase: 'checking', error: null });
      try {
        const candidate = await releaseCandidate(
          this.#status.version,
          this.#status.mode === 'portable',
        );
        if (candidate && this.#updater) {
          const result = await this.#updater.checkForUpdates();
          if (!result?.isUpdateAvailable || result.updateInfo.version !== candidate.version) {
            throw new Error('The latest release and installer feed do not agree');
          }
          const files = result.updateInfo.files;
          if (
            files.length !== 1 ||
            files[0]?.url !== basename(candidate.asset.url) ||
            files[0].size !== candidate.asset.size ||
            !/^[A-Za-z0-9+/]{86}==$/.test(files[0].sha512)
          ) {
            throw new Error('Unexpected installer in the update feed');
          }
        }
        const same =
          !!candidate &&
          candidate.version === this.#candidate?.version &&
          candidate.asset.digest === this.#candidate.asset.digest;
        if (!same) this.#installer = null;
        this.#candidate = candidate;
        const checkedAt = Date.now();
        if (!candidate) {
          this.#set({
            phase: 'current',
            checkedAt,
            target: null,
            notes: [],
            notesAvailable: false,
            dismissed: false,
          });
          return;
        }
        let notes = same ? this.#status.notes : [];
        if (notes.length === 0) {
          try {
            const payload = await fetchJson(assetUrl(candidate.version, 'release-notes.json'));
            notes = notesSince(parseReleaseNotes(payload, candidate.version), this.#status.version);
          } catch (error) {
            this.#options.log('Could not load remote release notes: ' + String(error));
          }
        }
        this.#set({
          phase: same && (previous === 'ready' || previous === 'saved') ? previous : 'available',
          target: candidate.version,
          checkedAt,
          notes,
          notesAvailable: notes.length > 0,
          dismissed: candidate.version === this.#options.dismissedVersion,
        });
      } catch (error) {
        this.#options.log('Could not check for updates: ' + String(error));
        this.#set({
          phase: previous === 'ready' || previous === 'saved' ? previous : 'error',
          error: 'check',
        });
      }
    });
  }

  download(): Promise<void> {
    return this.#run(async () => {
      const candidate = this.#candidate;
      if (
        !candidate ||
        !['available', 'saved', 'error'].includes(this.#status.phase) ||
        this.#status.error === 'check'
      )
        return;
      try {
        if (this.#status.mode === 'portable') {
          const destination = await this.#options.chooseDestination(basename(candidate.asset.url));
          if (!destination) return;
          this.#set({ phase: 'downloading', progress: 0, error: null });
          await downloadPortable(candidate.asset, destination, (value) => this.#progress(value));
        } else {
          if (!this.#updater) throw new Error('Updater unavailable');
          this.#set({ phase: 'downloading', progress: 0, error: null });
          const [installer] = await this.#updater.downloadUpdate();
          if (!installer) throw new Error('Installer unavailable');
          await verifyInstaller(installer, candidate.asset);
          this.#installer = installer;
        }
        this.#set({ phase: this.#status.mode === 'portable' ? 'saved' : 'ready', progress: null });
      } catch (error) {
        this.#options.log('Could not download update: ' + String(error));
        this.#set({ phase: 'error', error: 'download', progress: null });
      }
    });
  }

  install(): Promise<void> {
    return this.#run(async () => {
      const updater = this.#updater;
      const installer = this.#installer;
      const candidate = this.#candidate;
      if (!updater || !installer || !candidate || this.#status.phase !== 'ready') return;
      this.#set({ phase: 'installing', error: null });
      try {
        await verifyInstaller(installer, candidate.asset);
      } catch (error) {
        this.#options.log('Could not verify installer: ' + String(error));
        this.#installer = null;
        this.#set({ phase: 'error', error: 'download' });
        return;
      }
      try {
        if (!(await this.#options.prepareInstall())) {
          this.#set({ phase: 'ready', error: 'busy' });
          return;
        }
        updater.quitAndInstall(false, true);
      } catch (error) {
        this.#options.log('Could not start installer: ' + String(error));
        this.#set({ phase: 'ready', error: 'install' });
        this.#options.installFailed();
      }
    });
  }

  dismiss(): void {
    const version = this.#status.target;
    if (!version) return;
    this.#options.dismissedVersion = version;
    this.#options.save('dismissedVersion', version);
    this.#set({ dismissed: true });
  }

  markNotesRead(): void {
    const version = this.#status.version;
    this.#options.save('seenVersion', version);
    this.#options.save('lastVersion', version);
    this.#set({ showInstalledNotes: false });
  }
}
