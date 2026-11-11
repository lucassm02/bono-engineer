import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const { version } = JSON.parse(read('../package.json'));
const desktop = JSON.parse(read('../packages/desktop/package.json'));
if (
  typeof version !== 'string' ||
  !/^\d+\.\d+\.\d+$/.test(version) ||
  desktop.version !== version
) {
  throw new Error('Set the same stable version in package.json and packages/desktop/package.json.');
}

const lines = read('../CHANGELOG.md').split(/\r?\n/);
const start = lines.findIndex((line) => /^## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}$/.test(line));
if (start === -1 || !lines[start].startsWith(`## [${version}] - `)) {
  throw new Error(`The latest version in CHANGELOG.md must be ${version}.`);
}

const baseDirective = /^<!-- release-notes-base: (\d+\.\d+\.\d+) -->$/;

function entryLines(startIndex) {
  const end = lines.findIndex(
    (line, index) => index > startIndex && /^## |^\[[^\]]+\]:/.test(line),
  );
  return lines.slice(startIndex + 1, end === -1 ? undefined : end);
}

function entryNotes(entry) {
  return entry
    .filter((line) => !baseDirective.test(line))
    .join('\n')
    .trim();
}

const entry = entryLines(start);
const notes = entryNotes(entry);
const outputPath = process.argv[2];
if (!notes || !outputPath) throw new Error('Provide an output path and nonempty release notes.');

const baseVersion = baseDirective.exec(entry.find((line) => baseDirective.test(line)) ?? '')?.[1];
let description = notes;
if (baseVersion) {
  const base = lines.findIndex(
    (line, index) => index > start && line.startsWith(`## [${baseVersion}] - `),
  );
  const baseNotes = base === -1 ? '' : entryNotes(entryLines(base));
  if (!baseNotes) throw new Error(`Missing release notes for base version ${baseVersion}.`);
  description = `${baseNotes}\n\n## New in ${version}\n\n${notes}`;
}
writeFileSync(outputPath, `${description}\n`);

const tag = `v${version}`;
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=${tag}\n`);
}
console.log(`Release notes ready for ${tag}.`);
