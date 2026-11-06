import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from '@vgtd/rig';
import { buildTemplate } from '@vgtd/sprite';
const base=join(process.cwd(),'assets-src/placeholder/the-tu-sprites-v1/N');
const original=JSON.parse(readFileSync(join(base,'templates/meditate.template.json'),'utf8'));
const result=buildTemplate({clip:'meditate',frames:8,cols:4,guides:{...original.guides,head:84,pelvis:166}});
writeFileSync(join(base,'templates/meditate.template.png'),encodePng(result.image));
writeFileSync(join(base,'templates/meditate.template.json'),JSON.stringify(result.manifest,null,2)+'\n');
