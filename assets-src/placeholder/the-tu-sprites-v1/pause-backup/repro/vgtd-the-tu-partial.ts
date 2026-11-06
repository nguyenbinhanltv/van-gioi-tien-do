import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runProject, writeOutputs } from '@vgtd/sprite';
const dir=process.argv[2]!,base=join(process.cwd(),'assets-src/placeholder/the-tu-sprites-v1',dir);
const project=JSON.parse(readFileSync(join(base,'project.json'),'utf8'));
project.clips=project.clips.filter((c:any)=>existsSync(join(base,c.sheet)));
const result=runProject(project,base);writeOutputs(result,`$TEMP/vgtd-the-tu-${dir}-partial`);
console.log(JSON.stringify({clips:result.contract.clips.map(c=>({name:c.name,heights:c.records.map(r=>r?.post.height)})),qa:result.contract.qa.counts,hard:result.contract.qa.judged.filter(v=>v.verdict==='fail-hard')},null,2));
