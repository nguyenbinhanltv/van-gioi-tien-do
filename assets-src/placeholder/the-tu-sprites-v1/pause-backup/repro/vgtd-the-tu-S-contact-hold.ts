import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { decodePng, encodePng } from '@vgtd/rig';
import { cellRect, cellHashes, repairCell } from '@vgtd/sprite';
const base=join(process.cwd(),'assets-src/placeholder/the-tu-sprites-v1/S');
const bytes=readFileSync(join(base,'raw/run.attempt2.selected.png'));
const original=decodePng(bytes),donor=decodePng(bytes),grid={cols:6,rows:2};
const source=cellRect(original.width,original.height,6,2,1),target=cellRect(original.width,original.height,6,2,0);
const width=Math.min(source.width,target.width),height=Math.min(source.height,target.height);
if(Math.abs(source.width-target.width)>1||Math.abs(source.height-target.height)>1)throw new Error('Unexpected cell size');
for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++)if(x>=width||y>=height){const i=((source.y+y)*original.width+source.x+x)*4;if(original.data[i]!<220||original.data[i+1]!>30||original.data[i+2]!<220)throw new Error('Only key boundary may be trimmed');}
for(let y=0;y<height;y++){const from=((source.y+y)*original.width+source.x)*4,to=((target.y+y)*original.width+target.x)*4;donor.data.set(original.data.subarray(from,from+width*4),to);}
const result=repairCell(original,donor,grid,0),before=cellHashes(original,grid),after=cellHashes(result.image,grid);
if(before.some((h,i)=>i!==0&&h!==after[i]))throw new Error('Unselected cell changed');
writeFileSync(join(base,'sheets/run.png'),encodePng(result.image));
writeFileSync(join(base,'raw/run.contact-hold-repair.json'),JSON.stringify({clip:'run',dir:'S',method:'Reuse valid R-load pose from cell1 as cell0 for an explicit2-frame planted contact/load hold. Public repairCell; no image-generation call or per-frame scale.',source:'raw/run.attempt2.selected.png',sourceCell0:1,targetCell0:0,holdFrames:2,unchangedOtherCells:11,before,after,sourceSha256:createHash('sha256').update(bytes).digest('hex'),boundary:{source,target,width,height,droppedBoundaryVerifiedKey:true},polish:'Contact hold and weak reversal remain soft visual debt, measured by footSlide backlog; all12 frames remain.'},null,2)+'\n');
