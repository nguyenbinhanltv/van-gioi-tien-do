import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from '@vgtd/rig';
import { buildTemplate } from '@vgtd/sprite';
for(const dir of ['SE','S']){
 const base=join(process.cwd(),'assets-src/placeholder/the-tu-sprites-v1',dir),projectPath=join(base,'project.json');
 const p=JSON.parse(readFileSync(projectPath,'utf8')),clip=p.clips.find(c=>c.name==='dash');
 const old=JSON.parse(readFileSync(join(base,'templates/dash.template.json'),'utf8'));
 if(existsSync(join(base,'raw/dash.attempt1.generation.json'))){
  copyFileSync(join(base,'templates/dash.template.png'),join(base,'raw/dash.attempt1.template.png'));
  copyFileSync(join(base,'templates/dash.template.json'),join(base,'raw/dash.attempt1.template.json'));
  const file=join(base,'raw/dash.attempt1.generation.json'),m=JSON.parse(readFileSync(file,'utf8'));m.references[1]='raw/dash.attempt1.template.png';m.layoutNote='Generation followed requested3x2 layout, not initial4-column reference template. Slicer manifest corrected to actual3x2; no resampling or frame drop.';writeFileSync(file,JSON.stringify(m,null,2)+'\n');
 }
 const t=buildTemplate({clip:'dash',frames:6,cols:3,guides:old.guides});
 writeFileSync(join(base,'templates/dash.template.png'),encodePng(t.image));writeFileSync(join(base,'templates/dash.template.json'),JSON.stringify(t.manifest,null,2)+'\n');
 clip.cols=3;writeFileSync(projectPath,JSON.stringify(p,null,2)+'\n');
}
