import { readFileSync } from 'node:fs';
import { decodePng } from '@vgtd/rig';
import { cellRect } from '@vgtd/sprite';
const image=decodePng(readFileSync('assets-src/placeholder/the-tu-sprites-v1/N/sheets/emote.png'));
const from=cellRect(image.width,image.height,4,2,2),to=cellRect(image.width,image.height,4,2,4),colors=new Map<string,number>();
for(let y=0;y<from.height;y++)for(let x=0;x<from.width;x++)if(x>=to.width||y>=to.height){const o=((from.y+y)*image.width+from.x+x)*4,key=Array.from(image.data.subarray(o,o+4)).join(',');colors.set(key,(colors.get(key)??0)+1);}
console.log(JSON.stringify({size:[image.width,image.height],from,to,colors:[...colors]},null,2));
