import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const VERSION_HEADING = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/;
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
const start = lines.findIndex((line) => VERSION_HEADING.test(line));
if (start === -1 || !lines[start].startsWith(`## [${version}] - `)) {
  throw new Error(`The latest version in CHANGELOG.md must be ${version}.`);
}

const baseDirective = /^<!-- release-notes-base: (\d+\.\d+\.\d+) -->$/;
const sinceDirective = /^<!-- release-notes-since: (\d+\.\d+\.\d+) -->$/;

function entryLines(startIndex) {
  const end = lines.findIndex(
    (line, index) => index > startIndex && /^## |^\[[^\]]+\]:/.test(line),
  );
  return lines.slice(startIndex + 1, end === -1 ? undefined : end);
}

function entryNotes(entry) {
  return entry
    .filter((line) => !baseDirective.test(line) && !sinceDirective.test(line))
    .join('\n')
    .trim();
}

const entry = entryLines(start);
const notes = entryNotes(entry);
const outputPath = process.argv[2];
if (!notes || !outputPath) throw new Error('Provide an output path and nonempty release notes.');

/** Every released entry from `since` up to (not including) the current version, newest first. */
function historySince(since) {
  const sections = [];
  let found = false;
  lines.forEach((line, index) => {
    const m = VERSION_HEADING.exec(line);
    if (!m || index <= start) return;
    const body = entryNotes(entryLines(index));
    if (body) sections.push(`### ${m[1]} (${m[2]})\n\n${body.replace(/^### /gm, '#### ')}`);
    if (m[1] === since) found = true;
  });
  if (!found)
    throw new Error(`Release notes history starts at ${since}, which is not in the changelog.`);
  const cut = sections.findIndex((section) => section.startsWith(`### ${since} `));
  return sections.slice(0, cut + 1).join('\n\n');
}

const baseVersion = baseDirective.exec(entry.find((line) => baseDirective.test(line)) ?? '')?.[1];
const sinceVersion = sinceDirective.exec(
  entry.find((line) => sinceDirective.test(line)) ?? '',
)?.[1];
let description = notes;
if (sinceVersion) {
  description = `## New in ${version}\n\n${notes}\n\n## Earlier versions\n\n${historySince(sinceVersion)}`;
} else if (baseVersion) {
  const base = lines.findIndex(
    (line, index) => index > start && line.startsWith(`## [${baseVersion}] - `),
  );
  const baseNotes = base === -1 ? '' : entryNotes(entryLines(base));
  if (!baseNotes) throw new Error(`Missing release notes for base version ${baseVersion}.`);
  description = `${baseNotes}\n\n## New in ${version}\n\n${notes}`;
}
writeFileSync(outputPath, `${description}\n`);
const jsonPath = process.argv[3];
if (jsonPath) {
  const entries = lines.flatMap((line, index) => {
    const match = VERSION_HEADING.exec(line);
    if (!match) return [];
    const markdown = entryNotes(entryLines(index));
    return markdown ? [{ version: match[1], date: match[2], markdown }] : [];
  });
  const json = `${JSON.stringify({ version, entries }, null, 2)}\n`;
  if (Buffer.byteLength(json) > 512 * 1024) throw new Error('Release notes exceed 512 KiB.');
  writeFileSync(jsonPath, json);
}

const tag = `v${version}`;
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=${tag}\n`);
}
console.log(`Release notes ready for ${tag}.`);
