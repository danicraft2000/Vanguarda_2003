"""Monta o painel 5x4 (mesma grade da imagem original) a partir de out/tile_XX.png."""
import sys
from pathlib import Path
from PIL import Image, ImageFilter

out = Path(sys.argv[1] if len(sys.argv) > 1 else 'out')
dest = Path(sys.argv[2] if len(sys.argv) > 2 else 'painel.png')
tw, th = int(sys.argv[3]) if len(sys.argv) > 3 else 800, None
th = tw * 3 // 4
gut = max(2, tw // 100)
cols, rows = 5, 4
W = cols * tw + (cols + 1) * gut
H = rows * th + (rows + 1) * gut
sheet = Image.new('RGB', (W, H), (10, 10, 12))
for i in range(cols * rows):
    p = out / f'tile_{i:02d}.png'
    if not p.exists():
        continue
    im = Image.open(p).convert('RGB')
    if im.size != (tw, th):
        im = im.resize((tw, th), Image.LANCZOS)
    r, c = divmod(i, cols)
    sheet.paste(im, (gut + c * (tw + gut), gut + r * (th + gut)))
sheet.save(dest, optimize=True)
print(dest, sheet.size)
