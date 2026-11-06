import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from '@vgtd/rig';
import { buildTemplate } from '@vgtd/sprite';
const base=join(process.cwd(),'assets-src/placeholder/the-tu-sprites-v1/SE/templates');
const old=JSON.parse(readFileSync(join(base,'meditate.template.json'),'utf8'));
const t=buildTemplate({clip:'meditate',frames:8,cols:4,guides:{...old.guides,head:80,pelvis:165}});
writeFileSync(join(base,'meditate.template.png'),encodePng(t.image));writeFileSync(join(base,'meditate.template.json'),JSON.stringify(t.manifest,null,2)+'\n');
