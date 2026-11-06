from pathlib import Path
import json, shutil, hashlib, datetime, re

repo=Path.cwd()
pack=repo/'assets-src/placeholder/the-tu-sprites-v1'
backup=pack/'pause-backup'
backup.mkdir(exist_ok=True)
(backup/'.gitattributes').write_text('*.gif filter=lfs diff=lfs merge=lfs -text\n',encoding='utf-8')
home=Path.home()
artifact=home/'.ao/data/artifacts/van-gioi-tien-do-18/the-tu-sprite-review'
replacements=[(str(repo),'$WORKSPACE'),(str(artifact),'$ARTIFACTS'),(str(home),'$USER_HOME'),('$TEMP','$TEMP'),('$TEMP','$TEMP')]
def clean(text):
    for old,new in replacements:
        for variant in {old,old.replace('\\','/'),old.replace('\\','\\\\')}:
            text=text.replace(variant,new)
    return re.sub(r"(?i)\b[A-Z]:[\\/]+[^\s\"'<>]+",'$LOCAL_PATH',text)
def copy(source,target):
    target.parent.mkdir(parents=True,exist_ok=True)
    if source.suffix.lower() in {'.json','.md','.html','.ts','.mjs','.cjs','.py','.log'}:
        raw=source.read_bytes()
        if raw.startswith((b'\xff\xfe',b'\xfe\xff')):text=raw.decode('utf-16')
        else:
            try:text=raw.decode('utf-8-sig')
            except UnicodeDecodeError:text=raw.decode('latin1')
        target.write_text(clean(text),encoding='utf-8')
    else:shutil.copyfile(source,target)
missing=[]
metadata=list(pack.glob('*/raw/*.generation.json'))
for file in metadata:
    item=json.loads(file.read_text(encoding='utf-8'))
    image_id=item.get('originalImageId','').removeprefix('imagegen:')
    source=home/'.codex/generated_images'/image_id
    if not source.is_file():
        missing.append({'record':file.relative_to(repo).as_posix(),'imageId':image_id})
        continue
    target=file.parent/'originals'/file.name.replace('.generation.json','.png')
    target.parent.mkdir(exist_ok=True)
    shutil.copyfile(source,target)
    item['originalBackup']='raw/originals/'+target.name
    file.write_text(json.dumps(item,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
for direction in ['E','SE','S','NE','N']:
    folder='vgtd-the-tu-sprites-E-latest' if direction=='E' else f'vgtd-the-tu-sprites-{direction}-final'
    source=Path('$TEMP')/folder
    target=backup/'batches'/direction
    for name in ['batch-report.json','index.html']:
        if (source/name).exists():copy(source/name,target/name)
    for file in (source/direction).iterdir():
        if file.is_file():copy(file,target/direction/file.name)
    for file in (source/direction/'capture').iterdir():
        if file.is_file() and (file.suffix in {'.gif','.json','.html'} or file.name.endswith('.sheet.png')):
            copy(file,target/direction/'capture'/file.name)
    assert len(list((target/direction/'capture').glob('*.gif')))==15,direction
    assert len(list((target/direction/'capture').glob('*.sheet.png')))==15,direction
if artifact.exists():
    for file in artifact.rglob('*'):
        if file.is_file():copy(file,backup/'review'/file.relative_to(artifact))
names=['atlas-audit.ts','atlas-audit.json','calibrate-next.ts','fix-dash-layout.ts','prepare-next.ts','prepare-rear.ts','repair-selected.ts','repair-proof.ts','S-contact-hold.ts','NE-contact-hold.ts','N-idle-hold.ts','pose-reuse.ts','inspect-margin.ts','S-seated.ts','SE-meditate-template.ts','NE-seated.ts','N-seated.ts','partial.ts','head-check.ts','master-audit.ts','master-audit.json','finish-review.py','update-review.py','pause-backup.py']
for name in names:
    source=Path('$TEMP')/('vgtd-the-tu-'+name)
    if source.exists():
        text=clean(source.read_text(encoding='utf-8'))
        text=text.replace('@vgtd/rig','@vgtd/rig').replace('@vgtd/sprite','@vgtd/sprite')
        target=backup/'repro'/source.name;target.parent.mkdir(exist_ok=True)
        target.write_text(text,encoding='utf-8')
for direction in ['E','SE','S','NE','N']:
    names=[f'vgtd-the-tu-{direction}-full.log',f'vgtd-the-tu-{direction}-upright.log',f'vgtd-the-tu-{direction}-backlog.log',f'vgtd-the-tu-sprites-{direction}-final.log']
    if direction=='E':names+=['vgtd-the-tu-sprites-E-latest.log','vgtd-the-tu-sprites-E-Cocos-final.log']
    for name in names:
        source=Path('$TEMP')/name
        if source.exists():copy(source,backup/'validation'/name)
copy(Path('$TEMP/vgtd-the-tu-atlas-audit.json'),backup/'atlas-pixel-evidence.json')
(backup/'missing-originals.json').write_text(json.dumps(missing,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
state={'snapshotUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'branch':'wip/van-gioi-tien-do-18-pause-20261107','baseCommit':'695d43501d118fdedc71c8332e64fecd1bf8f262','directions':['E','SE','S','NE','N'],'clips':75,'frames':660,'sourceGenerationRecords':len(metadata),'originalCacheBackups':len(metadata)-len(missing),'missingOriginals':missing,'hardFailures':0,'acceptedSoft':{'E':12,'SE':29,'S':26,'NE':22,'N':30},'capturesSaved':75,'publication':'WIP backup only; no PR; final ASSET-LICENSES integration and root checks pending','resume':'Wait for explicit RESUME; merge origin/main after PR122 lands; restore/verify E from this WIP and publish one direction per PR. Do not rerun bootstrap or repair scripts blindly.'}
(backup/'pause-state.json').write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(state,ensure_ascii=False))
