import { readFileSync } from 'node:fs';
import { runProject, writeOutputs } from './tools/sprite/src/index.ts';
const project=JSON.parse(readFileSync('__TEMP__/vgtd-support-S-normalized-repaired/project.json','utf8'));
const result=runProject(project,'__TEMP__');
writeOutputs(result,'__TEMP__/vgtd-support-S-multipage-visual-test');
console.log(JSON.stringify({atlas:result.contract.atlas,qa:result.contract.qa.counts}));