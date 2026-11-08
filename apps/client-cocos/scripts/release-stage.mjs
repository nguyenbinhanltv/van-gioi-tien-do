// Release builds without the dev-only art (D71 follow-up).
//
// `assets/resources/dragonbones/**` (~229 MB: the animation-viewer rigs and the source exports the chibi bundles are derived
// from) lives in the always-present `resources` bundle, so every Cocos build ships it even though no player ever fetches it.
// A release build therefore runs on a STAGED copy of the project that leaves that folder out. Everything else is copied
// byte for byte, metas included (same uuids), and the copy is incremental (size + mtime) so the stage's Library cache stays
// valid between builds. The source project is never modified.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Project-relative paths (posix style) that never go into a release build. */
export const DEV_ONLY = ['assets/resources/dragonbones', 'assets/resources/dragonbones.meta'];
/** Top level entries of the project that make up the stage. Library, temp, build and local caches are not copied. */
export const STAGE_ENTRIES = ['assets', 'settings', 'package.json', 'tsconfig.json'];

const posix = (p) => p.split(sep).join('/');
const excluded = (rel) => DEV_ONLY.some((d) => rel === d || rel.startsWith(`${d}/`));

/** Pure: which project-relative files belong in the stage, given a flat list of project-relative file paths. */
export function stagedFiles(relFiles) {
  return relFiles.filter((f) => STAGE_ENTRIES.some((e) => f === e || f.startsWith(`${e}/`)) && !excluded(f));
}

function listFiles(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const f = join(dir, name);
    if (statSync(f).isDirectory()) listFiles(f, base, out);
    else out.push(posix(relative(base, f)));
  }
  return out;
}

/**
 * Mirrors the project into `stageDir` without the dev-only art. Returns { copied, removed, kept, skippedBytes }.
 * `skippedBytes` is the size of what was left out (reported by the build as the release saving).
 */
export function stageReleaseProject(root, stageDir) {
  const all = [];
  for (const e of STAGE_ENTRIES) {
    const p = join(root, e);
    if (!existsSync(p)) continue;
    if (statSync(p).isDirectory()) for (const f of listFiles(p, root)) all.push(f);
    else all.push(e);
  }
  const keep = new Set(stagedFiles(all));
  let copied = 0;
  let skippedBytes = 0;
  for (const f of all) {
    if (!keep.has(f)) {
      skippedBytes += statSync(join(root, f)).size;
      continue;
    }
    const src = join(root, f);
    const dst = join(stageDir, f);
    const s = statSync(src);
    if (existsSync(dst)) {
      const d = statSync(dst);
      if (d.size === s.size && Math.abs(d.mtimeMs - s.mtimeMs) < 2) continue;
    }
    mkdirSync(join(dst, '..'), { recursive: true });
    copyFileSync(src, dst);
    utimesSync(dst, s.atime, s.mtime);
    copied++;
  }
  // drop files that no longer exist in the source (or are now excluded)
  let removed = 0;
  if (existsSync(stageDir)) {
    for (const f of listFiles(stageDir)) {
      const top = f.split('/')[0];
      if (!STAGE_ENTRIES.includes(top)) continue; // library/, temp/, build/, profiles/ belong to the stage
      // metas the editor generated in the stage for kept assets stay (stable uuids between builds)
      if (f.endsWith('.meta') && keep.has(f.slice(0, -5))) continue;
      if (!keep.has(f)) {
        rmSync(join(stageDir, f), { force: true });
        removed++;
      }
    }
  }
  return { copied, removed, kept: keep.size, skippedBytes };
}
