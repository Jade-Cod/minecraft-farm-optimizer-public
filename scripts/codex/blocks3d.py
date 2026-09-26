"""Render block items the way the inventory shows them: a small isometric box.

The inventory camera looks down 30° and turned 45°, so the top face is a
rhombus half as tall as it is wide and the side edges are ~0.61x the width.
Visible faces: top, south (left) and east (right), shaded 1.0 / 0.8 / 0.6.
Drawn at 4x and box-filtered down to 64x64 so edges stay clean.
"""
from PIL import Image

SIZE = 64
SS = 4  # supersampling factor

# stem -> textures (block/ paths) and shape. 'front' is shown on the left (south) face.
MODELS = {
    'cactus': {'top': 'cactus_top', 'side': 'cactus_side'},
    'dirt': {'all': 'dirt'}, 'sand': {'all': 'sand'}, 'stone': {'all': 'stone'},
    'stone_bricks': {'all': 'stone_bricks'}, 'ice': {'all': 'ice'}, 'sponge': {'all': 'sponge'},
    'magma_block': {'all': 'magma'}, 'soul_sand': {'all': 'soul_sand'}, 'glass': {'all': 'glass'},
    'slime_block': {'all': 'slime_block'}, 'coal_block': {'all': 'coal_block'}, 'obsidian': {'all': 'obsidian'},
    'sea_lantern': {'all': 'sea_lantern'}, 'glowstone': {'all': 'glowstone'}, 'end_stone': {'all': 'end_stone'},
    'redstone_lamp': {'all': 'redstone_lamp'}, 'red_concrete': {'all': 'red_concrete'},
    'yellow_concrete': {'all': 'yellow_concrete'}, 'lime_concrete': {'all': 'lime_concrete'},
    'magenta_glazed_terracotta': {'all': 'magenta_glazed_terracotta'}, 'chorus_flower': {'all': 'chorus_flower'},
    'scaffolding': {'top': 'scaffolding_top', 'side': 'scaffolding_side'},
    'tnt': {'top': 'tnt_top', 'side': 'tnt_side'},
    'piston': {'top': 'piston_top', 'side': 'piston_side'},
    'oak_log': {'top': 'oak_log_top', 'side': 'oak_log'},
    'jungle_log': {'top': 'jungle_log_top', 'side': 'jungle_log'},
    'observer': {'top': 'observer_top', 'side': 'observer_side', 'front': 'observer_front'},
    'dispenser': {'top': 'furnace_top', 'side': 'furnace_side', 'front': 'dispenser_front'},
    'smooth_stone_slab': {'top': 'smooth_stone', 'side': 'smooth_stone_slab_side', 'box': (1, 0.5, 1)},
    'stone_button': {'all': 'stone', 'box': (6 / 16, 4 / 16, 4 / 16), 'lift': 6 / 16},  # inventory model: 6x4x4, mid-height
    'beacon': {'all': 'glass', 'inner': 'beacon'},
    'spawner': {'all': 'spawner'},
}


def _affine(img, origin, u_vec, v_vec, tex, crop):
    """Paint `tex` (region `crop` in texture pixels) onto the parallelogram origin + a*u_vec + b*v_vec."""
    (ox, oy), (ux, uy), (vx, vy) = origin, u_vec, v_vec
    det = ux * vy - uy * vx
    if abs(det) < 1e-9:
        return
    x0, y0, x1, y1 = crop
    su, sv = (x1 - x0), (y1 - y0)
    # output (x, y) -> (a, b) -> texture (x0 + a*su, y0 + b*sv)
    ia, ib, ic, id_ = vy / det, -vx / det, -uy / det, ux / det
    coeffs = (ia * su, ib * su, x0 - (ia * ox + ib * oy) * su,
              ic * sv, id_ * sv, y0 - (ic * ox + id_ * oy) * sv)
    face = tex.transform(img.size, Image.AFFINE, coeffs, resample=Image.NEAREST)
    # transform() samples outside `crop` too; keep only the parallelogram
    mask = Image.new('L', img.size, 0)
    from PIL import ImageDraw
    pts = [origin, (ox + ux, oy + uy), (ox + ux + vx, oy + uy + vy), (ox + vx, oy + vy)]
    ImageDraw.Draw(mask).polygon(pts, fill=255)
    face.putalpha(Image.composite(face.getchannel('A'), Image.new('L', img.size, 0), mask))
    img.alpha_composite(face)


def _shade(tex, k):
    r, g, b, a = tex.split()
    return Image.merge('RGBA', [c.point(lambda v: int(v * k)) for c in (r, g, b)] + [a])


def render(stem, texture):
    """texture(name) -> 16x16 RGBA PIL image for block/<name>."""
    m = MODELS[stem]
    top = texture(m.get('top', m.get('all')))
    side = texture(m.get('side', m.get('all')))
    front = texture(m['front']) if 'front' in m else side
    if 'inner' in m:  # beacon: the glass shell over its inner block
        inner = texture(m['inner'])
        top, side, front = (Image.alpha_composite(inner, t) for t in (top, side, front))
    w, h, d = m.get('box', (1, 1, 1))
    y0 = m.get('lift', 0)

    N = SIZE * SS
    W = 56 * SS                 # full-cube width on screen
    V = 0.612 * W               # full-cube vertical edge
    cx, top_y = N / 2, (N - (W / 2 + V)) / 2

    def P(x, y, z):  # block space (x east, y up, z south; 0..1) -> screen
        return (cx + (x - z) * W / 2, top_y + (x + z) * W / 4 + (1 - y) * V)

    x0, x1 = 0.5 - w / 2, 0.5 + w / 2
    z0, z1 = 0.5 - d / 2, 0.5 + d / 2
    y1 = y0 + h
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))

    def face(corner, u_end, v_end, tex, crop, k):
        o = P(*corner)
        a, b = P(*u_end), P(*v_end)
        _affine(img, o, (a[0] - o[0], a[1] - o[1]), (b[0] - o[0], b[1] - o[1]), _shade(tex, k), crop)

    t = 16
    # south face (left): u along +x, v down
    face((x0, y1, z1), (x1, y1, z1), (x0, y0, z1), front, (x0 * t, (1 - y1) * t, x1 * t, (1 - y0) * t), 0.8)
    # east face (right): u along -z, v down
    face((x1, y1, z1), (x1, y1, z0), (x1, y0, z1), side, ((1 - z1) * t, (1 - y1) * t, (1 - z0) * t, (1 - y0) * t), 0.6)
    # top face: u along +x, v along +z
    face((x0, y1, z0), (x1, y1, z0), (x0, y1, z1), top, (x0 * t, z0 * t, x1 * t, z1 * t), 1.0)
    return img.resize((SIZE, SIZE), Image.BOX)
