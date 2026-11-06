import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { decodePng, encodePng } from '@vgtd/rig';
import { CELL_PX, guidesFromMaster, measureFigure, resizeImage } from '@vgtd/sprite';
const folder = join(process.cwd(), 'assets-src/placeholder/the-tu-continuous-v1/reference');
const records = ['E','SE','S','NE','N'].map((dir) => {
 const file = join(folder, `${dir}.master4x.png`);
 const bytes = readFileSync(file);
 const image = resizeImage(decodePng(bytes), CELL_PX, CELL_PX);
 const metrics = measureFigure(image)!;
 return { dir, source: `assets-src/placeholder/the-tu-continuous-v1/reference/${dir}.master4x.png`, sha256: createHash('sha256').update(bytes).digest('hex'), metrics, guides: guidesFromMaster(metrics) };
});
writeFileSync('$TEMP/vgtd-the-tu-master-audit.json', JSON.stringify(records,null,2));
console.log(JSON.stringify(records.map((r)=>({dir:r.dir,height:r.metrics.height,width:r.metrics.width,head:r.guides.head,axis:r.guides.centerX})),null,2));
