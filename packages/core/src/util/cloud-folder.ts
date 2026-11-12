/**
 * Detects folders kept in sync by a cloud client (OneDrive, Dropbox, Google Drive, iCloud...).
 * SQLite and sync clients do not mix well: the client may lock or upload the journal files in the
 * middle of a write, and two computers opening the same database corrupt it. The app uses this to
 * warn the user and to pick the safer rollback journal instead of WAL.
 */

export interface CloudFolder {
  /** Name shown to the user. */
  provider: string;
}

/** A whole folder name, allowing a suffix after a space ("OneDrive - Empresa", "Dropbox (Pessoal)"). */
const folder = (names: string): RegExp =>
  new RegExp(`(^|[\\\\/])(${names})( [^\\\\/]*)?([\\\\/]|$)`, 'i');

const PROVIDERS: readonly { provider: string; test: RegExp }[] = [
  { provider: 'OneDrive', test: folder('onedrive') },
  { provider: 'Dropbox', test: folder('dropbox') },
  { provider: 'Google Drive', test: folder('google ?drive|my drive|meu drive') },
  { provider: 'iCloud Drive', test: folder('icloud ?drive|mobile documents') },
  { provider: 'Box', test: folder('box|box sync') },
  { provider: 'MEGA', test: folder('mega|megasync') },
  { provider: 'pCloud', test: folder('pcloud|pcloud ?drive') },
  { provider: 'Nextcloud', test: folder('nextcloud') },
];

/** The sync service that owns `path`, judged by the folder names on the way, or null. */
export function detectCloudFolder(path: string): CloudFolder | null {
  for (const { provider, test } of PROVIDERS) {
    if (test.test(path)) return { provider };
  }
  return null;
}
