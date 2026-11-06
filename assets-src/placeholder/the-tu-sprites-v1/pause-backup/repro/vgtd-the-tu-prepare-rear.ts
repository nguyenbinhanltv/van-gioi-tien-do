import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import { CELL_PX, SPRITE_CLIPS, projectClipDefaults, buildTemplate, guidesFromMaster, measureFigure, resizeImage, groundSpeedPxS, halfStrideFor, locomotionCells } from '@vgtd/sprite';
for(const dir of ['NE','N'] as const){
 const base=join(process.cwd(),'assets-src/placeholder/the-tu-sprites-v1',dir);
 mkdirSync(join(base,'templates'),{recursive:true});mkdirSync(join(base,'sheets'),{recursive:true});mkdirSync(join(base,'raw'),{recursive:true});
 const master=`../../the-tu-continuous-v1/reference/${dir}.master4x.png`;
 const metrics=measureFigure(resizeImage(decodePng(readFileSync(join(base,master))),CELL_PX,CELL_PX))!;
 const guides=guidesFromMaster(metrics);
 const clips=SPRITE_CLIPS.map((spec)=>{
  const defaults={...projectClipDefaults(spec.name),...(spec.name==='dash'?{cols:3}:{})};const speed=groundSpeedPxS(spec.tableId,dir);
  const cells=speed===null?undefined:locomotionCells(defaults.frames,guides,{halfStride:halfStrideFor(speed,defaults.durationSec),lift:spec.name==='run'?16:10,first:'R'});
  const template=buildTemplate({clip:spec.name,frames:defaults.frames,cols:defaults.cols,guides,...(cells?{cells}:{})});
  writeFileSync(join(base,`templates/${spec.name}.template.png`),encodePng(template.image));
  writeFileSync(join(base,`templates/${spec.name}.template.json`),JSON.stringify(template.manifest,null,2)+'\n');
  return {...defaults,sheet:`sheets/${spec.name}.png`,manifest:`templates/${spec.name}.template.json`};
 });
 writeFileSync(join(base,'project.json'),JSON.stringify({character:'the-tu',direction:dir,stem:'thetu',master,palette:{lock:true},slice:{spill:{}},backlog:'quality-backlog.json',clips},null,2)+'\n');
 console.log(dir,metrics.height,clips.reduce((n,c)=>n+c.frames,0),'frames');
}
