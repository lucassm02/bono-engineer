#!/usr/bin/env node
/**
 * Regenerates the GT7 track catalogue:
 *   packages/shared/src/tracks/data.ts      official layouts (id, name, length, corners, ...)
 *   packages/shared/src/tracks/geometry.ts  simplified driving lines in the game's X/Z coordinates
 *
 * Sources (all permissive; the app NEVER downloads anything at run time, this script only exists
 * to refresh the committed files):
 *   - ddm999/gt7info (MIT-0)                       _data/db/{course,country}.csv  -> numeric course id,
 *                                                  length, corners, elevation, longest straight, oval
 *   - jbhoorasingh/gt7-datalogger-track-data (CC0) index.json (122 official layouts, hex ids, SUGO)
 *                                                  signatures.json (driving lines every 20 m)
 *   - zetetos/gt-telemetry (MIT)                   pkg/circuits/inventory/*.json (lines on a 16 m grid,
 *                                                  start line; used where signatures.json has no path)
 *   - DG EDGE sitemap (only URLs, to LINK to its track pages; no content is copied)
 *
 *   node packages/shared/scripts/gen-tracks.mjs                 # downloads from GitHub (pinned commits)
 *   node packages/shared/scripts/gen-tracks.mjs --from <dir>    # local folder: course.csv country.csv
 *                                                                 index.json signatures.json
 *                                                                 inventory/*.json [dg-tracks.xml]
 *
 * After running: `biome format --write packages/shared/src/tracks` and the tests.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GT7INFO = { repo: 'ddm999/gt7info', ref: '2648c847f1021be69b67430e65e2246098383e66' };
const DATALOGGER = {
  repo: 'jbhoorasingh/gt7-datalogger-track-data',
  ref: '637aaa379e7b225e53034b9864b6f04f8bf2724e',
};
const GTTELEMETRY = {
  repo: 'zetetos/gt-telemetry',
  ref: '96007fc0a1f25ab4bcefe7007e4dca81166667a1',
};
const DGEDGE_SITEMAP = 'https://www.dg-edge.com/sitemaps/tracks.xml';

/** Layouts that gt7info has no row for (game 1.72, 2026-10-15). Each field cites its source. */
const MANUAL_COURSE_IDS = {
  // DG EDGE page of SUGO uses the image "Track1340.webp"; gt7info has no row yet.
  '4bf61b': { courseId: 1340, source: 'dg-edge image name Track1340' },
};
/** Longest straight (m) for layouts gt7info has no row for. One figure per layout, with its source. */
const MANUAL_STRAIGHT_M = {
  // Official GT7 track list (gran-turismo.com, game 1.72), read by hand by the project owner on
  // 2026-11-12: a single published figure, not a copy of the list.
  '4bf61b': { straightM: 704.5, source: 'official GT7 track list, read by hand' },
};
/** gt7info course ids that its author marked as dummies ("a dummy course id" in commit bbc5424). */
const DUMMY_COURSE_IDS = new Set([2001, 2002, 2003, 2004]);

/** gt-telemetry circuit name -> official layout name, where the plain normalisation fails. */
const GT_ALIAS = {
  '24HeuresDuMansRaceTrack': '24 Heures du Mans Racing Circuit',
  '24HeuresDuMansRaceTrackNoChicane': '24 Heures du Mans Racing Circuit No Chicane',
  AutodromeLagoMaggioreCenter: 'Autodrome Lago Maggiore - Centre',
  CircuitDeSaintCroixA: 'Circuit de Sainte-Croix - A',
  CircuitDeSaintCroixB: 'Circuit de Sainte-Croix - B',
  CircuitDeSaintCroixC: 'Circuit de Sainte-Croix - C',
  CircuitGilesVilleneuve: 'Circuit Gilles-Villeneuve',
  NürburgringNordeschleife: 'Nürburgring Nordschleife',
  WatkinsGlenInternational: 'Watkins Glen Short Course',
};

/** Venue names that index.json fuses with a layout. */
const VENUE_FIX = { 'Grand Valley - Highway 1': 'Grand Valley' };

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const fromDir = opt('--from');

const raw = (r, path) => `https://raw.githubusercontent.com/${r.repo}/${r.ref}/${path}`;
async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}
async function load(local, url) {
  return fromDir ? readFileSync(join(fromDir, local), 'utf8') : fetchText(url);
}

