import json,html,shutil
from pathlib import Path
from PIL import Image,ImageDraw
src=Path('D:/Temp/vgtd-support-S-multipage-capture')
index=json.loads((src/'index.json').read_text())
names=list(index['animations'])
assert len(names)==15,names
root=Path('C:/Users/PC/.ao/data/artifacts/van-gioi-tien-do-22')
assets=root/'multipage-capture-assets';assets.mkdir(parents=True,exist_ok=True)
montage=Image.new('RGB',(900,5*260),(20,23,28));draw=ImageDraw.Draw(montage)
cards=[]
for i,name in enumerate(names):
 for ext in ['gif','sheet.png']:
  file=src/f'{name}.{ext}';assert file.exists();shutil.copy2(file,assets/file.name)
 im=Image.open(src/f'{name}.sheet.png');tile=im.crop((0,0,im.width//3,im.height//8));tile.thumbnail((300,235))
 x=(i%3)*300;y=(i//3)*260;montage.paste(tile,(x,y+22));draw.text((x+6,y+4),name,fill='white')
 note='Page 2 first frame; page 1 remaining frames.' if name=='meditate' else 'Page 1.'
 cards.append(f'<article><h2>{html.escape(name)}</h2><img loading="lazy" src="multipage-capture-assets/{name}.gif" alt="{name} real Cocos capture"><p>{note} <a href="multipage-capture-assets/{name}.sheet.png">Full 2x contact sheet</a></p></article>')
montage.save('D:/Temp/vgtd-multipage-proof-montage.png')
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Two-page Cocos capture proof</title><style>body{margin:24px;background:#14171c;color:#e6e8eb;font:15px/1.5 system-ui}main{max-width:1200px;margin:auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}article{padding:12px;background:#1d2229;border-radius:8px}img{width:100%;display:block}h1{font-size:24px}h2{font-size:17px}a{color:#7db4ff}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><main><h1>Dan/Phu tu S: real two-page Cocos 3.8.8 capture</h1><p>15 clips / 156 original frames. One DragonBones armature; atlas pages 2048x2048 (155 regions) and 256x256 (meditate_01). No frame downscaling or removal. Extra atlas registered under the primary atlas UUID using public CCFactory.parseTextureAtlasData.</p><p>Capture completed successfully at zoom 2 with 24 midpoint samples per contact sheet. Meditation starts on page 2 and continues on page 1. Unit tests preserve display geometry and clip-table events. Existing source-art QA findings remain separate from this runtime-loading proof.</p><p>Single-page exports: all four The tu E and Dan/Phu E files remain byte-identical to original MaxRects head 27e82d6. S trim area: 3,589,177 px2; padded area: 3,892,441 px2.</p><div class="grid">'''+''.join(cards)+'''</div><details><summary>Capture metadata</summary><pre>'''+html.escape(json.dumps(index,indent=2))+'''</pre></details></main></html>'''
(root/'multipage-capture.html').write_text(page,encoding='utf8')
print('Created proof:',root/'multipage-capture.html','15 GIFs + 15 original 2x sheets')
