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

const end = lines.findIndex((line, index) => index > start && /^## |^\[[^\]]+\]:/.test(line));
const notes = lines
  .slice(start + 1, end === -1 ? undefined : end)
  .join('\n')
  .trim();
const outputPath = process.argv[2];
if (!notes || !outputPath) throw new Error('Provide an output path and nonempty release notes.');
writeFileSync(outputPath, `${notes}\n`);

const tag = `v${version}`;
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=${tag}\n`);
}
console.log(`Release notes ready for ${tag}.`);
