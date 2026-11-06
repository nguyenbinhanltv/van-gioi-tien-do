import {readFileSync,writeFileSync} from 'node:fs';
import {decodePng,encodePng} from '@vgtd/rig';
import {repairCell,cellHashes} from '@vgtd/sprite';
const path='assets-src/placeholder/phap-tu-fan-sprite-v1/E/sheets/run.png';const source=decodePng(readFileSync(path));const edited=decodePng(readFileSync('assets-src/placeholder/phap-tu-fan-sprite-v1/E/sheets/run.repair1.generated.png'));const grid={cols:6,rows:2};let result=source;const operations=[];for(const cell of [4,10]){const step=repairCell(result,edited,grid,cell);operations.push({cell,changed:step.changed});result=step.image;}
const before=cellHashes(source,grid),after=cellHashes(result,grid);const changed=before.flatMap((hash,i)=>hash===after[i]?[]:[i]);if(changed.some(i=>i!==4&&i!==10))throw Error('unexpected cell changed');writeFileSync(path,encodePng(result));writeFileSync(path.replace('.png','.repair.json'),JSON.stringify({method:'@vgtd/sprite repairCell; changed cells only, no figure scaling',operations,changed,before,after},null,2));console.log({changed});

