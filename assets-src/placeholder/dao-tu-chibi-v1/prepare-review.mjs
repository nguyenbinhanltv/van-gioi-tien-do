/* global process, console */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { reviewHtml } from '@vgtd/sprite';

const [reportPath, capturePath, artifactPath] = process.argv.slice(2);
if (!reportPath || !capturePath || !artifactPath)
  throw new Error('Usage: prepare-review.mjs <batch-report.json> <completed-capture-dir> <artifact-dir>');
const report = JSON.parse(readFileSync(resolve(reportPath), 'utf8'));
const captureDir = resolve(capturePath);
const capture = JSON.parse(readFileSync(join(captureDir, 'index.json'), 'utf8'));
if (
  !report.ok ||
  capture.direction !== 'E' ||
  capture.mode !== 'single' ||
  capture.frames !== 24 ||
  Object.keys(capture.animations).length !== 15
)
  throw new Error('Review needs a passing source batch and the complete 24-sample E capture.');
const out = resolve(artifactPath);
mkdirSync(out, { recursive: true });
const backlog = JSON.parse(readFileSync('assets-src/placeholder/dao-tu-chibi-v1/E/quality-backlog.json', 'utf8'));
for (const dir of report.dirs) {
  dir.manual = backlog.manual.filter((entry) => entry.dir === dir.dir);
  const folder = `${report.character}/${dir.dir}`;
  mkdirSync(join(out, folder), { recursive: true });
  const contractName = `${dir.stem}_${dir.dir}.sprite.json`;
  copyFileSync(join(dirname(resolve(reportPath)), dir.folder, contractName), join(out, folder, contractName));
  dir.folder = folder;
  for (const clip of dir.clips) {
    const animation = capture.animations[clip.name];
    if (!animation || !animation.gif || !existsSync(join(captureDir, animation.gif)))
      throw new Error('Missing captured clip ' + clip.name);
    const gif = `${folder}/${clip.name}.gif`;
    copyFileSync(join(captureDir, animation.gif), join(out, gif));
    copyFileSync(join(captureDir, animation.sheet), join(out, folder, `${clip.name}.sheet.png`));
    clip.gif = gif;
  }
}
const links = report.dirs
  .flatMap((dir) =>
    dir.clips.map((clip) => `<a href="${dir.folder}/${clip.name}.sheet.png">${clip.name} · 24 samples</a>`),
  )
  .join(' · ');
const notice = `<p>Full-source D41 compatibility motion. D45 extraction is scheduled after all five T1 directions merge; this is not a layered runtime delivery. Cocos Creator 3.8.8 capture: device scale 2×, 24 midpoint samples per clip. Official GIF overviews are downsampled by the capture tool; full-resolution contact sheets are linked below.</p><p><a href="master-review.html">Canonical masters and tiers</a> · <a href="capture-index.json">Capture metadata</a></p><details><summary>Full-resolution 2× contact sheets</summary><p>${links}</p></details>`;
const html = reviewHtml([report], 'Dao tu T1 E — full-source motion / Cocos 3.8.8 2×').replace(
  '</header>',
  notice + '</header>',
);
writeFileSync(join(out, 'motion-review.html'), html);
copyFileSync(join(captureDir, 'index.json'), join(out, 'capture-index.json'));
const masterPath = join(out, 'master-review.html');
if (existsSync(masterPath)) {
  let master = readFileSync(masterPath, 'utf8');
  master = master
    .replace('Checkpoint master · Chưa phải nghiệm thu motion', 'Master + E motion · Backlog art còn mở')
    .replace('<h2>Trạng thái cổng</h2>', '<h2>Cổng tại checkpoint master ban đầu</h2>');
  const marker = '<!-- DAO-E-MOTION -->';
  if (!master.includes(marker)) {
    const section = `${marker}<section><h2>E · 15 clip / 202 khung · Capture Cocos thật 2×</h2><p>Không lỗi cứng, 24 phát hiện trượt chân được ghi backlog, không hồi quy; 5 mục xem art còn mở. Bộ này là full-source D41, chưa tách body / weapon / FX.</p><p><a href="motion-review.html">Mở trang motion + toàn bộ bằng chứng đầu</a></p><iframe title="Dao tu E motion review" src="motion-review.html" style="width:100%;height:920px;border:1px solid #ccd6db;border-radius:8px"></iframe></section>`;
    master = master.replace('</main>', section + '</main>');
    writeFileSync(masterPath, master);
  }
}
console.log('Wrote consolidated master / E motion review with 15 real Cocos captures.');
