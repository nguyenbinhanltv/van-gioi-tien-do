import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from '@vgtd/rig';
import { runProject, loadBacklog, applyBacklog, acceptFindings, saveBacklog } from '__TEMP__/vgtd-support21-sprite123-1c48569/tools/sprite/src/index.ts';
const root='__TEMP__/vgtd-support-full-source-review'; mkdirSync(root,{recursive:true});
let backlog:any=loadBacklog('__TEMP__/vgtd-support-S/quality-backlog.json','dan-phu-tu');
const summary=[];
for(const direction of ['S','NE','N']){
const normalized=direction==='S'?'__TEMP__/vgtd-support-S-directional-normalized':`__TEMP__/vgtd-support-${direction}-normalized`;
const project=JSON.parse(readFileSync(join(normalized,'project.json'),'utf8'));
const findings=[]; let regions=0; let hard=0; const visual=[];
for(const clip of project.clips){
 const result=runProject({...project,clips:[clip]},root);
 hard+=result.contract.qa.judged.filter(j=>j.class==='hard').length;
 findings.push(...result.contract.qa.judged.map(j=>j.finding));
 const stem=`danphutu_${direction}`;
 const atlas=decodePng(result.files.get(`${stem}_tex.png`) as Uint8Array);
 const tex=JSON.parse(result.files.get(`${stem}_tex.json`) as string);
 for(const region of tex.SubTexture){regions++;let count=0;
 for(let y=region.y;y<region.y+region.height;y++)for(let x=region.x;x<region.x+region.width;x++){
 const i=(y*atlas.width+x)*4;if(atlas.data[i+3]>=250&&atlas.data[i]>atlas.data[i+1]+25&&atlas.data[i+2]>atlas.data[i+1]+25)count++;
 }
 if(count){const split=region.name.lastIndexOf('_');visual.push({clip:region.name.slice(0,split),dir:direction,cell:Number(region.name.slice(split+1))-1,gate:'palette',metric:'violet_spill_pixels',value:count,limit:0,note:'Opaque violet after palette lock: R and B exceed G by >25, alpha >=250. Includes hair key spill / whisk hue drift; cell-local recolor in later pass.',status:'open',added:'2026-11-06'});}
 }
}
if(hard||regions!==156)throw Error(`${direction}: hard=${hard}, regions=${regions}`);
const report=applyBacklog(findings,direction,backlog);
backlog=acceptFindings(backlog,report,direction,{note:'First full-set pass: exact free-pose height/2D directional-foot measurement at fixed master-locked scale; no frame scaling or dropping. Directional API frozen123 1c48569; final aggregate export/capture and verification from merged main pending.',owner:'support-art',added:'2026-11-06'});
backlog.visualFindings=[...(backlog.visualFindings??[]).filter(e=>e.dir!==direction||e.metric!=='violet_spill_pixels'),...visual];
summary.push({direction,clips:project.clips.length,frames:regions,hard,soft:backlog.entries.filter(e=>e.dir===direction).length,visual:visual.length});
}
saveBacklog(join(root,'quality-backlog.json'),backlog);
writeFileSync(join(root,'source-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));