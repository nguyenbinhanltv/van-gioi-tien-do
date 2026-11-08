/* global process, console */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { reviewHtml } from '@vgtd/sprite';

const [reportPath, capturePath, artifactPath] = process.argv.slice(2);
if (!reportPath || !capturePath || !artifactPath)
  throw new Error('Usage: prepare-direction-review.mjs <batch-report.json> <capture-dir> <artifact-dir>');
const report = JSON.parse(readFileSync(resolve(reportPath), 'utf8'));
const captureDir = resolve(capturePath);
const capture = JSON.parse(readFileSync(join(captureDir, 'index.json'), 'utf8'));
const direction = capture.direction;
if (
  !report.ok ||
  !['SE', 'S', 'NE', 'N'].includes(direction) ||
  capture.mode !== 'single' ||
  capture.frames !== 24 ||
  Object.keys(capture.animations).length !== 15
)
  throw new Error('Review requires passing source QA and complete 24-sample direction capture.');
report.dirs = report.dirs.filter((dir) => dir.dir === direction);
if (report.dirs.length !== 1) throw new Error('Missing direction source report');
const out = resolve(artifactPath);
mkdirSync(out, { recursive: true });
const backlog = JSON.parse(
  readFileSync(`assets-src/placeholder/dao-tu-chibi-v1/${direction}/quality-backlog.json`, 'utf8'),
);
for (const dir of report.dirs) {
  dir.manual = backlog.manual.filter((entry) => entry.dir === dir.dir);
  const folder = `${report.character}/${dir.dir}`;
  mkdirSync(join(out, folder), { recursive: true });
  const contractName = `${dir.stem}_${dir.dir}.sprite.json`;
  copyFileSync(join(dirname(resolve(reportPath)), dir.folder, contractName), join(out, folder, contractName));
  dir.folder = folder;
  for (const clip of dir.clips) {
    const animation = capture.animations[clip.name];
    if (!animation?.gif || !existsSync(join(captureDir, animation.gif)))
      throw new Error('Missing captured clip ' + clip.name);
    clip.gif = `${folder}/${clip.name}.gif`;
    copyFileSync(join(captureDir, animation.gif), join(out, clip.gif));
    copyFileSync(join(captureDir, animation.sheet), join(out, folder, `${clip.name}.sheet.png`));
  }
}
const reviewName = `motion-review-${direction}.html`;
const indexName = `capture-index-${direction}.json`;
const links = report.dirs
  .flatMap((dir) =>
    dir.clips.map((clip) => `<a href="${dir.folder}/${clip.name}.sheet.png">${clip.name}: 24 samples</a>`),
  )
  .join(' / ');
const notice = `<p>Full-source D41 compatibility motion. D45 extraction follows all five merged T1 directions. Cocos Creator 3.8.8: device scale 2x, 24 midpoint samples per clip. GIF overviews are downsampled by the official tool; linked contact sheets retain full resolution.</p><p><a href="master-review.html">Canonical masters and tiers</a> / <a href="${indexName}">Capture metadata</a></p><details><summary>Full-resolution 2x contact sheets</summary><p>${links}</p></details>`;
writeFileSync(
  join(out, reviewName),
  reviewHtml([report], `Dao tu T1 ${direction}: full-source / Cocos 3.8.8 2x`).replace(
    '</header>',
    notice + '</header>',
  ),
);
copyFileSync(join(captureDir, 'index.json'), join(out, indexName));
const masterPath = join(out, 'master-review.html');
if (existsSync(masterPath)) {
  let master = readFileSync(masterPath, 'utf8');
  const marker = `<!-- DAO-${direction}-MOTION -->`,
    endMarker = `<!-- /DAO-${direction}-MOTION -->`;
  const section = `${marker}<section><h2>${direction}: 15 clips / 202 frames / real Cocos 2x</h2><p>Source hard gates passed. ${backlog.entries.length} recorded soft findings; ${backlog.manual.length} manual art findings remain open. Full-source D41 compatibility; body / weapon / FX extraction follows later.</p><p><a href="${reviewName}">Open motion and head evidence</a></p><iframe title="Dao tu ${direction} motion review" src="${reviewName}" style="width:100%;height:920px;border:1px solid #ccd6db;border-radius:8px"></iframe></section>${endMarker}`;
  if (master.includes(marker) && master.includes(endMarker)) {
    const start = master.indexOf(marker),
      end = master.indexOf(endMarker) + endMarker.length;
    master = master.slice(0, start) + section + master.slice(end);
  } else if (!master.includes(marker)) master = master.replace('</main>', section + '</main>');
  writeFileSync(masterPath, master);
}
console.log(`Wrote ${direction} review with 15 real Cocos captures.`);
