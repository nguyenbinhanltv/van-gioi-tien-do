import{createRequire}from'node:module';import{execFileSync}from'node:child_process';import{readFileSync,mkdtempSync,writeFileSync}from'node:fs';import{tmpdir}from'node:os';import{resolve,join,dirname}from'node:path';import{pathToFileURL}from'node:url';
const require=createRequire(resolve('package.json')),{build}=require('esbuild'),dir=mkdtempSync(join(tmpdir(),'vgtd-repaired-S-')),outfile=join(dir,'api.mjs');
const head=execFileSync('git',['rev-parse','695d435'],{encoding:'utf8'}).trim();
await build({stdin:{contents:"export{runProject}from'./tools/sprite/src/project.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile,banner:{js:"import{createRequire}from'node:module';const require=createRequire(import.meta.url);"},plugins:[{name:'published122',setup(b){b.onLoad({filter:/sprite[\\/]src[\\/](pack|project|export)\.ts$/},({path})=>({contents:execFileSync('git',['show',head+':tools/sprite/src/'+path.split(/[\\/]/).at(-1)],{encoding:'utf8'}),loader:'ts'}));}}]});
const api=await import(pathToFileURL(outfile).href),p='D:/Temp/vgtd-support-S-normalized-repaired/project.json',project=JSON.parse(readFileSync(p,'utf8')),r=api.runProject(project,dirname(p));
console.log(JSON.stringify({head,calibration:r.contract.calibration,atlas:r.contract.atlas,clips:r.contract.clips.length,frames:r.contract.clips.reduce((n,c)=>n+c.frames,0),qa:r.contract.qa.counts,files:[...r.files.keys()]}));
if(r.contract.qa.counts['fail-hard']!==0)process.exitCode=1;

if(r.contract.qa.counts['fail-hard']!==0||r.contract.qa.counts['fail-soft']!==31||r.contract.qa.counts.info!==22)throw Error('Repaired source QA changed since previous check; contract not saved');
writeFileSync('C:/Users/PC/.ao/data/artifacts/van-gioi-tien-do-22/danphutu_S-repaired.sprite.json',JSON.stringify(r.contract,null,2));
