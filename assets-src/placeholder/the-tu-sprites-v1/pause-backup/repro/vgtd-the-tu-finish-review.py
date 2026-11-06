from pathlib import Path
import shutil

art=Path('$ARTIFACTS')
target=art/'the-tu/E'
source=Path('$TEMP/vgtd-the-tu-sprites-E-final/E/capture')
pack=Path('assets-src/placeholder/the-tu-sprites-v1/E')
for p in source.glob('*.sheet.png'):shutil.copyfile(p,target/p.name)
for name in ['quality-backlog.json','quality-backlog.md']:shutil.copyfile(pack/name,target/name)
shutil.copyfile(pack/'export/engine-gate.json',target/'engine-gate.json')
page=art/'index.html';text=page.read_text(encoding='utf-8')
extra='<section style="padding:24px"><h2>Thể tu E — bằng chứng Cocos 2x</h2><p>15 clip / 156 frame, atlas 2048 PMA. Không có hard failure; 12 finding mềm được ghi riêng trong backlog. Capture thật từ head packer #122; PR art chờ tooling merge. Chỉ metric loop seam theo ảnh của sprite contract được dùng cho display-swap.</p><p><a href="the-tu/E/quality-backlog.md">Backlog từng ô / số đo</a> · <a href="the-tu/E/quality-backlog.json">JSON</a> · <a href="the-tu/E/engine-gate.json">Engine gate</a></p><p>'
extra+=' · '.join(f'<a href="the-tu/E/{p.name}">{p.name.removesuffix(".sheet.png")}: contact 2x</a>' for p in sorted(source.glob('*.sheet.png')))
extra+='</p></section>'
text=text.replace('</body>',extra+'</body>');page.write_text(text,encoding='utf-8')
assert len(list(target.glob('*.gif')))==15
assert len(list(target.glob('*.sheet.png')))==15
assert '\ufffd' not in text
print('Review complete:15GIF+15contacts+backlog')
