"""Build the city texture atlases from the source sheets in textures/city-src.

Detects each sheet's tile grid (dark or light separator lines), crops the tiles
used by the city, and packs them into textures/city-*.jpg with wrap-around
gutters so tiling and mipmaps stay seamless. Also writes js/cityTiles.js.

Run from the mech/ folder:  python3 tools/build_city_atlas.py
"""
import json, os, numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'textures', 'city-src') + '/'
OUT = os.path.join(ROOT, 'textures') + '/'

# key: (file, cols, rows, separator kind)
SHEETS = {
  'walls':   ('walls.jpg', 8, 8, 'dark'),
  'asphalt': ('asphalt.jpg', 8, 8, 'dark'),
  'paveA':   ('paveA.jpg', 6, 6, 'dark'),
  'office':  ('office.jpg', 5, 5, 'light'),
  'asphB':   ('asphB.jpg', 5, 5, 'light'),
  'street':  ('street.jpg', 7, 7, 'dark'),
  'facade':  ('facade.jpg', 6, 5, 'light'),
  'roof':    ('roof.jpg', 6, 6, 'dark'),
  'shop':    ('shop.jpg', 6, 6, 'dark'),
  'grass':   ('grass.jpg', 6, 6, 'dark'),
  'paveB':   ('paveB.jpg', 6, 6, 'dark'),
  'planter': ('planter.jpg', 5, 5, 'dark'),
}

def seps(img, n, axis, kind):
    g = np.asarray(img.convert('L'), dtype=np.float32)
    mask = (g < 45) if kind == 'dark' else (g > 215)
    frac = mask.mean(axis=0 if axis == 'x' else 1)  # per column (x) or per row (y)
    L = len(frac); cell = L / n
    cuts = []
    for k in range(1, n):
        lo, hi = int(k * cell - cell * 0.32), int(k * cell + cell * 0.32)
        seg = frac[lo:hi]
        c = lo + int(np.argmax(seg))
        # extend over the separator run
        thr = max(0.5, frac[c] * 0.6)
        a = c
        while a > 0 and frac[a - 1] >= thr: a -= 1
        b = c
        while b < L - 1 and frac[b + 1] >= thr: b += 1
        cuts.append((a, b))
    # outer borders
    a = 0
    while a < L - 1 and frac[a] >= 0.5: a += 1
    b = L - 1
    while b > 0 and frac[b] >= 0.5: b -= 1
    edges = [a] + [x for ab in cuts for x in ab] + [b]
    # cells: (start, end) inclusive-exclusive
    return [(edges[0], cuts[0][0])] + [(cuts[i][1] + 1, cuts[i + 1][0]) for i in range(len(cuts) - 1)] + [(cuts[-1][1] + 1, edges[-1] + 1)]


src, cells = {}, {}
for key, (f, nc, nr, kind) in SHEETS.items():
    im = Image.open(SRC + f).convert('RGB')
    src[key] = im
    cells[key] = {'cols': seps(im, nc, 'x', kind), 'rows': seps(im, nr, 'y', kind)}

def rc(rows, cols):
    return [(r, c) for r in rows for c in cols]

# (sheet, [(row, col)], inset px)
ATLASES = {
  'facade': dict(content=240, pad=8, cols=8, quality=86, picks=[
    ('office', rc(range(5), range(5)), 4),
    ('facade', rc(range(5), range(6)), 4),
    ('shop', rc(range(5), range(6)), 4),
  ]),
  'surface': dict(content=208, pad=8, cols=9, quality=84, picks=[
    ('walls', rc(range(8), range(8)), 5),
    ('roof', rc(range(6), range(6)), 4),
  ]),
  'ground': dict(content=208, pad=8, cols=9, quality=84, picks=[
    ('asphB', rc(range(5), range(5)), 4),
    ('asphalt', [(0, 0), (0, 2), (0, 4), (0, 7), (1, 0), (1, 1), (1, 4), (1, 7)]
               + rc([2, 3], range(8)) + [(4, c) for c in range(6)] + [(5, 0), (5, 2), (6, 0), (6, 4), (6, 6)], 5),
    ('street', rc([2, 3], range(7)), 5),
    ('paveA', [(0, 0), (0, 2), (0, 3), (0, 5), (1, 0), (1, 3), (1, 4), (1, 5), (2, 2), (2, 3), (3, 2), (4, 2), (4, 5), (5, 4)], 5),
    ('paveB', rc([0, 1], range(6)) + [(2, 0), (2, 3), (2, 5), (3, 0), (3, 2), (3, 3), (3, 4), (3, 5), (5, 0), (5, 1), (5, 2)], 5),
    ('grass', [(0, 0), (0, 1), (0, 2), (0, 3), (1, 1), (1, 4), (1, 5), (2, 3), (3, 4), (3, 5), (4, 0), (5, 3)], 4),
    ('planter', [(0, 0), (0, 2), (1, 1), (2, 2), (2, 0), (4, 0)], 18),
  ]),
}

manifest = {'atlases': {}, 'tiles': {}}
for name, A in ATLASES.items():
    C, pad, ncols = A['content'], A['pad'], A['cols']
    cell = C + 2 * pad
    tiles = []
    for sheet, picks, inset in A['picks']:
        cols, rows = cells[sheet]['cols'], cells[sheet]['rows']
        for (r, c) in picks:
            x0, x1 = cols[c]; y0, y1 = rows[r]
            crop = src[sheet].crop((x0 + inset, y0 + inset, x1 - inset, y1 - inset))
            aspect = crop.width / crop.height
            t = np.asarray(crop.resize((C, C), Image.LANCZOS))
            t = np.pad(t, ((pad, pad), (pad, pad), (0, 0)), mode='wrap')
            tiles.append((f'{sheet}{r}{c}', t, round(aspect, 3)))
    nrows = (len(tiles) + ncols - 1) // ncols
    W, H = ncols * cell, nrows * cell
    atlas = np.zeros((H, W, 3), np.uint8)
    for i, (tname, t, aspect) in enumerate(tiles):
        col, row = i % ncols, i // ncols
        atlas[row * cell:(row + 1) * cell, col * cell:(col + 1) * cell] = t
        manifest['tiles'][tname] = [name, i, aspect]
    Image.fromarray(atlas).save(OUT + f'city-{name}.jpg', quality=A['quality'], optimize=True, progressive=True)
    manifest['atlases'][name] = dict(url=f'textures/city-{name}.jpg', w=W, h=H, cell=cell, pad=pad, content=C, cols=ncols)
    print(name, len(tiles), 'tiles', W, 'x', H)

js = '// Generated from the city texture sheets: atlas layouts and where each tile sits.\n'
js += '// Tile names are <sheet><row><col> in the original sheet; the value is [atlas, cell index, source aspect].\n'
js += 'export const ATLASES = ' + json.dumps(manifest['atlases'], indent=2) + ';\n\n'
js += 'export const TILES = {\n'
for k, v in manifest['tiles'].items():
    js += f"  {k}: ['{v[0]}', {v[1]}, {v[2]}],\n"
js += '};\n'
open(os.path.join(ROOT, 'js', 'cityTiles.js'), 'w').write(js)
