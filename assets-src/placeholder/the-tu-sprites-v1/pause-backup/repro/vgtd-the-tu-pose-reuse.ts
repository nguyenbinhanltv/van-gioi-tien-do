import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import { cellRect, cellHashes, repairCell } from '@vgtd/sprite';
const [dir,clip,fromArg,toArg]=process.argv.slice(2),sourceCell=Number(fromArg),targetCell=Number(toArg);
const base=join(process.cwd(),'assets-src/placeholder/the-tu-sprites-v1',dir!),project=JSON.parse(readFileSync(join(base,'project.json'),'utf8'));
const spec=project.clips.find((c:any)=>c.name===clip),grid={cols:spec.cols,rows:Math.ceil(spec.frames/spec.cols)};
const original=decodePng(readFileSync(join(base,`sheets/${clip}.png`))),rawSource=`raw/${clip}.before-pose-reuse.png`;
writeFileSync(join(base,rawSource),encodePng(original));
const from=cellRect(original.width,original.height,grid.cols,grid.rows,sourceCell),to=cellRect(original.width,original.height,grid.cols,grid.rows,targetCell);
if(Math.abs(from.width-to.width)>1||Math.abs(from.height-to.height)>1)throw new Error('Only one-pixel key margins may differ');
const data=new Uint8ClampedArray(original.data);
for(let y=0;y<from.height;y++)for(let x=0;x<from.width;x++)if(x>=to.width||y>=to.height){const o=((from.y+y)*original.width+from.x+x)*4;if(original.data[o]!<240||original.data[o+1]!>24||original.data[o+2]!<240||original.data[o+3]!==255)throw new Error('Cannot trim non-key pixels');}
for(let y=0;y<to.height;y++)for(let x=0;x<to.width;x++){const o=((to.y+y)*original.width+to.x+x)*4;if(x<from.width&&y<from.height){const s=((from.y+y)*original.width+from.x+x)*4;data.set(original.data.subarray(s,s+4),o);}else data.set([255,0,255,255],o);}
const result=repairCell(original,{...original,data},grid,targetCell),before=cellHashes(original,grid),after=cellHashes(result.image,grid);
if(before.some((h,i)=>i!==targetCell&&h!==after[i]))throw new Error('Unselected cell changed');
writeFileSync(join(base,`sheets/${clip}.png`),encodePng(result.image));
writeFileSync(join(base,`raw/${clip}.pose-reuse-repair.json`),JSON.stringify({clip,dir,method:'Exact pose reuse using public repairCell; one-pixel magenta-matte-only edge pad/trim, no scale/resampling',trimMatteRange:{minRed:240,maxGreen:24,minBlue:240,alpha:255},sourceCell,targetCell,sourceDimensions:[from.width,from.height],targetDimensions:[to.width,to.height],rawSource,selected:`sheets/${clip}.png`,unchangedOtherCells:spec.frames-1,before,after},null,2)+'\n');
console.log(dir,clip,`${sourceCell} -> ${targetCell}`,spec.frames-1,'other cells byte-identical');
