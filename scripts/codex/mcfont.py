"""Rebuild Minecraft's chat font as a web font, one square per pixel.

Follows the game's own font chain (assets/minecraft/font/default.json):
  1. space provider      ' ' advances 4 units
  2. bitmap atlases      nonlatin_european.png, accented.png, ascii.png, laid out by
                         include/default.json. A resource pack may replace any atlas.
  3. unihex (Unifont)    everything else, including the pixel emoji, from unifont.zip
Glyph metrics follow the game: a bitmap glyph advances round(width * scale) + 1;
a Unifont glyph is 16 rows drawn at half size, trimmed to its inked columns.
1 Minecraft font unit = 128 font units and 8 units = 1 em, so at CSS font-size
16px one unit is exactly 2px and the pixels stay crisp.
"""
import io
import json
import zipfile

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from PIL import Image

UNIT = 128  # font units per Minecraft font unit


class Rect:
    """Collects pixel rectangles for one glyph."""

    def __init__(self):
        self.pen = TTGlyphPen(None)

    def row(self, pixels, width, top, px, x_shift=0):
        """Add one row of pixels (bools) whose top edge sits at `top` font units."""
        col = 0
        while col < width:
            if not pixels[col]:
                col += 1
                continue
            start = col
            while col < width and pixels[col]:
                col += 1
            x0, x1 = (start - x_shift) * px, (col - x_shift) * px
            self.pen.moveTo((x0, top - px))
            self.pen.lineTo((x0, top))
            self.pen.lineTo((x1, top))
            self.pen.lineTo((x1, top - px))
            self.pen.closePath()

    def glyph(self):
        return self.pen.glyph()


class BitmapProvider:
    def __init__(self, image, chars, height=8, ascent=7):
        self.img = image.convert('RGBA')
        self.rows = [list(r) for r in chars]
        self.cell_w = self.img.width // len(self.rows[0])
        self.cell_h = self.img.height // len(self.rows)
        self.height, self.ascent = height, ascent
        self.where = {ch: (x, y) for y, r in enumerate(self.rows) for x, ch in enumerate(r) if ch != '\0'}

    def glyph(self, ch):
        if ch not in self.where:
            return None
        cx, cy = self.where[ch]
        cell = self.img.crop((cx * self.cell_w, cy * self.cell_h, (cx + 1) * self.cell_w, (cy + 1) * self.cell_h))
        alpha = cell.getchannel('A').load()
        rows = [[alpha[x, y] > 0 for x in range(self.cell_w)] for y in range(self.cell_h)]
        inked = [x for x in range(self.cell_w) if any(r[x] for r in rows)]
        scale = self.height / self.cell_h
        width = (max(inked) + 1) if inked else 0
        advance = int(0.5 + width * scale) + 1
        px = UNIT * self.height // self.cell_h
        g = Rect()
        for y, r in enumerate(rows):
            g.row(r, self.cell_w, self.ascent * UNIT - y * px, px)
        return g.glyph(), advance * UNIT


class UnihexProvider:
    """GNU Unifont .hex: 'XXXX:' + 32 hex digits (8 px wide) or 64 (16 px wide), 16 rows."""

    def __init__(self, zip_bytes, wanted, overrides=()):
        self.bits, self.overrides = {}, overrides
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
            for name in z.namelist():
                if not name.endswith('.hex'):
                    continue
                for line in z.read(name).decode('ascii').splitlines():
                    cp_hex, _, data = line.partition(':')
                    cp = int(cp_hex, 16)
                    if cp in wanted and cp not in self.bits:
                        self.bits[cp] = data

    def glyph(self, ch):
        data = self.bits.get(ord(ch))
        if not data:
            return None
        width = len(data) * 4 // 16
        n = int(data, 16)
        rows = [[bool(n >> ((15 - y) * width + (width - 1 - x)) & 1) for x in range(width)] for y in range(16)]
        inked = [x for x in range(width) if any(r[x] for r in rows)]
        if not inked:
            return None
        left, right = min(inked), max(inked)
        for lo, hi, l_, r_ in self.overrides:
            if lo <= ord(ch) <= hi:
                left, right = l_, r_
        px = UNIT // 2  # 16 rows drawn 8 units tall
        g = Rect()
        for y, r in enumerate(rows):
            g.row(r, width, 7 * UNIT - y * px, px, x_shift=left)
        return g.glyph(), (right - left + 1) * px + UNIT


def providers(jar, pack, unifont_zip, unifont_json, chars):
    """The game's provider chain; pack(path) may override jar(path) for atlas textures."""
    chain = []
    default = json.loads(jar('assets/minecraft/font/include/default.json'))
    for p in default['providers']:
        if p['type'] != 'bitmap':
            continue
        tex = p['file'].split(':')[-1]
        raw = pack(f'assets/minecraft/textures/{tex}') or jar(f'assets/minecraft/textures/{tex}')
        chain.append(BitmapProvider(Image.open(io.BytesIO(raw)), p['chars'], p.get('height', 8), p['ascent']))
    for p in json.loads(unifont_json)['providers']:
        if p.get('filter', {}).get('jp'):
            continue  # the Japanese variant is opt-in
        overrides = [(ord(o['from']), ord(o['to']), o['left'], o['right']) for o in p.get('size_overrides', [])]
        chain.append(UnihexProvider(unifont_zip, {ord(c) for c in chars}, overrides))
    return chain


def build_font(chain, chars, out_path, family='Minecraft Codex'):
    glyphs, metrics, cmap = {'.notdef': TTGlyphPen(None).glyph()}, {'.notdef': (4 * UNIT, 0)}, {}
    missing = []
    for ch in sorted(set(chars) | {chr(c) for c in range(32, 127)}):
        cp = ord(ch)
        if cp < 32:
            continue
        name = f'uni{cp:04X}' if cp <= 0xFFFF else f'u{cp:05X}'
        if ch == ' ':
            found = (TTGlyphPen(None).glyph(), 4 * UNIT)
        else:
            found = next((g for g in (p.glyph(ch) for p in chain) if g), None)
        if not found:
            missing.append(ch)
            continue
        glyphs[name], metrics[name] = found[0], (found[1], 0)
        cmap[cp] = name

    fb = FontBuilder(8 * UNIT, isTTF=True)
    fb.setupGlyphOrder(list(glyphs))
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    glyf = fb.font['glyf']
    fb.setupHorizontalMetrics({n: (metrics[n][0], glyf[n].xMin if glyf[n].numberOfContours else 0) for n in glyphs})
    fb.setupHorizontalHeader(ascent=8 * UNIT, descent=-UNIT)
    fb.setupNameTable({'familyName': family, 'styleName': 'Regular'})
    fb.setupOS2(sTypoAscender=8 * UNIT, sTypoDescender=-UNIT, usWinAscent=10 * UNIT, usWinDescent=UNIT)
    fb.setupPost()
    fb.font.flavor = 'woff'
    fb.font.save(out_path)
    return len(cmap), missing
