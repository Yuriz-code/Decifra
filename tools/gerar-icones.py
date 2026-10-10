#!/usr/bin/env python3
"""Gera os ícones do app (public/icons). Uso: python3 tools/gerar-icones.py   (precisa de Pillow)
Desenho: bloco de letra "D" (a "casinha" do jogo) sobre fundo roxo, com selo laranja "!"."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
GRAPE, GRAPE2, TANG, WHITE, EDGE = (106, 61, 240), (139, 102, 255), (255, 107, 44), (255, 255, 255), (201, 190, 242)
FONTS = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
         '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
         '/System/Library/Fonts/Supplemental/Arial Bold.ttf', 'C:/Windows/Fonts/arialbd.ttf']
def font(px):
    for f in FONTS:
        if os.path.exists(f): return ImageFont.truetype(f, px)
    raise SystemExit('Nenhuma fonte em negrito encontrada; ajuste FONTS em gerar-icones.py')

def gradient(n):
    g = Image.new('RGB', (n, n)); px = g.load()
    for y in range(n):
        for x in range(n):
            t = (x + y) / (2 * n - 2)
            px[x, y] = tuple(int(GRAPE[i] + (GRAPE2[i] - GRAPE[i]) * t) for i in range(3))
    return g

def draw(n, scale, rounded):
    """n = lado final; scale = quanto do quadrado o bloco ocupa (menor no maskable: zona segura)."""
    S = 1024
    im = gradient(S).convert('RGBA'); d = ImageDraw.Draw(im)
    t = int(S * scale); x0 = (S - t) // 2; y0 = (S - t) // 2 + int(S * .01)
    r = int(t * .2); sh = int(t * .045)
    d.rounded_rectangle([x0, y0 + sh, x0 + t, y0 + t + sh], r, fill=EDGE)          # sombra/borda do bloco
    d.rounded_rectangle([x0, y0, x0 + t, y0 + t], r, fill=WHITE)                    # bloco
    f = font(int(t * .78)); w = d.textlength('D', font=f)
    bb = d.textbbox((0, 0), 'D', font=f)
    d.text((x0 + (t - w) / 2 - bb[0], y0 + (t - (bb[3] - bb[1])) / 2 - bb[1]), 'D', font=f, fill=GRAPE)
    cr = int(t * .22); cx = x0 + t - int(t * .04); cy = y0 + int(t * .04)           # selo "!"
    d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=TANG, outline=WHITE, width=int(t * .035))
    f2 = font(int(cr * 1.5)); b2 = d.textbbox((0, 0), '!', font=f2)
    d.text((cx - (b2[0] + b2[2]) / 2, cy - (b2[1] + b2[3]) / 2), '!', font=f2, fill=WHITE)
    if rounded:                                                                     # cantos arredondados (ícone "any")
        m = Image.new('L', (S, S), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, S - 1, S - 1], int(S * .22), fill=255)
        im.putalpha(m)
    return im.resize((n, n), Image.LANCZOS)

os.makedirs(OUT, exist_ok=True)
draw(192, .56, True).save(os.path.join(OUT, 'icon-192.png'))
draw(512, .56, True).save(os.path.join(OUT, 'icon-512.png'))
draw(512, .46, False).save(os.path.join(OUT, 'icon-maskable-512.png'))              # fundo total + zona segura
draw(180, .56, False).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'))  # iOS arredonda sozinho
print('ícones gerados em', os.path.abspath(OUT))
