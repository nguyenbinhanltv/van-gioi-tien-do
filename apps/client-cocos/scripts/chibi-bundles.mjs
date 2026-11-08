// Generates the chibi runtime Asset Bundles (D71) into assets/chibi (git-ignored) from the exported DragonBones armatures
// in assets/resources/dragonbones/<class>-chibi-v1 (read only), plus assets/resources/world/chibi-index.json.
//   - derivative pixels: tools/procgen `pipeline/chibi_runtime.mts` (per-direction bundles, `full` + `1x` tiers, `loco` + `rest` groups)
//   - .meta files written here (deterministic uuids) so each bundle is a Cocos Asset Bundle and every page PNG carries the
//     texture-compress preset of its tier (presets live in settings/v2/packages/builder.json)
// Skipped when the stamp (inputs + tool sources) is unchanged. Used by prepare.mjs.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Texture-compress preset id per tier; the definitions are in settings/v2/packages/builder.json. */
export const PRESET = { full: 'vgtd-chibi-full', '1x': 'vgtd-chibi-1x' };

const uuidOf = (key) => {
  const h = createHash('sha1').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
const meta = (importer, ver, uuid, files, userData = {}, subMetas = {}) =>
  JSON.stringify({ ver, importer, imported: true, uuid, files, subMetas, userData }, null, 2) + '\n';

function walk(dir, out = []) {
  for (const n of readdirSync(dir).sort()) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
}

function stampOf(srcDir, repo) {
  const h = createHash('sha1');
  for (const f of walk(srcDir)) {
    if (!/-chibi-v1[\\/]/.test(f) || f.endsWith('.meta') || f.endsWith('.sprite.json')) continue;
    h.update(`${relative(srcDir, f)}:${statSync(f).size}\n`);
  }
  for (const f of [
    'tools/procgen/src/runtime/chibi.mts',
    'tools/procgen/pipeline/chibi_runtime.mts',
    'apps/client-cocos/scripts/chibi-bundles.mjs',
    'packages/shared/src/constants.ts',
  ])
    h.update(readFileSync(join(repo, f)));
  return h.digest('hex');
}

function pngMeta(bundle, tier, f) {
  const id = uuidOf(`${bundle}/${tier}/${f}`);
  return meta(
    'image',
    '1.0.27',
    id,
    ['.json', '.png'],
    {
      type: 'texture',
      fixAlphaTransparencyArtifacts: false,
      hasAlpha: true,
      redirect: `${id}@6c48a`,
      compressSettings: { useCompressTexture: true, presetId: PRESET[tier] },
    },
    {
      '6c48a': {
        importer: 'texture',
        uuid: `${id}@6c48a`,
        displayName: f.replace(/\.[^.]+$/, ''),
        id: '6c48a',
        name: 'texture',
        userData: {
          wrapModeS: 'clamp-to-edge',
          wrapModeT: 'clamp-to-edge',
          minfilter: 'linear',
          magfilter: 'linear',
          mipfilter: 'none',
          anisotropy: 0,
          isUuid: true,
          imageUuidOrDatabaseUri: id,
          visible: false,
        },
        ver: '1.0.22',
        imported: true,
        files: ['.json'],
        subMetas: {},
      },
    },
  );
}

/** @param {{ root: string, repo: string }} o */
export function prepareChibiBundles({ root, repo }) {
  const srcDir = join(root, 'assets/resources/dragonbones');
  const out = join(root, 'assets/chibi');
  const stampFile = join(out, '.stamp');
  const stamp = stampOf(srcDir, repo);
  const indexFile = join(root, 'assets/resources/world/chibi-index.json');
  if (existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp && existsSync(indexFile)) {
    console.log('chibi bundles up to date');
    return;
  }
  // clear the CONTENTS (assets/chibi may be a junction to another drive when the project drive is short on space)
  mkdirSync(out, { recursive: true });
  for (const n of readdirSync(out)) rmSync(join(out, n), { recursive: true, force: true });
  const procgen = join(repo, 'tools/procgen');
  const r = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'pipeline/chibi_runtime.mts', '--src', srcDir, '--out', out],
    {
      cwd: procgen,
      stdio: 'inherit',
    },
  );
  if (r.status !== 0) throw new Error('chibi_runtime generation failed');

  const manifest = JSON.parse(readFileSync(join(out, 'chibi-runtime.json'), 'utf8'));
  rmSync(join(out, 'chibi-runtime.json'));
  const classes = {};
  writeFileSync(join(root, 'assets/chibi.meta'), meta('directory', '1.2.0', uuidOf('chibi'), []));
  for (const bundle of Object.keys(manifest).sort()) {
    const m = /^chibi-(.+)-(e|se|s|ne|n)$/.exec(bundle);
    const classId = m[1];
    const dir = m[2].toUpperCase();
    const bdir = join(out, bundle);
    writeFileSync(
      join(out, `${bundle}.meta`),
      meta('directory', '1.2.0', uuidOf(bundle), [], {
        isBundle: true,
        bundleConfigID: 'default',
        bundleName: bundle,
        priority: 1,
      }),
    );
    const entry = (classes[classId] ??= { stem: '', directions: {} });
    const pages = {};
    for (const tier of ['full', '1x']) {
      const tdir = join(bdir, tier);
      writeFileSync(join(bdir, `${tier}.meta`), meta('directory', '1.2.0', uuidOf(`${bundle}/${tier}`), []));
      pages[tier] = JSON.parse(readFileSync(join(tdir, 'pages.json'), 'utf8'));
      rmSync(join(tdir, 'pages.json'));
      for (const f of readdirSync(tdir).sort()) {
        const id = uuidOf(`${bundle}/${tier}/${f}`);
        if (f.endsWith('.png')) {
          writeFileSync(join(tdir, `${f}.meta`), pngMeta(bundle, tier, f));
        } else if (f.endsWith('_ske.json')) {
          writeFileSync(join(tdir, `${f}.meta`), meta('dragonbones', '1.0.2', id, ['.json']));
          entry.stem = f.replace(/_(E|SE|S|NE|N)_ske\.json$/, '');
        } else if (f.endsWith('_tex.json')) {
          writeFileSync(join(tdir, `${f}.meta`), meta('dragonbones-atlas', '1.0.2', id, ['.json']));
        }
      }
    }
    entry.directions[dir] = { pages };
  }
  mkdirSync(join(root, 'assets/resources/world'), { recursive: true });
  writeFileSync(indexFile, JSON.stringify({ classes }, null, 1));
  writeFileSync(stampFile, stamp);
  console.log(`prepared ${Object.keys(manifest).length} chibi bundles -> assets/chibi`);
}
