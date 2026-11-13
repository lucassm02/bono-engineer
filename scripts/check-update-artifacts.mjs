import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [directory, appConfig, version] = process.argv.slice(2);
if (!directory || !appConfig || !/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  throw new Error('Provide the artifact directory, app-update.yml and version.');
}

const installer = 'Bono-Engineer-Setup-' + version + '.exe';
const feed = readFileSync(join(directory, 'latest.yml'), 'utf8');
const config = readFileSync(appConfig, 'utf8');
if (
  !/^provider: github\r?$/m.test(config) ||
  !/^owner: lucassm02\r?$/m.test(config) ||
  !/^repo: bono-engineer\r?$/m.test(config)
) {
  throw new Error('The packaged application does not target the Bono GitHub feed.');
}
const expectedVersion = /^version: (\S+)\s*$/m.exec(feed)?.[1];
const url = /^\s*- url: (\S+)\s*$/m.exec(feed)?.[1];
const hash = /^\s+sha512: (\S+)\s*$/m.exec(feed)?.[1];
const size = Number(/^\s+size: (\d+)\s*$/m.exec(feed)?.[1]);
const binary = join(directory, installer);
if (
  expectedVersion !== version ||
  url !== installer ||
  size !== statSync(binary).size ||
  statSync(binary + '.blockmap').size === 0
) {
  throw new Error('The update feed does not match the built installer.');
}
const actual = createHash('sha512');
for await (const chunk of createReadStream(binary)) actual.update(chunk);
if (actual.digest('base64') !== hash) throw new Error('Installer SHA-512 mismatch.');
const notes = JSON.parse(readFileSync(join(directory, 'release-notes.json'), 'utf8'));
if (
  notes.version !== version ||
  notes.entries?.[0]?.version !== version ||
  !notes.entries[0].markdown?.trim()
) {
  throw new Error('Release notes do not match the installer version.');
}
console.log('Update artifacts verified for v' + version);
