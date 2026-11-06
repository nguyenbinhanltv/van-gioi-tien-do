import {createRequire} from 'node:module';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(resolve('package.json')); const {build}=require('esbuild');
const dir=readdirSync(tmpdir()).filter(x=>x.startsWith('vgtd-compare-')).map(x=>join(tmpdir(),x)).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs)[0];
await build({stdin:{contents:"export {runProject} from './tools/sprite/src/project.ts'; export {decodePng} from '@vgtd/rig';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:join(dir,'final.mjs'),banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"}});
const old=await import(pathToFileURL(join(dir,'old.mjs'))),cur=await import(pathToFileURL(join(dir,'final.mjs')));
const path=resolve('assets-src/placeholder/dan-phu-tu-sprite-v1/E/project.json'), project=JSON.parse(readFileSync(path));
const a=old.runProject(project,dirname(path)),b=cur.runProject(project,dirname(path));
for(const [name,data] of a.files)console.log(name,Buffer.from(data).equals(Buffer.from(b.files.get(name)))?'byte-identical':'changed');
const stem=project.stem+'_E',at=JSON.parse(a.files.get(stem+'_tex.json')),bt=JSON.parse(b.files.get(stem+'_tex.json')),ai=old.decodePng(a.files.get(stem+'_tex.png')),bi=cur.decodePng(b.files.get(stem+'_tex.png'));
for(const r of at.SubTexture){const s=bt.SubTexture.find(x=>x.name===r.name);if(!s||r.width!==s.width||r.height!==s.height)throw Error('dimensions');for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++)for(let c=0;c<4;c++)if(ai.data[((r.y+y)*ai.width+r.x+x)*4+c]!==bi.data[((s.y+y)*bi.width+s.x+x)*4+c])throw Error('pixel '+r.name);}
console.log('156 regions pixel-identical; QA identical:',JSON.stringify(a.contract.qa)===JSON.stringify(b.contract.qa));
