import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, encodePng, createImage } from '@vgtd/rig';
import { resizeImage } from '@vgtd/sprite';
const root=process.cwd(),base=join(root,'apps/client-cocos/assets/resources/dragonbones/the-tu-sprites');
const atlas=decodePng(readFileSync(join(base,'thetu_E_tex.png'))),tex=JSON.parse(readFileSync(join(base,'thetu_E_tex.json'),'utf8'));
const r=tex.SubTexture.find((r)=>r.name==='meditate_01');
const ske=JSON.parse(readFileSync(join(base,'thetu_E_ske.json'),'utf8'));
const display=ske.armature[0].skin[0].slot[0].display.find((d)=>d.name==='meditate_01');
r.frameX=-(display.transform.x*2+128-r.width/2);r.frameY=-(display.transform.y*2+232-r.height/2);
const master=resizeImage(decodePng(readFileSync(join(root,'assets-src/placeholder/the-tu-continuous-v1/reference/E.master4x.png'))),256,256);
const out=createImage(512,256);
for(let y=0;y<256;y++)for(let x=0;x<256;x++)out.data.set(master.data.subarray((y*256+x)*4,(y*256+x+1)*4),(y*512+x)*4);
for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){
 const xx=256-r.frameX+x,yy=-r.frameY+y;
 if(xx>=256&&xx<512&&yy>=0&&yy<256)out.data.set(atlas.data.subarray(((r.y+y)*atlas.width+r.x+x)*4,((r.y+y)*atlas.width+r.x+x+1)*4),(yy*512+xx)*4);
}
writeFileSync('$TEMP/vgtd-the-tu-master-meditate.png',encodePng(out));console.log(r);
