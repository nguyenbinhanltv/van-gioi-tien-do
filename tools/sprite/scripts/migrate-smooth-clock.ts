/** D58: timing-only migration. Does not load, resample, pack or write any art. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createImage } from '@vgtd/rig';
import { buildArmature, packFrames, type Project } from '../src/index.js';

const args = process.argv.slice(2);
const apply = args.includes('--write');
const reportIndex = args.indexOf('--report');
if (reportIndex < 0 || !args[reportIndex + 1]) throw new Error('usage: [--write] --report <json>');
const root = resolve(process.env.INIT_CWD ?? process.cwd());
const reportPath = resolve(root, args[reportIndex + 1]!);
if (existsSync(reportPath) && JSON.parse(readFileSync(reportPath, 'utf8')).format !== 'vgtd-smooth-clock-migration')
  throw new Error('refusing to overwrite a non-migration report');
const baseIndex = args.indexOf('--base');
const baseline = args[baseIndex + 1] && baseIndex >= 0 ? args[baseIndex + 1]! : 'origin/main';
const baseSha = execFileSync('git', ['rev-parse', baseline], { cwd: root, encoding: 'utf8' }).trim();
const baseRead = (path: string) =>
  execFileSync('git', ['show', `${baseSha}:${path}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/);
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const read = (path: string) => readFileSync(resolve(root, path));
const contentHash = (bytes: Buffer) => {
  const pointer =
    /^version https:\/\/git-lfs.github.com\/spec\/v1\r?\noid sha256:([a-f0-9]{64})\r?\nsize \d+\r?\n?$/.exec(
      bytes.toString('utf8'),
    );
  return pointer?.[1] ?? hash(bytes);
};
const protectedFiles = files.filter(
  (p) => p.startsWith('apps/client-cocos/assets/resources/dragonbones/') && !p.endsWith('_ske.json'),
);
const before = new Map(protectedFiles.map((p) => [p, contentHash(baseRead(p))]));
type Frame = { duration: number; value: number };
type Animation = {
  name: string;
  duration: number;
  playTimes: number;
  slot: { displayFrame: Frame[] }[];
  frame?: unknown[];
};
type Skeleton = { frameRate: number; armature: { frameRate: number; animation: Animation[] }[] };
// Delete only the explicitly authorized timing fields, then require everything else to be identical.
function nonTiming(s: Skeleton): string {
  const copy = structuredClone(s);
  delete (copy as Partial<Skeleton>).frameRate;
  for (const a of copy.armature) {
    delete (a as Partial<typeof a>).frameRate;
    for (const c of a.animation) {
      delete (c as Partial<Animation>).duration;
      for (const slot of c.slot) for (const f of slot.displayFrame) delete (f as Partial<Frame>).duration;
      for (const f of (c.frame ?? []) as Record<string, unknown>[]) delete f.duration;
    }
  }
  return JSON.stringify(copy);
}
const directions: {
  project: string;
  skeleton: string;
  beforeSha256: string;
  afterSha256: string;
  nonTimingIdentical: boolean;
  clips: {
    name: string;
    drawings: number;
    ticksBefore: number;
    ticksAfter: number;
    secondsAfter: number;
    uniformHoldTicks: number;
    playTimes: number;
  }[];
}[] = [];
const plans: { path: string; bytes: string }[] = [];
for (const path of files.filter((p) => /^assets-src\/placeholder\/[^/]*chibi[^/]*\/[^/]+\/project.json$/.test(p))) {
  const projectBytes = baseRead(path);
  const project = JSON.parse(projectBytes.toString('utf8')) as Project;
  const currentProject = JSON.parse(read(path).toString('utf8')) as Project;
  const withoutProfile = ({ timingProfile: _profile, ...rest }: Project) => rest;
  if (JSON.stringify(withoutProfile(currentProject)) !== JSON.stringify(withoutProfile(project)))
    throw new Error(`working project has unrelated changes: ${path}`);
  const skePath = `apps/client-cocos/assets/resources/dragonbones/${project.character}/${project.stem}_${project.direction}_ske.json`;
  if (!files.includes(skePath)) throw new Error(`missing committed runtime ${skePath}`);
  const original = baseRead(skePath);
  const ske = JSON.parse(original.toString('utf8')) as Skeleton;
  if (ske.armature.length !== 1 || ![24, 30].includes(ske.frameRate)) throw new Error(`unexpected armature ${skePath}`);
  const armature = ske.armature[0]!;
  if (armature.animation.length !== project.clips.length) throw new Error('clip coverage mismatch');
  const clips = project.clips.map((c) => ({
    ...c,
    timingProfile: 'smooth-v2' as const,
    frames: Array.from({ length: c.frames }, (_, i) => `${c.name}_${i}`),
  }));
  // Minimal temporary geometry exercises the production exporter; only its timing fields are retained.
  const image = createImage(1, 1);
  image.data.fill(255);
  const pack = packFrames(
    clips.flatMap((c) => c.frames.map((name) => ({ name, image }))),
    () => 'unused.png',
  );
  const generated = buildArmature({
    id: project.character,
    direction: project.direction,
    name: project.stem,
    pack,
    clips,
  });
  const fresh = (generated.export.ske as unknown as Skeleton).armature[0]!;
  const oldNonTiming = nonTiming(ske);
  if (nonTiming(JSON.parse(read(skePath).toString('utf8')) as Skeleton) !== oldNonTiming)
    throw new Error(`working skeleton has unrelated changes: ${skePath}`);
  const clipReport = [];
  for (const c of project.clips) {
    const old = armature.animation.find((a) => a.name === c.name)!;
    const next = fresh.animation.find((a) => a.name === c.name)!;
    if (
      !old ||
      old.slot.length !== 1 ||
      old.slot[0]!.displayFrame.length !== c.frames ||
      old.playTimes !== next.playTimes
    )
      throw new Error(`drawing/loop mismatch ${skePath}:${c.name}`);
    const previousDuration = old.duration;
    old.duration = next.duration;
    old.slot[0]!.displayFrame.forEach((f) => {
      f.duration = 1;
    });
    if (next.frame) old.frame = next.frame;
    else if (old.frame) throw new Error('event removal is forbidden');
    clipReport.push({
      name: c.name,
      drawings: c.frames,
      ticksBefore: previousDuration,
      ticksAfter: old.duration,
      secondsAfter: old.duration / 24,
      uniformHoldTicks: 1,
      playTimes: old.playTimes,
    });
  }
  ske.frameRate = 24;
  armature.frameRate = 24;
  if (nonTiming(ske) !== oldNonTiming) throw new Error(`non-timing change forbidden: ${skePath}`);
  const output = JSON.stringify(ske);
  plans.push({ path: skePath, bytes: output });
  plans.push({ path, bytes: projectBytes.toString('utf8').replace('{', '{\n  "timingProfile": "smooth-v2",') });
  directions.push({
    project: path,
    skeleton: skePath,
    beforeSha256: hash(original),
    afterSha256: hash(output),
    nonTimingIdentical: true,
    clips: clipReport,
  });
}
if (!directions.length) throw new Error('no merged smooth directions found');
const protectedHashes = [...before].map(([path, sha256]) => {
  if (contentHash(read(path)) !== sha256) throw new Error(`protected runtime changed: ${path}`);
  return { path, beforeSha256: sha256, afterSha256: sha256 };
});
const legacySkeletons = files.filter(
  (p) =>
    p.startsWith('apps/client-cocos/assets/resources/dragonbones/') &&
    p.endsWith('_ske.json') &&
    !directions.some((d) => d.skeleton === p),
);
const report = {
  format: 'vgtd-smooth-clock-migration',
  baseSha,
  applied: apply,
  directions,
  protectedHashes,
  legacySkeletons: legacySkeletons.map((path) => {
    const sha256 = hash(baseRead(path));
    if (hash(read(path)) !== sha256) throw new Error(`legacy skeleton changed: ${path}`);
    return { path, sha256 };
  }),
  note: 'Timing-only D58 migration, not art/similarity approval. Legacy clock remains unchanged. No PNG/atlas regeneration.',
};
if (plans.some((p) => resolve(root, p.path) === reportPath)) throw new Error('report would overwrite an input');
if (apply) for (const p of plans) writeFileSync(resolve(root, p.path), p.bytes, 'utf8');
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(
  `${directions.length} directions; ${protectedHashes.length} non-skeleton runtime files unchanged; ${legacySkeletons.length} legacy skeletons untouched`,
);
