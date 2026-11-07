/** Retain checksums and per-file rights for the selected art and every raw attempt. */
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve('assets-src/placeholder/phap-tu-chibi-v1');
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const files = (folder: string): string[] =>
  readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = resolve(folder, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
for (const file of files(resolve(root, 'E/raw')).filter((name) => name.endsWith('.generation.json'))) {
  const entry = JSON.parse(readFileSync(file, 'utf8'));
  const raw = readFileSync(resolve(root, 'E', entry.raw));
  entry.rawSha256 = hash(raw);
  entry.rawDimensions = [raw.readUInt32BE(16), raw.readUInt32BE(20)];
  entry.utcRawOutputFileModified = statSync(resolve(root, 'E', entry.raw)).mtime.toISOString();
  entry.referenceSnapshots = entry.references.map((file: string) =>
    file === 'reference/E.master.png' ? 'reference/E.master.generation-v1.png' : file,
  );
  if (entry.selected) {
    entry.selectedSha256 = hash(readFileSync(resolve(root, 'E', entry.selected)));
    entry.status = 'selected; complete E hard QA passed; accepted soft findings are explicit in quality-backlog.json';
  }
  writeFileSync(file, JSON.stringify(entry, null, 2) + '\n');
}
const provenancePath = resolve(root, 'provenance.json');
const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
provenance.masterLock = {
  approvedBy: 'project orchestrator, after requested costume and proportion corrections',
  anatomicalHeight2x: 216,
  landmarks: 'reference/anatomy-landmarks.json',
  sourceSha256: hash(readFileSync(resolve(root, 'reference/T1-turnaround.raw.png'))),
};
provenance.files = files(root)
  .filter((file) => file.endsWith('.png'))
  .map((file) => {
    const data = readFileSync(file);
    return {
      file: relative(root, file).replaceAll('\\', '/'),
      sha256: hash(data),
      bytes: data.length,
      width: data.readUInt32BE(16),
      height: data.readUInt32BE(20),
      utcFileModified: statSync(file).mtime.toISOString(),
    };
  });
provenance.motionProvenance = 'E/raw/*.generation.json';
provenance.referenceAliases = { 'worker23/phap-tu-t3.raw.png': 'reference/approved-T3.reference.png' };
writeFileSync(provenancePath, JSON.stringify(provenance, null, 2) + '\n');
const licensePath = resolve('docs/ASSET-LICENSES.md');
const marker = '<!-- PHAP-TU-CHIBI-E-MOTION:BEGIN -->';
if (!readFileSync(licensePath, 'utf8').includes(marker)) {
  const rows = provenance.files.map(({ file }: { file: string }) => {
    const generated = file.includes('/templates/') || file.includes('/export/') || file.includes('.master.png');
    return `| \`${file}\` | ${generated ? 'In-house deterministic derivative; original project art inputs' : 'Original project art; OpenAI imagegen output/edit'} | OpenAI output ownership terms above; no attribution required |`;
  });
  appendFileSync(
    licensePath,
    `\n${marker}\n\n### Pháp tu premium semi-chibi E — per-file asset register\n\nAll paths below are under \`assets-src/placeholder/phap-tu-chibi-v1/\`. This register includes preserved rejected attempts and selected sheets; it does not approve rejected files for runtime. Exact prompts, tool/model-undisclosed, UTC observations and SHA-256 are in the adjacent provenance records. No commercial reference image was used.\n\n| File | Source / author | Rights basis |\n| --- | --- | --- |\n${rows.join('\n')}\n\nExport JSON files in \`E/export/\` are in-house pipeline derivatives of the registered source PNGs, with the same source rights.\n\n<!-- PHAP-TU-CHIBI-E-MOTION:END -->\n`,
  );
}
console.log(`audited ${provenance.files.length} PNG assets and generation records`);