// ---------------------------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------------------------

const courseCsv = await load('course.csv', raw(GT7INFO, '_data/db/course.csv'));
const countryCsv = await load('country.csv', raw(GT7INFO, '_data/db/country.csv'));
const index = JSON.parse(await load('index.json', raw(DATALOGGER, 'index.json')));
const signatures = JSON.parse(await load('signatures.json', raw(DATALOGGER, 'signatures.json')));

async function loadInventory() {
  if (fromDir) {
    const dir = join(fromDir, 'inventory');
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(dir, f), 'utf8'))]);
  }
  const api = `https://api.github.com/repos/${GTTELEMETRY.repo}/contents/pkg/circuits/inventory?ref=${GTTELEMETRY.ref}`;
  const list = JSON.parse(await fetchText(api));
  const out = [];
  for (const f of list) {
    if (!f.name.endsWith('.json')) continue;
    out.push([f.name.replace(/\.json$/, ''), JSON.parse(await fetchText(f.download_url))]);
  }
  return out;
}
const inventory = await loadInventory();

let dgXml = '';
try {
  dgXml = fromDir
    ? readFileSync(join(fromDir, 'dg-tracks.xml'), 'utf8')
    : await fetchText(DGEDGE_SITEMAP);
} catch {
  console.warn('DG EDGE sitemap unavailable: no per-track links will be generated');
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const rows = (text) =>
  text
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .slice(1)
    .map((l) => l.split(','));

const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(reverse\)/g, ' reverse ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const slug = (s) => norm(s).replace(/ /g, '-');
/** Single-quoted TS string literal. */
const q = (s) => `'${String(s).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

const countryCode = new Map(rows(countryCsv).map(([id, , code]) => [Number(id), code]));
const csvRows = rows(courseCsv).map((r) => ({
  id: Number(r[0]),
  name: r[1],
  country: countryCode.get(Number(r[3])) ?? 'pdi',
  category: r[4],
  length: Math.round(Number(r[5])),
  straight: Math.round(Number(r[6])),
  elevation: Number(r[7]),
  reverse: r[16] === '1',
  oval: r[18] === '1',
  corners: Number(r[19]),
}));

// ---------------------------------------------------------------------------------------------
// Catalogue: index.json is the list of record (122 official layouts incl. SUGO); course.csv adds
// the numeric id and the numbers. Names are matched, with the length as a cross-check.
// ---------------------------------------------------------------------------------------------

const csvByName = new Map();
for (const r of csvRows) csvByName.set(norm(r.name), r);
const CSV_NAME_FIX = {
  // official name -> gt7info name (only where the two differ)
  'Circuit de Barcelona-Catalunya GP Layout': 'Circuit de Barcelona-Catalunya Grand Prix Layout',
  'Circuit de Barcelona-Catalunya National Layout': 'Circuit de Barcelona-Catalunya National',
  'Circuit de Barcelona-Catalunya Rallycross Layout': 'Circuit de Barcelona-Catalunya Rallycross',
  'Nürburgring Endurance II': 'Nurburgring Endurance',
  'Nürburgring Nordschleife Tourist': 'Nurburgring Nordschleife Tourist Layout',
};

const warnings = [];
const used = new Map();
const layouts = [];
for (const c of index.configurations) {
  const csv =
    csvByName.get(norm(CSV_NAME_FIX[c.official_name] ?? c.official_name)) ??
    csvByName.get(norm(c.official_name));
  if (csv && Math.abs(csv.length - c.length_m) > 0.005 * c.length_m) {
    warnings.push(`${c.official_name}: length csv ${csv.length} vs index ${c.length_m}`);
  }
  if (csv && csv.corners !== c.turns) {
    warnings.push(`${c.official_name}: corners csv ${csv.corners} vs index ${c.turns}`);
  }
  if (csv) used.set(csv.id, (used.get(csv.id) ?? 0) + 1);
  const manual = MANUAL_COURSE_IDS[c.official_id];
  let courseId = csv?.id ?? manual?.courseId ?? null;
  // two official layouts sharing one gt7info row (Nürburgring Endurance / Endurance II)
  if (csv && used.get(csv.id) > 1) {
    courseId = null;
    warnings.push(`${c.official_name}: gt7info row ${csv.id} is shared; courseId left null`);
  }
  const kind = c.type ?? (csv?.category === 'original' ? 'original' : 'real');
  let flags = 0;
  if (csv?.oval) flags |= 1;
  if (c.reverse) flags |= 2;
  if (kind === 'original') flags |= 4;
  if (courseId !== null && DUMMY_COURSE_IDS.has(courseId)) flags |= 8;
  if (courseId !== null && manual) flags |= 16;
  layouts.push({
    id: c.official_id,
    courseId,
    venue: VENUE_FIX[c.track] ?? c.track,
    layout: c.layout,
    officialName: c.official_name,
    country: csv?.country ?? 'jp',
    lengthM: c.length_m,
    turns: c.turns,
    elevationM: csv ? csv.elevation : c.elevation_m,
    straightM: csv ? csv.straight : (MANUAL_STRAIGHT_M[c.official_id]?.straightM ?? null),
    flags,
    sig: signatures.signatures.find((s) => s.official_id === c.official_id) ?? null,
  });
}
const byId = new Map(layouts.map((l) => [l.id, l]));
if (layouts.length !== 122) throw new Error(`expected 122 layouts, got ${layouts.length}`);
if (new Set(layouts.map((l) => l.id)).size !== layouts.length) throw new Error('duplicate ids');
// csv rows without an official layout (gt7info lists two extra "Route X" speed-test variants)
const unusedCsv = csvRows.filter((r) => !used.has(r.id)).map((r) => `${r.id} ${r.name}`);

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

/** Douglas-Peucker on an open polyline, keeping index 0 and n-1. */
function dp(pts, tol) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b <= a + 1) continue;
    const [ax, az] = pts[a];
    const [bx, bz] = pts[b];
    const dx = bx - ax;
    const dz = bz - az;
    const L = Math.hypot(dx, dz) || 1e-9;
    let best = -1;
    let bestD = 0;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / L;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (bestD > tol) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Closed-loop simplification: split at the point farthest from the first one. */
function simplifyClosed(pts, tol) {
  let far = 0;
  let fd = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const a = dp(pts.slice(0, far + 1), tol);
  const b = dp([...pts.slice(far), pts[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const l = out.at(-1);
    if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.5) out.push(p);
  }
  if (out.length > 2 && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) < 1) {
    out.pop();
  }
  return out;
}

function ringLength(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return s;
}

/** Smallest tolerance (1.5 .. 12 m) that leaves at most `max` points. */
function simplifyTo(pts, max = 200) {
  for (let tol = 1.5; tol <= 12; tol += 0.5) {
    const s = simplifyClosed(pts, tol);
    if (s.length <= max) return { pts: s, tol };
  }
  return { pts: simplifyClosed(pts, 12), tol: 12 };
}

/** Flat integer array: x0, z0, then deltas. */
function pack(pts) {
  const out = [];
  let px = 0;
  let pz = 0;
  for (const [x, z] of pts) {
    const ix = Math.round(x);
    const iz = Math.round(z);
    out.push(ix - px, iz - pz);
    px = ix;
    pz = iz;
  }
  return out;
}

const gtByOfficial = new Map();
const gtUnmapped = [];
for (const [file, j] of inventory) {
  const wanted = GT_ALIAS[file] ?? j.variation ?? j.name;
  const hit = index.configurations.find(
    (c) =>
      !c.reverse &&
      (norm(c.official_name) === norm(wanted) || norm(c.official_name) === norm(j.variation)),
  );
  if (!hit) {
    gtUnmapped.push(`${file} (${j.variation})`);
    continue;
  }
  gtByOfficial.set(hit.official_id, j);
}

/** geometry: id -> { src: 0 survey | 1 capture | 2 grid, flagged, partial, pts } (forward layouts). */
const geometry = new Map();
const startOf = new Map();
for (const l of layouts) {
  if (l.flags & 2) continue; // reverse layouts reuse the forward geometry
  const sig = l.sig;
  const gt = gtByOfficial.get(l.id);
  let pts = null;
  let src = null;
  let measured = null;
  let flagged = 0;
  if (sig && Array.isArray(sig.path) && sig.path.length > 8) {
    pts = sig.path.map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.z]));
    src = sig.provenance === 'survey' ? 0 : 1;
    measured = sig.length_m;
    flagged = sig.flags?.length ? 1 : 0;
  } else if (gt) {
    pts = gt.coordinates.map((c) => [c.x, c.z]);
    src = 2;
    measured = gt.length;
  }
  if (gt?.startLine) startOf.set(l.id, [gt.startLine.x, gt.startLine.z]);
  if (!pts) continue;
  pts = dedupe(pts);
  const ringLen = ringLength(pts);
  // A truncated capture closes the loop with a long chord: mark as partial
  const ratio = (measured ?? ringLen) / l.lengthM;
  const partial = ratio < 0.93 ? 1 : 0;
  if (!startOf.has(l.id)) startOf.set(l.id, [pts[0][0], pts[0][1]]);
  const s = simplifyTo(pts);
  geometry.set(l.id, { src, flagged, partial, pts: s.pts, tol: s.tol, ringLen, ratio });
}
// Layouts whose own signature has no path but a gt-telemetry polyline was ignored above are
// handled by the else-branch. Reverse twins:
for (const s of signatures.signatures) {
  if (!s.reverse) continue;
  const rev = byId.get(s.reverse.official_id);
  if (rev) rev.reverseOf = s.official_id;
}
for (const l of layouts) {
  if ((l.flags & 2) !== 0 && !l.reverseOf)
    warnings.push(`${l.officialName}: reverse without forward twin`);
}

// ---------------------------------------------------------------------------------------------
// DG EDGE links (URLs only)
// ---------------------------------------------------------------------------------------------

const dgPaths = [
  ...dgXml.matchAll(/<loc>https:\/\/www\.dg-edge\.com\/(database\/tracks\/[^<\s]+)<\/loc>/g),
].map((m) => m[1]);
const dgByVenue = {};
for (const l of layouts) {
  if (dgByVenue[l.venue]) continue;
  const cands = [slug(l.venue), slug(l.officialName)];
  if (norm(l.venue).includes('sugo')) cands.push('sugo-international-racing-course');
  for (const c of cands) {
    const hit = dgPaths.find(
      (p) =>
        p.replace('database/tracks/', '').startsWith(`${c}/`) ||
        p.replace('database/tracks/', '').startsWith(`${c}-`),
    );
    if (hit) {
      dgByVenue[l.venue] = hit;
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------------------------

const today = new Date().toISOString().slice(0, 10);
const target = (name) => fileURLToPath(new URL(`../src/tracks/${name}`, import.meta.url));
mkdirSync(fileURLToPath(new URL('../src/tracks/', import.meta.url)), { recursive: true });

const header = (
  extra,
) => `// GENERATED by packages/shared/scripts/gen-tracks.mjs. Do not edit by hand.
// ${extra}
`;

const sources = `export const TRACKS_SOURCES = [
  {
    name: 'gt7info',
    repo: ${q(`https://github.com/${GT7INFO.repo}`)},
    ref: ${q(GT7INFO.ref)},
    license: 'MIT-0',
    files: '_data/db/course.csv, _data/db/country.csv',
    collectedAt: ${q(today)},
  },
  {
    name: 'gt7-datalogger-track-data',
    repo: ${q(`https://github.com/${DATALOGGER.repo}`)},
    ref: ${q(DATALOGGER.ref)},
    license: 'CC0-1.0',
    files: 'index.json, signatures.json',
    collectedAt: ${q(today)},
  },
  {
    name: 'gt-telemetry',
    repo: ${q(`https://github.com/${GTTELEMETRY.repo}`)},
    ref: ${q(GTTELEMETRY.ref)},
    license: 'MIT',
    files: 'pkg/circuits/inventory/*.json',
    collectedAt: ${q(today)},
  },
] as const;
`;

const layoutsOut = layouts
  .sort(
    (a, b) => a.venue.localeCompare(b.venue) || a.lengthM - b.lengthM || a.id.localeCompare(b.id),
  )
  .map((l) => {
    const st = startOf.get(l.id) ?? (l.reverseOf ? startOf.get(l.reverseOf) : undefined);
    return `  [${q(l.id)}, ${l.courseId}, ${q(l.venue)}, ${q(l.layout)}, ${q(l.officialName)}, ${q(l.country)}, ${l.lengthM}, ${l.turns}, ${l.elevationM}, ${l.straightM}, ${l.flags}, ${
      st ? `${Math.round(st[0])}, ${Math.round(st[1])}` : 'null, null'
    }, ${l.reverseOf ? q(l.reverseOf) : 'null'}],`;
  })
  .join('\n');

writeFileSync(
  target('data.ts'),
  `${header(
    'Facts only (ids, official names, lengths, corner counts, elevation, longest straight, country, flags).',
  )}
/** Where the data came from (shown in the README, DECISIONS.md and tests). */
${sources}
/**
 * Official layout rows:
 * [id (official hex id), courseId (gt7info numeric id) | null, venue, layout, officialName,
 *  country code, lengthM, turns, elevationM, longestStraightM | null, flags, startX | null,
 *  startZ | null, reverseOf (id of the forward layout) | null].
 * flags: 1 oval, 2 reverse, 4 fictional, 8 courseId is a dummy in gt7info, 16 courseId from DG EDGE.
 */
// biome-ignore format: generated table, one row per line
export const TRACK_LAYOUTS_DATA: readonly (readonly [
  string,
  number | null,
  string,
  string,
  string,
  string,
  number,
  number,
  number,
  number | null,
  number,
  number | null,
  number | null,
  string | null,
])[] = [
${layoutsOut}
];

/** DG EDGE track pages (https://www.dg-edge.com/<path>) per venue: links only. */
export const DGEDGE_PATHS: Readonly<Record<string, string>> = ${JSON.stringify(dgByVenue, null, 2).replace(/"/g, "'")};
`,
);

const geomOut = [...geometry.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(
    ([id, g]) => `  [${q(id)}, ${g.src}, ${g.flagged}, ${g.partial}, [${pack(g.pts).join(',')}]],`,
  )
  .join('\n');

writeFileSync(
  target('geometry.ts'),
  `${header(
    'Simplified driving lines (closed loops, metres, GT7 world X/Z), Douglas-Peucker, integer deltas.',
  )}// Sources: gt7-datalogger-track-data signatures.json (CC0-1.0) and gt-telemetry inventory (MIT).

/**
 * [layout id, source (0 survey, 1 capture, 2 gt-telemetry 16 m grid), flagged (the source itself
 * flags a length disagreement), partial (measured/official length < 0.93: truncated capture),
 * packed points]. Packed = x0, z0, then (dx, dz) pairs, integer metres. Reverse layouts have no row:
 * they reuse the forward line walked backwards (\`reverseOf\` in data.ts).
 */
// biome-ignore format: generated table, one row per line
export const TRACK_GEOMETRY_DATA: readonly (readonly [string, number, number, number, readonly number[]])[] = [
${geomOut}
];
`,
);

const withGeom = layouts.filter(
  (l) => geometry.has(l.id) || (l.reverseOf && geometry.has(l.reverseOf)),
);
console.log(
  `${layouts.length} layouts, ${withGeom.length} with geometry (${geometry.size} lines + reverse twins)`,
);
const pointCounts = [...geometry.values()].map((g) => g.pts.length).sort((a, b) => a - b);
console.log(
  `points per line: min ${pointCounts[0]} median ${pointCounts[pointCounts.length >> 1]} max ${pointCounts.at(-1)}`,
);
console.log(
  `geometry by source: survey ${[...geometry.values()].filter((g) => g.src === 0).length}, capture ${[...geometry.values()].filter((g) => g.src === 1).length}, grid ${[...geometry.values()].filter((g) => g.src === 2).length}`,
);
console.log(
  `without geometry: ${layouts
    .filter((l) => !withGeom.includes(l))
    .map((l) => l.officialName)
    .join(' | ')}`,
);
console.log(
  `partial: ${[...geometry.entries()]
    .filter(([, g]) => g.partial)
    .map(([id]) => byId.get(id).officialName)
    .join(' | ')}`,
);
console.log(`gt-telemetry circuits not mapped: ${gtUnmapped.join(' | ') || 'none'}`);
console.log(`gt7info rows without official layout: ${unusedCsv.join(' | ') || 'none'}`);
console.log(
  `DG EDGE links: ${Object.keys(dgByVenue).length} of ${new Set(layouts.map((l) => l.venue)).size} venues`,
);
for (const w of warnings) console.warn(`warning: ${w}`);
