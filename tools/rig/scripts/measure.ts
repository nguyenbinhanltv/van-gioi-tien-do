/**
 * `npm run rig:measure -w @vgtd/rig -- <character> [options]`
 *
 * Prints the rig quality table for a committed character: per direction, how many clips open a seam (gap > limit),
 * the worst gap, mesh stretch, torn silhouettes (islands), vertex count; then the pieces that need underpaint and by
 * how many px. Runs the same checks as the artifacts/CI (`meshQa`, `checkSilhouette`, `underpaintNeeds`), so the art
 * worker and reviewers can see the numbers without Cocos.
 *
 *   <character>        kiem-tu | the-tu | phap-tu | dan-phu-tu  (default kiem-tu)
 *   --dir S,E          only these directions (default: all drawn directions)
 *   --autoskin         measure as if autoSkin were applied (preview; data files are not touched)
 *   --band PX --cell PX --touch PX   autoSkin parameters for --autoskin (defaults 10 / 6 / 2)
 *   --band PX --cell PX --touch PX   autoSkin parameters for --autoskin (defaults 10 / 6 / 2)
 *   --top N            underpaint rows per direction (default 8)
 *   --limit PX         seam limit (default 3)
 *   --json             machine-readable output
 *   --strict           exit code 1 if any seam gap > limit, any torn silhouette or any stretch event remains
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  CHARACTER_IDS,
  autoSkin,
  authorClassSet,
  checkSilhouette,
  decodePng,
  loadCharacterData,
  loadedAtlas,
  meshQa,
  underpaintNeeds,
  type CharacterId,
} from '../src/index.js';

// run-ts.mjs sets argv[1] to this script's real path (the bundle itself lives in a temp dir)
const repoRoot = resolve(dirname(process.argv[1]!), '../../..');

function parse(argv: string[]) {
  const o = {
    character: 'kiem-tu' as CharacterId,
    dirs: null as string[] | null,
    autoskin: false,
    band: undefined as number | undefined,
    cell: undefined as number | undefined,
    touch: undefined as number | undefined,
    top: 8,
    limit: 3,
    json: false,
    strict: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dir') o.dirs = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (a === '--autoskin') o.autoskin = true;
    else if (a === '--band') o.band = Number(argv[++i]);
    else if (a === '--cell') o.cell = Number(argv[++i]);
    else if (a === '--touch') o.touch = Number(argv[++i]);
    else if (a === '--top') o.top = Number(argv[++i]);
    else if (a === '--limit') o.limit = Number(argv[++i]);
    else if (a === '--json') o.json = true;
    else if (a === '--strict') o.strict = true;
    else if ((CHARACTER_IDS as readonly string[]).includes(a)) o.character = a as CharacterId;
    else throw new Error(`unknown argument '${a}' (characters: ${CHARACTER_IDS.join(', ')})`);
  }
  return o;
}

interface Row {
  readonly direction: string;
  readonly clips: number;
  readonly seamOpenings: number;
  readonly worstGapPx: number;
  readonly stretchEvents: number;
  readonly worstStrainPct: number;
  readonly tornClips: number;
  readonly vertices: number;
}

const opts = parse(process.argv.slice(2));
const data = loadCharacterData(repoRoot, opts.character);
const rows: Row[] = [];
const needs: Record<string, ReturnType<typeof underpaintNeeds>> = {};

for (const [dir, d] of data.byDirection) {
  if (opts.dirs && !opts.dirs.includes(dir)) continue;
  const rig = opts.autoskin
    ? autoSkin(d.rig, {
        ...(opts.band !== undefined ? { band: opts.band } : {}),
        ...(opts.cell !== undefined ? { cell: opts.cell } : {}),
        ...(opts.touch !== undefined ? { touchPx: opts.touch } : {}),
      }).rig
    : d.rig;
  const clips = authorClassSet(opts.character, rig);
  const png = readFileSync(d.texturePath);
  if (png.subarray(1, 4).toString('ascii') !== 'PNG')
    throw new Error(`${d.texturePath} is a Git LFS pointer: run 'git lfs pull'`);
  const atlas = loadedAtlas(d.atlas, decodePng(png, { premultiplied: d.atlas.premultipliedAlpha }));
  let openings = 0;
  let worstGap = 0;
  let strain = 0;
  let worstStrain = 0;
  let torn = 0;
  for (const clip of clips) {
    for (const i of meshQa(rig, clip, { gapPx: opts.limit })) {
      if (i.check === 'detach' && /come apart/.test(i.message)) {
        openings++;
        worstGap = Math.max(worstGap, i.value ?? 0);
      } else if (i.check === 'mesh-strain') {
        strain++;
        worstStrain = Math.max(worstStrain, i.value ?? 0);
      }
    }
    if (checkSilhouette(rig, clip, atlas, { minPixels: 20 }).length) torn++;
  }
  const vertices = Math.max(
    0,
    ...rig.skins.map((s) =>
      Object.values(s.attachments).reduce(
        (n, m) => n + Object.values(m).reduce((k, a) => k + (a.type === 'mesh' ? a.vertices.length / 2 : 0), 0),
        0,
      ),
    ),
  );
  rows.push({
    direction: dir,
    clips: clips.length,
    seamOpenings: openings,
    worstGapPx: Math.round(worstGap * 10) / 10,
    stretchEvents: strain,
    worstStrainPct: Math.round(worstStrain * 100),
    tornClips: torn,
    vertices,
  });
  needs[dir] = underpaintNeeds(rig, clips, { gapPx: opts.limit }).slice(0, opts.top);
}

const dirty = rows.some((r) => r.seamOpenings || r.tornClips || r.stretchEvents);
if (opts.json) {
  console.log(
    JSON.stringify(
      { character: opts.character, autoskin: opts.autoskin, limitPx: opts.limit, rows, underpaint: needs },
      null,
      2,
    ),
  );
} else {
  const pad = (v: string | number, n: number) => String(v).padStart(n);
  console.log(
    `${opts.character}${opts.autoskin ? ' (autoSkin preview)' : ''}: seam limit ${opts.limit} px, ${rows[0]?.clips ?? 0} clips per direction\n`,
  );
  console.log('dir | clips | seam openings | worst gap px | stretch events | worst strain % | torn clips | vertices');
  console.log('----|-------|---------------|--------------|----------------|----------------|------------|---------');
  for (const r of rows) {
    console.log(
      `${r.direction.padEnd(3)} | ${pad(r.clips, 5)} | ${pad(r.seamOpenings, 13)} | ${pad(r.worstGapPx, 12)} | ${pad(r.stretchEvents, 14)} | ${pad(r.worstStrainPct, 14)} | ${pad(r.tornClips, 10)} | ${pad(r.vertices, 8)}`,
    );
  }
  for (const [dir, list] of Object.entries(needs)) {
    if (!list.length) continue;
    console.log(`\n${dir}: underpaint needed (px @1x, atlas px = 2x)`);
    for (const n of list) {
      const [a, b] = n.pieces;
      console.log(
        `  ${String(n.extendPx).padStart(3)} px  ${a.id} (${a.bone}) / ${b.id} (${b.bone})  worst ${n.clip}@${n.frame}, ${n.clips} clips`,
      );
    }
  }
  console.log(dirty ? '\nresult: NOT clean' : '\nresult: clean');
}
if (opts.strict && dirty) process.exit(1);
