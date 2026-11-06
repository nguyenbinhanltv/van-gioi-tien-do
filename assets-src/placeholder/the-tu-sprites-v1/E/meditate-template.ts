import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { encodePng } from '@vgtd/rig';
import { buildTemplate, type TemplateManifest } from '@vgtd/sprite';
const base = dirname(process.argv[1]!);
const original = JSON.parse(
  readFileSync(join(base, 'raw/meditate.attempt1.template.json'), 'utf8'),
) as TemplateManifest;
const result = buildTemplate({
  clip: 'meditate',
  frames: 8,
  cols: 4,
  guides: { ...original.guides, head: 80, pelvis: 165 },
});
writeFileSync(join(base, 'templates/meditate.template.png'), encodePng(result.image));
writeFileSync(join(base, 'templates/meditate.template.json'), JSON.stringify(result.manifest, null, 2) + '\n');
