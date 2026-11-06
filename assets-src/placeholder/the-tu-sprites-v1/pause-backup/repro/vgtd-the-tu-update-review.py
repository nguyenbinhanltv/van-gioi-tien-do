from pathlib import Path
import json, shutil, hashlib
root=Path.cwd()
pack=root/'assets-src/placeholder/the-tu-sprites-v1'
art=Path('$ARTIFACTS')
sources={'E':Path('$TEMP/vgtd-the-tu-sprites-E-latest/E'),'SE':Path('$TEMP/vgtd-the-tu-sprites-SE-final/SE'),'S':Path('$TEMP/vgtd-the-tu-sprites-S-final/S'),'NE':Path('$TEMP/vgtd-the-tu-sprites-NE-final/NE')}
for direction,source in sources.items():
    capture=json.loads((source/'capture/index.json').read_text(encoding='utf-8'))
    contract=json.loads((source/f'thetu_{direction}.sprite.json').read_text(encoding='utf-8'))
    assert len(capture['animations'])==15 and contract['qa']['ok']
    target=pack/direction/'export';target.mkdir(exist_ok=True)
    evidence={'character':'the-tu','direction':direction,'capture':'real Cocos Creator 3.8.8 web-mobile, headless browser','zoom':2,'sample':'midpoint','samplesPerClip':12,'animations':{},'toolCommit':'695d43501d118fdedc71c8332e64fecd1bf8f262','qaCounts':contract['qa']['counts'],'atlas':contract['atlas'],'viewerMetricNote':'Rig-transform seam is not image-animation proof for display swaps. Image loop seam uses the sprite QA contract.','runtimeSha256':{}}
    for clip,entry in capture['animations'].items():
        for suffix in ['gif','sheet.png']:assert (source/'capture'/f'{clip}.{suffix}').exists()
        evidence['animations'][clip]={'durationSec':entry['duration'],'gifKeyFrames':entry['keyFrames'],'captureLoaded':True}
    for suffix in ['ske.json','tex.json','tex.png']:
        name=f'thetu_{direction}_{suffix}';evidence['runtimeSha256'][name]=hashlib.sha256((source/name).read_bytes()).hexdigest()
    if direction=='E':
        old=json.loads((target/'engine-gate.json').read_text(encoding='utf-8'))
        evidence['atlasPixelEvidence']=old['atlasPixelEvidence']
        evidence['previousCapture']={'toolCommit':old['toolCommit'],'samplesPerClip':old['samplesPerClip'],'byteIdenticalExportFiles':4}
    (target/'engine-gate.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    shutil.copyfile(source/f'thetu_{direction}.sprite.json',target/f'thetu_{direction}.sprite.json')
    dest=art/'the-tu'/direction;dest.mkdir(parents=True,exist_ok=True)
    for file in (source/'capture').glob('*.sheet.png'):shutil.copyfile(file,dest/file.name)
    for file in ['quality-backlog.json','quality-backlog.md']:shutil.copyfile(pack/direction/file,dest/file)
    shutil.copyfile(target/'engine-gate.json',dest/'engine-gate.json')
page=art/'index.html';html=page.read_text(encoding='utf-8')
extra='<section style="padding:24px"><h2>Thể tu — bằng chứng Cocos 2x</h2><p>E: 156 frame / 12 finding mềm. SE: 126 frame / 29 finding mềm. S: 126 frame / 26 finding mềm. NE: 126 frame / 22 finding mềm. Run S/NE có contact-hold hai frame ghi riêng. Mỗi hướng: 15 clip, một atlas 2048 PMA, không lỗi hard gate. Giữ nguyên scale nhân vật; không resample frame để đóng gói.</p>'
for direction in sources:
    folder=art/'the-tu'/direction
    extra+=f'<h3>{direction}</h3><p><a href="the-tu/{direction}/quality-backlog.md">Backlog từng ô / số đo</a> · <a href="the-tu/{direction}/engine-gate.json">Engine gate</a></p><p>'
    extra+=' · '.join(f'<a href="the-tu/{direction}/{p.name}">{p.name.removesuffix(".sheet.png")}: contact 2x</a>' for p in sorted(folder.glob('*.sheet.png')))
    extra+='</p>'
html=html.replace('</body>',extra+'</section></body>');assert '\ufffd' not in html
page.write_text(html,encoding='utf-8')
project=pack/'S/project.json';j=json.loads(project.read_text(encoding='utf-8'))
for clip in j['clips']:
    name=clip['name'];exceptions={}
    if name=='meditate':exceptions={str(i):'seated: full-sized legs folded cross-legged, head and torso remain at character scale' for i in range(8)}
    if name=='dash':exceptions={str(i):'dash-lunge: full-sized torso leans and legs fold naturally' for i in range(1,5)}
    if name=='attack_3':exceptions={'2':'raised-gauntlets: fists above bun change the bounding-box face crop',**{str(i):'ground-slam-crouch: full-sized legs and torso fold naturally' for i in range(3,7)}}
    if name=='hit':exceptions={str(i):'recoil: knees flex and shoulders lean backward' for i in [1,2]}
    if name=='die':exceptions={str(i):'die-collapse: body kneels then lies sideways; upright bounding-box face ROI does not apply' for i in range(2,8)}
    if name=='tribulation':exceptions={str(i):'brace-bend: lowered head behind crossed gauntlets and bent knees' for i in range(4,9)}
    if exceptions:clip['exceptions']=exceptions
project.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Updated E/SE capture evidence and shared review; annotated S natural pose exceptions.')
