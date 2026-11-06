import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from '@vgtd/rig';
import { PACK_PADDING, PACK_EXTRUDE } from '@vgtd/sprite';
const root=join(process.cwd(),'apps/client-cocos/assets/resources/dragonbones/the-tu-sprites'),results=[];
for(const dir of ['E','SE','S','NE','N']){
 const tex=JSON.parse(readFileSync(join(root,`thetu_${dir}_tex.json`),'utf8')),image=decodePng(readFileSync(join(root,tex.imagePath)));
 let pmaBadPixels=0,extrudeMismatchPixels=0,paddingNonzeroPixels=0;
 for(let i=0;i<image.data.length;i+=4)if(image.data[i]!>image.data[i+3]!||image.data[i+1]!>image.data[i+3]!||image.data[i+2]!>image.data[i+3]!)pmaBadPixels++;
 const margin=PACK_PADDING+PACK_EXTRUDE;
 for(const r of tex.SubTexture)for(let y=-margin;y<r.height+margin;y++)for(let x=-margin;x<r.width+margin;x++){
  if(x>=0&&x<r.width&&y>=0&&y<r.height)continue;
  const o=((r.y+y)*image.width+r.x+x)*4;
  const d=Math.max(x<0?-x:x>=r.width?x-r.width+1:0,y<0?-y:y>=r.height?y-r.height+1:0);
  if(d<=PACK_EXTRUDE){const c=((r.y+Math.max(0,Math.min(r.height-1,y)))*image.width+r.x+Math.max(0,Math.min(r.width-1,x)))*4;if([0,1,2,3].some(k=>image.data[o+k]!==image.data[c+k]))extrudeMismatchPixels++;}
  else if([0,1,2,3].some(k=>image.data[o+k]!==0))paddingNonzeroPixels++;
 }
 const result={dir,width:image.width,height:image.height,regions:tex.SubTexture.length,premultipliedAlpha:tex.premultipliedAlpha,padding:PACK_PADDING,extrude:PACK_EXTRUDE,pmaBadPixels,extrudeMismatchPixels,paddingNonzeroPixels};results.push(result);
 if(!tex.premultipliedAlpha||pmaBadPixels||extrudeMismatchPixels||paddingNonzeroPixels)throw new Error(JSON.stringify(result));
}
writeFileSync('$TEMP/vgtd-the-tu-atlas-audit.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));
