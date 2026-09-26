"""Build frontend/codex.json for the Codex pages (Kits, Crates, Chat Tags).

Sources:
  * the wiki (labs-mc.com MediaWiki API): kits, crates not captured in-game,
    custom enchant descriptions, the 2022 event tags;
  * in-game GUI captures (see capture.py), passed as a folder of .jsonl files.
    Screens are recognised by their titles, so file names don't matter. The
    captures stay out of git: they also record chat.

Usage (needs Pillow and fontTools):
  python3 scripts/codex/build_codex.py --captures DIR [--pack PACK.zip] [--fetch-icons]

--pack          the resource pack whose look the site copies; its textures and
                font atlases win over the game's.
--launcher, --mc-version
                the installed game (PrismLauncher). Its client jar and assets give
                vanilla textures and the full font chain, which becomes
                frontend/fonts/minecraft.woff (mcfont.py).
--fetch-icons   create any icon the site lacks: flat item sprites, and 3D
                inventory renders of blocks under icons/block/ (blocks3d.py).
                Textures come from the pack, else the installed game, else the
                vanilla 1.21.5 mirror (InventivetalentDev/minecraft-assets).
"""
import argparse
import datetime as dt
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from capture import (TAG_BULLET, bracket_runs, gui_items, lore_lines, plain, screens,  # noqa: E402
                     seg_text, segs, trim_runs)
import blocks3d  # noqa: E402
import mcfont  # noqa: E402
from icons import BLOCKS, ICON_RULES  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ICONS = os.path.join(ROOT, 'frontend', 'icons')
OUT = os.path.join(ROOT, 'frontend', 'codex.json')
FONT_OUT = os.path.join(ROOT, 'frontend', 'fonts', 'minecraft.woff')
CHAT_PREVIEW_CHARS = '✦'  # codex.js draws Master prestige ranks as [✦ Rank ✦]
WIKI_API = 'https://labs-mc.com/w/api.php'
TEXTURES = 'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21.5/assets/minecraft/textures/'
CHEM = ['Junky', 'Intern', 'Trainee', 'Assistant', 'Technician', 'Analyst', 'Engineer',
        'Bioengineer', 'Chemist', 'Biochemist', 'Alchemist', 'Pharmacologist', 'Director']
COP = ['Informant', 'Recruit', 'Cadet', 'Officer', 'Detective', 'Corporal', 'Sergeant',
       'Lieutenant', 'Colonel', 'Commander', 'DeputyChief', 'Chief', 'Commissioner']
RARITIES = ['Exceedingly Rare', 'Super Rare', 'Very Rare', 'Rare', 'Uncommon', 'Common']

needed_icons = set()


# ── Wiki ─────────────────────────────────────────────────────────────────────

def fetch(url, timeout=20):
    """GET with a named User-Agent: the wiki's Cloudflare rejects Python's default one."""
    req = urllib.request.Request(url, headers={'User-Agent': 'mclabs-tools-codex-build/1.0'})
    return urllib.request.urlopen(req, timeout=timeout)


def wiki_text(title):
    q = urllib.parse.urlencode({'action': 'query', 'prop': 'revisions', 'rvprop': 'content',
                                'titles': title, 'format': 'json', 'formatversion': 2})
    with fetch(f'{WIKI_API}?{q}', timeout=20) as r:
        return json.load(r)['query']['pages'][0]['revisions'][0]['content']


def split_top(s):
    """Split on commas that are not inside parentheses."""
    out, depth, cur = [], 0, ''
    for ch in s:
        depth += ch == '('
        depth -= ch == ')'
        if ch == ',' and depth == 0:
            out.append(cur)
            cur = ''
        else:
            cur += ch
    out.append(cur)
    return [x.strip() for x in out if x.strip()]


def wiki_tables(text):
    """Yield (header cell, rows) for each {| ... |} table; rows are lists of cell strings."""
    for m in re.finditer(r'\{\|.*?\n\|\}', text, re.S):
        blocks = m.group(0).split('\n|-')
        head = re.search(r'colspan="\d"[^|]*\|\s*(.+)', m.group(0))
        rows = []
        for b in blocks[1:]:
            cells = re.split(r'\n\||\|\|', re.sub(r'style="[^"]*"\s*\|', '', b))
            cells = [c.strip() for c in cells[1:] if c.strip() and c.strip() != '}']
            rows.append(cells)
        yield (head.group(1).strip() if head else ''), rows


# ── Icons ────────────────────────────────────────────────────────────────────

def have_icon(stem):
    return os.path.exists(os.path.join(ICONS, stem + '.png'))


def icon_for_name(name):
    """Best icon for an item known only by its display name (kits, wiki crates)."""
    n = name.lower()
    for pat, stem in ICON_RULES:
        if re.search(pat, n):
            needed_icons.add(stem)
            return stem
    for key in sorted(BLOCKS, key=len, reverse=True):
        if key in n:
            needed_icons.add(BLOCKS[key])
            return BLOCKS[key]
    return None


def icon_for_id(item_id, name):
    """Captured items carry their real item id, which is the icon name (blocks get the 3D render)."""
    stem = item_id.split(':')[-1]
    if stem in blocks3d.MODELS:
        stem = 'block/' + stem
    needed_icons.add(stem)
    return stem


def read_zip(z, path):
    try:
        return z.read(path)
    except KeyError:
        return None


class Game:
    """Assets the way the player's game sees them: resource pack first, then the installed
    client (jar + asset index), then the vanilla 1.21.5 mirror if no install is found."""

    def __init__(self, pack=None, launcher=None, version=None):
        self.pack = zipfile.ZipFile(pack) if pack else None
        self.jar = self.assets = None
        if launcher and version:
            jar = os.path.join(launcher, 'libraries/com/mojang/minecraft', version, f'minecraft-{version}-client.jar')
            meta = os.path.join(launcher, 'meta/net.minecraft', f'{version}.json')
            if os.path.exists(jar) and os.path.exists(meta):
                self.jar = zipfile.ZipFile(jar)
                index_id = json.load(open(meta))['assetIndex']['id']
                self.assets = (launcher, json.load(open(os.path.join(launcher, 'assets/indexes', f'{index_id}.json')))['objects'])

    def pack_file(self, path):
        return read_zip(self.pack, path) if self.pack else None

    def jar_file(self, path):
        return read_zip(self.jar, path) if self.jar else None

    def asset(self, name):
        """A hashed game asset such as minecraft/font/unifont.zip."""
        launcher, objects = self.assets
        h = objects[name]['hash']
        with open(os.path.join(launcher, 'assets/objects', h[:2], h), 'rb') as f:
            return f.read()

    def raw(self, path):
        """path like 'item/bow' -> (png bytes, source) or (None, None)."""
        full = f'assets/minecraft/textures/{path}.png'
        for source, data in (('pack', self.pack_file(full)), ('game', self.jar_file(full))):
            if data:
                return data, source
        if self.jar:
            return None, None
        try:
            return fetch(TEXTURES + path + '.png', timeout=15).read(), 'vanilla mirror'
        except urllib.error.HTTPError:
            return None, None

    def image(self, path):
        """16x16 RGBA; animated strips keep their first frame."""
        from PIL import Image
        raw, _ = self.raw(path)
        if raw is None:
            raise FileNotFoundError(path)
        im = Image.open(io.BytesIO(raw)).convert('RGBA')
        im = im.crop((0, 0, im.width, im.width))
        return im if im.width == 16 else im.resize((16, 16), Image.NEAREST)

    def font_chain(self, chars):
        return mcfont.providers(self.jar_file, self.pack_file, self.asset('minecraft/font/unifont.zip'),
                                self.asset('minecraft/font/include/unifont.json'), chars)


def fetch_icons(stems, tex):
    """Create missing icons: 3D renders for block/*, 16x16 sprites (runtime tints applied) otherwise."""
    from PIL import Image, ImageChops
    tint = {'leather_horse_armor': '#a06540', 'short_grass': '#79c05a'}
    sprite = {'sunflower': 'block/sunflower_front', 'enchanted_golden_apple': 'item/golden_apple'}  # item models that borrow a texture
    for stem in sorted(stems):
        dest = os.path.join(ICONS, stem + '.png')
        if stem.startswith('block/'):
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            blocks3d.render(stem[6:], lambda name: tex.image('block/' + name)).save(dest)
            print(f'  + icons/{stem}.png  (3D)')
            continue
        for path in ([sprite[stem]] if stem in sprite else []) + [f'item/{stem}', f'item/{stem}_00', f'block/{stem}']:
            raw, source = tex.raw(path)
            if raw:
                break
        else:
            print(f'  no texture found for {stem}')
            continue
        im = tex.image(path)
        if stem in tint:
            rgb = tuple(int(tint[stem][i:i + 2], 16) for i in (1, 3, 5)) + (255,)
            tinted = ImageChops.multiply(im, Image.new('RGBA', im.size, rgb))
            tinted.putalpha(im.getchannel('A'))
            im = tinted
        im.save(dest)
        print(f'  + icons/{stem}.png  ({source} {path})')


def fetch_wiki_image(name):
    from PIL import Image
    q = urllib.parse.urlencode({'action': 'query', 'titles': f'File:{name}', 'prop': 'imageinfo',
                                'iiprop': 'url', 'format': 'json', 'formatversion': 2})
    with fetch(f'{WIKI_API}?{q}') as r:
        url = json.load(r)['query']['pages'][0]['imageinfo'][0]['url']
    return Image.open(io.BytesIO(fetch(url).read())).convert('RGBA')


def fetch_master_tag_images():
    """Cut each row of the wiki's master-tag screenshots into its own image, background removed."""
    os.makedirs(os.path.join(ICONS, 'tags'), exist_ok=True)
    for file, (prefix, _, names) in MASTER_TAGS.items():
        im = fetch_wiki_image(file)
        bg = im.getpixel((0, 0))[:3]
        far = lambda p, limit: sum(abs(a - b) for a, b in zip(p[:3], bg)) > limit  # noqa: E731
        rows = [y for y in range(im.height) if any(far(im.getpixel((x, y)), 30) for x in range(im.width))]
        bands = []
        for y in rows:
            if bands and y == bands[-1][1] + 1:
                bands[-1][1] = y
            else:
                bands.append([y, y])
        if len(bands) != len(names):
            print(f'  {file}: found {len(bands)} rows, expected {len(names)}; skipped')
            continue
        for (y0, y1), name in zip(bands, names):
            band = im.crop((0, y0, im.width, y1 + 1))
            cols = [x for x in range(band.width) if any(far(band.getpixel((x, y)), 30) for y in range(band.height))]
            band = band.crop((min(cols), 0, max(cols) + 1, band.height))
            px = band.load()
            for y in range(band.height):
                for x in range(band.width):
                    if not far(px[x, y], 25):
                        px[x, y] = (0, 0, 0, 0)
            band.save(os.path.join(ICONS, 'tags', f'{prefix}-{letters(name)}.png'))
        print(f'  + icons/tags/{prefix}-*.png  ({len(names)} tags)')


def fetch_legacy_tag_images(tags):
    """The 2022 event tags exist only as wiki screenshots; key out their slate background."""
    os.makedirs(os.path.join(ICONS, 'tags'), exist_ok=True)
    for t in tags:
        dest = os.path.join(ICONS, 'tags', t['img'] + '.png')
        if os.path.exists(dest):
            continue
        im = fetch_wiki_image(f'Tag_{t["img"]}.png')
        px = im.load()
        for y in range(im.height):
            for x in range(im.width):
                r_, g, b, _ = px[x, y]
                if abs(r_ - 91) <= 6 and abs(g - 114) <= 6 and abs(b - 155) <= 6:
                    px[x, y] = (0, 0, 0, 0)
        im.save(dest)
        print(f'  + icons/tags/{t["img"]}.png')


# ── Kits (wiki) ──────────────────────────────────────────────────────────────

def parse_item(raw):
    raw = raw.replace("''", '').strip()
    m = re.match(r'^(\d+)x\s+(.*)$', raw)
    count, rest = (int(m.group(1)), m.group(2)) if m else (1, raw)
    em = re.match(r'^(.*?)\s*\((.*)\)\s*$', rest)
    name, detail = (em.group(1), em.group(2)) if em else (rest, '')
    ench = split_top(detail) if re.search(r'[A-Z][a-z]+ \d|[IVX]$', detail) else []
    return {'n': name.strip(), 'c': count, 'e': ench, 'note': '' if ench else detail, 'icon': icon_for_name(name)}


def parse_unlock(s):
    s = s.strip()
    if 'Store Rank' in s:
        return {'track': 'store', 'label': s.replace(' Store Rank', ''), 'tier': 0, 'rank': 0}
    if s.startswith('Default'):
        return {'track': 'chem', 'label': 'Everyone', 'tier': 0, 'rank': 0}
    tier, name = 0, s
    if s.startswith('Master Prestige '):
        tier, name = 99, s[len('Master Prestige '):]
    elif s.startswith('Prestige '):
        tier, name = int(s.split()[1]), ' '.join(s.split()[2:])
    track = 'cop' if name in COP else 'chem'
    ranks = COP if track == 'cop' else CHEM
    return {'track': track, 'label': s, 'tier': tier, 'rank': ranks.index(name) if name in ranks else 0}


def parse_kits(text):
    kits, group = [], 'main'
    for block in text.split('\n|-'):
        if 'Store Ranks' in block:
            group = 'store'
        if 'Cop Brewing Kits' in block:
            group = 'brewing'
        cells = [re.sub(r'^style="[^"]*"\s*\|\s*', '', c.strip()) for c in block.split('\n|')[1:]]
        if len(cells) != 4 or cells[0] == 'Rank':
            continue
        rank_cell, name, items, cooldown = cells
        if name == 'BoatsAndHoes':  # the wiki writes this one as prose
            parts = [f'{m} Hoe' for m in ['Netherite', 'Diamond', 'Iron', 'Golden', 'Stone', 'Wooden']] + \
                    [f'{w} Boat' for w in ['Oak', 'Spruce', 'Birch', 'Jungle', 'Acacia', 'Dark Oak']]
        else:
            parts = split_top(items.replace('<br />', ', '))
        kits.append({'name': name, 'group': group, 'cooldown': cooldown,
                     'unlocks': [parse_unlock(u) for u in rank_cell.split('<br />')],
                     'items': [parse_item(p) for p in parts]})
    return kits


# ── Crates ───────────────────────────────────────────────────────────────────

WIKI_KEYS = {  # from each crate's in-game Crate Info
    'Voter Crate': 'Vote with /vote, or buy keys with Vote Tokens in /vshop',
    'Deluxe Voter Crate': 'A Voter Crate prize, convert Voter Keys with /convert, or buy keys with Vote Tokens in /vshop',
    'Prestige Crate': 'Earned by ranking up and prestiging',
}
CRATE_NOTES = {  # seen when opening one (the "Choose a reward!" screen)
    'Voter Crate': 'Each key rolls 3 prizes and you pick the one you want.',
    'Deluxe Voter Crate': 'Each key rolls 3 prizes and you pick the one you want.',
}
CRATE_GROUP = {'Voter Crate': 'Vote', 'Deluxe Voter Crate': 'Vote', 'Prestige Crate': 'Prestige',
               'Tool Crate': 'Store', 'Favourites Crate': 'Store', 'Spawner Crate': 'Store',
               'Summer Crate': 'Seasonal', 'Halloween Crate': 'Seasonal', 'Holiday Crate': 'Seasonal'}


def wiki_crates(text):
    crates = {}
    for head, rows in wiki_tables(text):
        if 'Crate' not in head:
            continue
        items = []
        for cells in rows[1:]:
            if len(cells) < 3:
                continue
            name, desc, odds = cells[0].rstrip(','), cells[1].replace("''", ''), cells[2]
            parts = split_top(desc)
            ench = parts if re.search(r'\b[IVX]+\b', desc) and all(len(x) <= 30 for x in parts) else []
            pct = re.match(r'([\d.]+)%', odds)
            items.append({'n': name, 'd': '' if ench else desc, 'e': ench,
                          'odds': float(pct.group(1)) if pct else None,
                          'rarity': None if pct else odds, 'icon': icon_for_name(name)})
        crates[head] = items
    return crates


def wiki_enchants(text):
    m = re.search(r'==Custom Enchantments==.*?\{\|(.*?)\n\|\}', text, re.S)
    out = {}
    for row in m.group(1).split('\n|-')[2:]:
        cells = [c.strip() for c in re.split(r'\n\|', re.sub(r'style="[^"]*"\s*\|', '', row)) if c.strip()]
        if len(cells) >= 2:
            out[cells[0]] = cells[1].replace("''", '')
    return out


def captured_crate_item(item):
    """A crate item's lore: enchant lines, then ┃-prefixed description paragraphs, Usage, Rarity."""
    ench, paras, usage, rarity, unboxed = [], [[]], '', '', None
    for raw in item.get('lore', []):
        line = plain(raw)
        if not line.startswith('┃'):
            if line.strip():
                ench.append(line.strip())
            continue
        body = line.lstrip('┃').strip()
        if body.startswith('Rarity:'):
            rarity = body.split(':', 1)[1].strip()
        elif m := re.match(r'([\d,]+) unboxed', body):
            unboxed = int(m.group(1).replace(',', ''))
        elif body.startswith('Usage:'):
            usage = body.split(':', 1)[1].strip()
        elif rarity:
            continue  # the rest is the jacked-up odds blurb
        elif body:
            paras[-1].append(body)
        elif paras[-1]:
            paras.append([])
    sentences = [' '.join(p).replace('. of', ' of') for p in paras if p]  # in-game typo: "burst. of"
    desc = ' '.join(s if s[-1] in '.!?' else s + '.' for s in sentences)
    charges = re.search(r'\s*Charges: (\d+)\.?', desc)
    if charges:
        desc = (desc[:charges.start()] + desc[charges.end():]).strip()
    name = plain(item['name']).strip()
    return {'n': name, 'runs': segs(item['name']), 'd': desc, 'e': ench, 'rarity': rarity, 'odds': None, 'usage': usage,
            'unboxed': unboxed, 'charges': int(charges.group(1)) if charges else None,
            'icon': icon_for_id(item['id'], name)}


def captured_odds_item(item):
    """A fixed-odds crate item (Voter, Deluxe Voter, Prestige): stat lines, then '┃ Chance: N%'."""
    ench, usage, desc, odds = [], '', '', None
    for raw in item.get('lore', []):
        line = plain(raw).strip()
        if m := re.search(r'Chance: ([\d.]+)%', line):
            odds = float(m.group(1))
        elif line.startswith('Info:'):
            usage = line.split(':', 1)[1].strip()
        elif line.startswith('Duration:'):
            desc = f"Lasts {line.split(':', 1)[1].strip()}."
        elif line and not line.startswith('┃'):
            ench.append(line)  # enchants, or a potion's effect
    name = plain(item['name']).strip()
    glint = item['id'].endswith('enchanted_golden_apple')  # shimmers in-game without listing enchants
    return {'n': name, 'runs': segs(item['name']), 'c': item.get('count', 1), 'd': desc, 'e': ench,
            'rarity': None, 'odds': odds, 'usage': usage, 'icon': icon_for_id(item['id'], name),
            **({'glint': True} if glint else {})}


def with_wiki_notes(items, wiki_items):
    """The wiki explains what some prizes do; borrow that where its list lines up with the game's."""
    if [i['odds'] for i in items] != [w['odds'] for w in wiki_items]:
        return items
    return [{**i, 'd': i['d'] or w['d']} for i, w in zip(items, wiki_items)]


# ── Tags ─────────────────────────────────────────────────────────────────────

class Tags:
    """Collects tag sections and tags; a tag is shown once per section."""

    def __init__(self):
        self.sections, self.tags, self.seen = [], [], set()

    def section(self, sid, group, name, after=None, **meta):
        """Add a section at the end, or right after section `after` (e.g. to keep events together)."""
        at = next((i + 1 for i, s in enumerate(self.sections) if s['id'] == after), len(self.sections))
        self.sections.insert(at, {'id': sid, 'group': group, 'name': name, **meta})
        return sid

    def add(self, section, runs=None, text=None, **meta):
        text = text or seg_text(runs)
        key = (section, text, meta.get('img'), meta.get('how'))  # two 2022 images both read "[Champion]"
        if key in self.seen:
            return None
        self.seen.add(key)
        tag = {'id': len(self.tags), 'section': section, 'text': text, **({'segs': runs} if runs else {}), **meta}
        self.tags.append(tag)
        return tag


def rank_text(places):
    n = len(places)
    if places[0] == 1 and places[-1] == n:
        return '#1' if n == 1 else f'Top {n}'
    if places[-1] - places[0] == n - 1:
        return f'#{places[0]}–#{places[-1]}'
    return ', '.join(f'#{p}' for p in places)


EVENTS = [  # (section id, name, title pattern, board -> phrase)
    ('investment', 'Investment Week', r'^Top .*Investors',
     lambda b: 'investors overall' if b == 'Top Investors' else 'in ' + b[4:-10]),
    ('runner', 'Runner Week', r'^Weekly Top (Runners|Suppliers)', lambda b: b.replace('Weekly Top ', '').lower()),
    ('clarkour', 'Clarkour Weekend', r'^Clarkour Weekend$', lambda b: 'overall'),
    ('farming', 'Farming Weekend', r'^Top .*Farmers',
     lambda b: 'farmers overall' if b == 'Top Farmers Overall' else b[4:-8] + ' farmers'),
    ('pit', 'Pit Weekend', r'^(All|Depths|Abyss|Void) \| Overall$',
     lambda b: 'overall' if b.startswith('All') else 'in The ' + b.split(' |')[0]),
]


def capture_started(path):
    with open(path, encoding='utf-8') as f:
        first = json.loads(f.readline())
    return dt.datetime.fromisoformat(first['started']) if first.get('type') == 'capture' else None


def parse_events(files, tags):
    """Leaderboard screens -> one section per event, tags with the places that win them."""
    boards = {sid: {'status': '', 'set_to_win': False, 'ends': None, 'tags': {}, 'bonus': {},
                    'unnamed': []} for sid, *_ in EVENTS}
    for path in files:
        started = capture_started(path)
        for title, slots in screens(path):
            base = re.sub(r'\s*\(\d+/\d+\)$', '', title)
            ev = next((e for e in EVENTS if re.search(e[2], base)), None)
            if not ev:
                continue
            b = boards[ev[0]]
            board = base
            for _, it in gui_items(slots):
                nm, lines = plain(it.get('name')).strip(), lore_lines(it)
                if 'Countdown' in nm and not b['status']:
                    b['status'] = ' '.join(l for l in lines if l)
                    if (m := re.search(r'Ends in: (\d+)d:(\d+)h:(\d+)m', b['status'])) and started:
                        d, h, mi = map(int, m.groups())
                        b['ends'] = (started + dt.timedelta(days=d, hours=h, minutes=mi)).date().isoformat()
                if 'arrests' in ' '.join(lines) and ev[0] == 'runner':
                    board = 'Weekly Top Cops'  # this board is titled "Suppliers" in-game but ranks arrests
            for _, it in gui_items(slots):
                nm, lines = plain(it.get('name')).strip(), lore_lines(it)
                b['set_to_win'] |= 'Set to win:' in lines
                m = re.match(r'#(\d+)\. (\S+)$', nm)
                tag_lines = [raw for raw, l in zip(it.get('lore', []), lines) if TAG_BULLET.match(l)]
                if not m:
                    # a rules item (e.g. Clarkour's completion bonus) rather than a leaderboard entry
                    if tag_lines and not any(l.startswith('Your place') for l in lines):
                        first = next(i for i, l in enumerate(lines) if TAG_BULLET.match(l))
                        how = re.sub(r'\s*to also earn:?$|:$', '', ' '.join(l for l in lines[:first] if l))
                        for raw in tag_lines:
                            runs = bracket_runs(raw)
                            b['bonus'].setdefault(seg_text(runs), (runs, how))
                    continue
                place, player = int(m.group(1)), m.group(2)
                if player == 'You':
                    continue
                for raw in tag_lines:
                    runs = bracket_runs(raw)
                    t = b['tags'].setdefault(seg_text(runs), {'runs': runs, 'boards': {}, 'holders': {}})
                    t['boards'].setdefault(board, set()).add(place)
                    t['holders'].setdefault(player, place)
                # Runner Week lists a second prize as just "Exclusive chat tag": it's the board's lower
                # tag (the top 5 also get the #6-10 one), resolved once the whole board is read.
                if any(re.match(r'^[•●]\s+Exclusive\s+chat tag$', l) for l in lines):
                    b['unnamed'].append((board, place, player))
    for sid, name, _, phrase in EVENTS:
        b = boards[sid]
        for board, place, player in b['unnamed']:
            lower = [t for t in b['tags'].values() if board in t['boards'] and place not in t['boards'][board]]
            if len(lower) == 1:
                lower[0]['boards'][board].add(place)
                lower[0]['holders'].setdefault(player, place)
        for t in b['tags'].values():
            t['holders'] = sorted(t['holders'], key=t['holders'].get)
        if not b['tags'] and not b['bonus']:
            continue
        live = ('concluded' not in b['status']) if b['status'] else b['set_to_win']
        tags.section(sid, 'event', name, note='' if live else 'Ended', live=live, ends=b['ends'] if live else None)
        for text, (runs, how) in b['bonus'].items():
            if text not in b['tags']:
                tags.add(sid, runs, how=how)
        for t in b['tags'].values():
            how = ' · '.join(f'{rank_text(sorted(p))} {phrase(bd)}' for bd, p in t['boards'].items())
            tags.add(sid, t['runs'], how=how, holders=None if live else t['holders'])


def chat_lines(path):
    """Styled runs for each line of every captured chat message."""
    with open(path, encoding='utf-8') as f:
        for raw in f:
            r = json.loads(raw)
            if r['type'] != 'chat':
                continue
            line = []
            for run in segs(r['text']):
                for i, part in enumerate(run['t'].split('\n')):
                    if i:
                        yield line
                        line = []
                    if part:
                        line.append({**run, 't': part})
            yield line


PIT_NOUNS = {'Mob': 'mobs', 'Miniboss': 'minibosses', 'Boss': 'bosses'}


def parse_pit_tags(files, tags):
    """The Pit's per-area tag progress (chat): each area's mob, miniboss and boss tags.
    Kill counts only show for tags the player hasn't unlocked yet."""
    areas, area, kind = {}, None, None
    for path in files:
        for runs in chat_lines(path):
            text = seg_text(runs).strip()
            if m := re.match(r'Your tag progress in (.+):$', text):
                area = m.group(1)
                areas.setdefault(area, [])
            elif m := re.match(r'(Mob|Miniboss|Boss) Tags:$', text):
                kind = m.group(1)
            elif text.startswith('[Back to tags'):
                area = kind = None
            elif area and kind and text.startswith('['):
                tag = bracket_runs({'text': '', 'extra': [{'text': r['t'], 'color': r['c'], 'bold': r['b']} for r in runs]})
                goal = re.search(r'\[\d+/(\d+)\]$', text)
                how = f'Kill {int(goal.group(1)):,} {PIT_NOUNS[kind]}' if goal else f'{kind} tag'
                areas[area].append((tag, how))
    for name, found in areas.items():
        sid = 'pit-' + letters(name)
        tags.section(sid, 'pit', name, note='The Pit')
        for runs, how in found:
            tags.add(sid, runs, how=how)


LEGACY_TAGS = [  # the first event tags, from the wiki's Event Tags page (2022)
    ('champion', '[Champion]', 'Won the 1v1 PvP Tournament · June 24, 2022', ['Cthan']),
    ('challenger', '[Challenger]', 'Played in the 1v1 PvP Tournament · June 24, 2022', None),
    ('champion2', '[Champion]', 'Won the 2v2 PvP Tournament · July 8, 2022', None),
    ('challenger2', '[Challenger]', 'Played in the 2v2 PvP Tournament · July 8, 2022', None),
    ('masterangler', '[Master Angler]', 'Top 3 fishers of Fishing Week · July 1–7, 2022', None),
    ('angler', '[Angler]', 'Top 25 fishers of Fishing Week · July 1–7, 2022', None),
]


def parse_tag_crates(files, tags, crates):
    """The four tag crates, plus the Tag Key Crate that rolls which one you open."""
    found, key_odds, key_colors = {}, {}, {}  # colours: each key's name colour, reused for its crate
    for path in files:
        for title, slots in screens(path):
            if title == 'Tag Key Crate':
                for _, it in gui_items(slots):
                    pct = next((re.search(r'([\d.]+)%', l) for l in lore_lines(it) if 'Chance' in l), None)
                    if pct:
                        crate = plain(it['name']).strip().replace(' Key', '')
                        key_odds[crate] = float(pct.group(1))
                        key_colors[crate] = segs(it['name'])[0]['c']
                continue
            m = re.match(r'^(Common|Uncommon|Rare|Very Rare) Tag Crate', title)
            if not m:
                continue
            rarity = m.group(1)
            for _, it in gui_items(slots):
                if not it['id'].endswith('name_tag'):
                    continue
                runs = trim_runs(segs(it['name']), 'Tag')
                pct = next((re.search(r'([\d.]+)%', l) for l in lore_lines(it) if 'Chance' in l), None)
                found.setdefault(rarity, {}).setdefault(seg_text(runs), (runs, float(pct.group(1)) if pct else None))
    if key_odds:
        needed_icons.add('tripwire_hook')
        crates.append({'name': 'Tag Key Crate', 'group': 'Tags', 'source': 'game',
                       'keys': 'Tag Key Crate Keys come from /buy or /bshop',
                       'items': [{'n': f'{k} Key', 'd': 'Opens the ' + k, 'e': [], 'odds': v, 'rarity': None,
                                  'color': key_colors.get(k), 'icon': 'tripwire_hook'} for k, v in key_odds.items()]})
    for rarity in ['Common', 'Uncommon', 'Rare', 'Very Rare']:
        if rarity not in found:
            continue
        name = f'{rarity} Tag Crate'
        chance = next(iter(found[rarity].values()))[1]
        sid = tags.section('crate-' + rarity.lower().replace(' ', '-'), 'crate', name, color=key_colors.get(name),
                           note=f'{chance:g}% each · {key_odds.get(name, 0):g}% of Tag Key rolls')
        ids = [tags.add(sid, runs, how=f'{name} · {chance:g}%')['id'] for runs, _ in found[rarity].values()]
        crates.append({'name': name, 'group': 'Tags', 'source': 'game', 'tagCrate': True, 'color': key_colors.get(name),
                       'chance': chance, 'keyChance': key_odds.get(name),
                       'keys': 'Roll one from a Tag Key Crate Key (/buy or /bshop)', 'tags': ids})


SHOP_PAGES = {'Country Tags': 'Country tags', 'Zodiac Tags': 'Zodiac tags',
              'Dynamic Chems Sold Tags': 'Chems sold', 'Dynamic Stats Tags': 'Your stats'}


def parse_tag_shop(files, tags):
    pages, limited = {}, {}
    for path in files:
        for title, slots in screens(path):
            base = re.sub(r'\s*\(\d+/\d+\)$', '', title)
            if base != 'Tag Shop' and base not in SHOP_PAGES:
                continue
            for _, it in gui_items(slots):
                lines = lore_lines(it)
                if not it['id'].endswith('name_tag'):
                    continue
                runs = trim_runs(segs(it['name']), 'Tag')
                cost = next((int(m.group(1)) for l in lines if (m := re.match(r'Cost: (\d+)', l))), None)
                what = next((l for l in lines if l.startswith('Dynamic ')), '')
                entry = (runs, cost, what, 'Limited time only!' in lines)
                (limited if base == 'Tag Shop' else pages.setdefault(base, {})).setdefault(seg_text(runs), entry)
    if not pages and not limited:
        return
    groups = [('shop-limited', 'Limited time', limited)] + [('shop-' + k.split()[0].lower() + ('-' + k.split()[1].lower() if k.startswith('Dynamic') else ''),
                                                           v, pages.get(k, {})) for k, v in SHOP_PAGES.items()]
    for sid, name, entries in groups:
        if not entries:
            continue
        costs = sorted({e[1] for e in entries.values() if e[1]})
        price = f'{costs[0]}–{costs[-1]} Tag Credits' if len(costs) > 1 else \
            f'{costs[0]} Tag Credits' + (' each' if len(entries) > 1 else '')
        tags.section(sid, 'shop', name, note=f'Tag Shop · {price}')
        for runs, cost, what, _ in entries.values():
            how = (what.replace('Dynamic ', 'Shows your ') + ' · ' if what else '') + f'{cost} Tag Credits'
            tags.add(sid, runs, how=how, cost=cost, dynamic=bool(what))


DYNAMIC_KEYWORDS = {'Fish Caught': 'Fish', 'Distance On Horse': 'By Horse', 'Distance Sprinted': 'Sprinted',
                    'Time Played': 'Days'}


def generic(text):
    """A dynamic tag with the player's own number swapped for ##."""
    return re.sub(r'[\d,.?]+', '##', text, count=1)


def parse_achievements(files, tags, own_tags):
    seen = set()
    for path in files:
        for title, slots in screens(path):
            if title != 'Achievements List':
                continue
            for _, it in gui_items(slots):
                lines = lore_lines(it)
                if 'Reward:' not in lines:
                    continue
                name = re.sub(r'^[✔✘]\s*', '', plain(it['name']).strip())
                reward_raw = it['lore'][lines.index('Reward:') + 1]
                reward = plain(reward_raw).strip()
                if 'Chat Tag' not in reward or (name, reward) in seen:
                    continue
                seen.add((name, reward))
                goal = lines[lines.index('Goal:') + 1] if 'Goal:' in lines else \
                    lines[lines.index('Description:') + 1].replace('You have ', 'Have ') if 'Description:' in lines else ''
                if not tags.sections or tags.sections[-1]['id'] != 'achievements':
                    if not any(s['id'] == 'achievements' for s in tags.sections):
                        tags.section('achievements', 'achievement', 'Achievements', note='/achievements')
                how = f'“{name}”: {goal}'.rstrip()
                if '[' in reward:
                    tags.add('achievements', bracket_runs(reward_raw), how=how)
                    continue
                key = next((v for k, v in DYNAMIC_KEYWORDS.items() if k in reward), None)
                # the player's own copy of the tag, e.g. [11154 Fish]; it must carry a number ([MCFish] doesn't)
                mine = next((t for t in own_tags if key and key in seg_text(t) and re.search(r'[\d?]', seg_text(t))), None)
                if mine:
                    runs = [{**r, 't': generic(r['t'])} if re.search(r'\d|\?', r['t']) else r for r in mine]
                    tags.add('achievements', runs, how=how + ' Shows your total.', dynamic=True)


def parse_vote_rewards(files, tags):
    for path in files:
        for title, slots in screens(path):
            if title != 'Voting Rewards':
                continue
            sid = tags.section('votes', 'vote', 'Voting', note='/vrewards')
            found = {}  # tag text -> (runs, [ways to earn it], dynamic); one tag can have several
            for _, it in gui_items(slots):
                name = plain(it.get('name')).strip()
                for raw, line in zip(it.get('lore', []), lore_lines(it)):
                    if 'Chat Tag' in line:
                        runs = bracket_runs(raw)
                        way = name.lower() if 'Total Votes' in name else name.replace('Monthly Voter', 'monthly voter')
                        found.setdefault(seg_text(runs), (runs, [], 'Dynamic' in line))[1].append(way)
            for runs, ways, dynamic in found.values():
                how = ' or '.join(ways).capitalize()
                tags.add(sid, runs, how=how + (' · shows your vote count in the Spawn world' if dynamic else ''),
                         dynamic=dynamic)
            return


def parse_own_tags(files):
    """The capturing player's /tags list (EternalTags GUI): used to find tags with no known source."""
    own, seen = [], set()
    for path in files:
        for title, slots in screens(path):
            if not title.startswith('EternalTags |'):
                continue
            for _, it in gui_items(slots):
                if it['id'].endswith('name_tag'):
                    runs = trim_runs(segs(it['name']))
                    if seg_text(runs) not in seen:
                        seen.add(seg_text(runs))
                        own.append(runs)
    return own


# Sources Jade confirmed that no capture shows, matched against the player's own /tags list
# by their letters and digits (so "[✵ Curie ✵]" matches "curie").
# The wiki's Ranks page shows the master tags as in-game screenshots, one tag per row, in this order.
MASTER_TAGS = {
    'ChemLordTags.png': ('chemlord', 'Master every Chem prestige, then pick it with /chemlord',
                         ['Chem Lord', 'Mr. White', 'Oppenheimer', 'Bunsen', 'Mendeleev', 'Faraday', 'Curie',
                          'Avogadro', 'Heisenberg', 'Nobel', 'Einstein']),
    'OperatorTags.png': ('operator', 'Master every Cop prestige, then pick it with /operator',
                         ['Operator', 'SecretService', 'KGB', 'AFP', 'MI6', 'RCMP', 'CIA', 'FBI', 'DEA', 'Sheriff']),
}
SUMMER_CHEMPASS_TAGS = ['Beach', 'Bikini', 'Tanned', 'SunBaked', 'LifeGuard', 'Surfer', 'Swimmer', 'Tropical',
                        'Islander', 'IceCream', 'Hot', 'HydroHomie', 'BBQ', 'GrillMaster', 'DayDrinker', 'Tourist',
                        'Solstice', 'Pasty', 'Peaceful', 'Aquatic', 'Aquaholic', 'Pilot', 'Seaman', 'Triton',
                        'MLG', 'PogChamp', 'Savage', 'SWAG',
                        'ChemPass', '25', '50', '75', '100', '125', '150']
SUPPORTER_TAGS = [('Gold', 'Be an MCLabs Gold subscriber')] + \
    [(r, f'Have the {r} store rank') for r in ['VIP', 'VIP+', 'MVP', 'MVP+', 'MVP++']] + \
    [(f, 'Buy the Founder package at map start') for f in ['Founder', 'Founder #44']]
# Fishing Weekend's leaderboard menu is gone, so Jade gave its prizes by hand (holders unknown).
FISHING_WEEKEND = [('Bait Master', 'Top 5 fish caught'), ('Baiter', 'Top 10 fish caught'),
                   ('Shear Skill', 'Top 5 sheep shearers'), ('Sheared', 'Top 10 sheep shearers'),
                   ('Milk Man', 'Top 5 cows milked'), ('Milked', 'Top 10 cows milked'),
                   ('Booty', 'Top 5 sunken treasure found'), ('Buccaneer', 'Top 10 sunken treasure found')]
OTHER_EARNED = [('Raffle', 'Win the weekly raffle'), ('Sponsor', 'Sponsor 4,000 drops to the drop party'),
                ('Scrapper', 'Scrap crate items with /scrap (how many is unknown)')]
# This year's Spleef tournament; Jade placed 3rd and got both, which place gives which isn't known.
SPLEEF_TAGS = ['Spleefd', 'Spleefer']


def numbers_hidden(runs):
    """A dynamic tag with the player's own number shown as ##, e.g. [151 Arrests] -> [## Arrests]."""
    shown = [{**x, 't': re.sub(r'#?\d[\d,]*', '##', x['t'])} for x in runs]
    # digits (and a leading "#") can sit in separate coloured runs; keep exactly one "##" across them
    for i in range(1, len(shown)):
        tail = len(shown[i - 1]['t']) - len(shown[i - 1]['t'].rstrip('#'))
        if tail and shown[i]['t'].startswith('#'):
            shown[i]['t'] = shown[i]['t'].lstrip('#')
            shown[i - 1]['t'] = shown[i - 1]['t'].rstrip('#') + '##'
    return [x for x in shown if x['t']]
# Chat reaction tags show the player's own number; how many reactions each needs isn't known.
REACTION_TAGS = ['Re', 'WPM', 'Reactions']
# Lab Wars placement and veteran tags are left out: there have been ~27 wars, so hundreds of tags.
HIDDEN = re.compile(r'^(labwars|lw[xvi]+vet|labwarrior|rdl$)', re.I)
# Dynamic tags that show the player's own number: (word in the tag, section, how to get it)
DYNAMIC_TAGS = [
    ('Arrests', 'cop', 'Arrest 10 players · shows your arrests'),
    ('Frisks', 'cop', 'Arrest 10 players · shows your frisks'),
    ('Confiscated', 'cop', 'Arrest 10 players · shows how much you have confiscated'),
    ('Keys', 'extras', 'Buy a key in a key round · shows how many keys you have bought'),
]
# Dynamic tags matched by shape: (pattern, how). The wiki shows the crown tag as "[👑 1 👑]".
MINI_EVENT_TAGS = [(r'\[👑 \d+ 👑\]', 'Win your first mini event · shows your mini-event wins'),
                   (r'« ✰ x\d+ »', 'Place top 3 on the weekly leaderboard · shows your number')]
MASTERY_TAGS = [(r'『 Master 』', 'Reach mastery tier 2'),
                (r'『 Tier \d+ 』', 'Reach mastery tier 6 · shows your mastery tier')]
# The Lion's investor tiers (wiki: Stock Market). Ambassador and up each give a chat tag.
INVESTOR_TIERS = ['Ambassador', 'Diamond', 'Palladium', 'Executive', 'Black']


def letters(text):
    return re.sub(r'[^a-z0-9]', '', text.lower())


def add_confirmed_sources(tags, own):
    for prefix, how, names in MASTER_TAGS.values():
        track, command = how.split('every ')[1].split(' prestige')[0], how.rsplit(' ', 1)[-1]
        tags.section(prefix, 'earned', 'Chem Lord' if prefix == 'chemlord' else 'Operator',
                     note=f'Master every {track} prestige · {command}')
        for name in names:
            tags.add(prefix, text=f'[{name}]', img=f'{prefix}-{letters(name)}', how=how)
    by_letters = {letters(seg_text(r)): r for r in own}
    missing = [t for t in INVESTOR_TIERS if letters(t) not in by_letters]
    tags.section('investor', 'earned', 'Investor tiers', layout='rows',
                 note='/sm claim at The Lion' + (f' · {", ".join(missing)} tag not captured yet' if missing else ''))
    for tier in INVESTOR_TIERS:
        if letters(tier) in by_letters:
            tags.add('investor', by_letters[letters(tier)], how=f'Reach the {tier} investor tier')
    if 'premium' in by_letters and any(sec['id'] == 'votes' for sec in tags.sections):
        tags.add('votes', by_letters['premium'], how='Have premium vote rewards')
    # exact text here: "VIP" and "VIP+" differ only by a symbol
    by_text = {seg_text(r).strip('[] '): r for r in own}
    supporter = [(t, how) for t, how in SUPPORTER_TAGS if t in by_text]
    if supporter:
        tags.section('supporter', 'earned', 'Supporter', layout='rows', note='MCLabs store')
        for text, how in supporter:
            tags.add('supporter', by_text[text], how=how)
    fishing = [(by_letters[letters(t)], how) for t, how in FISHING_WEEKEND if letters(t) in by_letters]
    if fishing:
        tags.section('fishing', 'event', 'Fishing Weekend', after='pit', live=False,
                     note="Ended · winners weren't recorded")
        for runs, how in fishing:
            tags.add('fishing', runs, how=how)
    spleef = [by_letters[k] for k in (letters(t) for t in SPLEEF_TAGS) if k in by_letters]
    if spleef:
        tags.section('spleef', 'event', 'Spleef Tournament', after='fishing', live=False, note='2026')
        for runs in spleef:
            tags.add('spleef', runs, how='A prize from the 2026 Spleef Tournament')
    extras = [(by_letters[letters(t)], how) for t, how in OTHER_EARNED if letters(t) in by_letters]
    dynamic = [(r, sec, how) for word, sec, how in DYNAMIC_TAGS for r in own
               if re.fullmatch(rf'\[[\d,]+ {word}\]', seg_text(r))]
    if extras or any(sec == 'extras' for _, sec, _ in dynamic):
        tags.section('extras', 'earned', 'Around the server', layout='rows',
                     note='Raffles, drop parties, key rounds and /scrap')
        for runs, how in extras:
            tags.add('extras', runs, how=how)
    if any(sec == 'cop' for _, sec, _ in dynamic):
        tags.section('cop', 'earned', 'Cop stats', layout='rows', note='Shows your own number')
    for runs, sec, how in dynamic:
        tags.add(sec, numbers_hidden(runs), how=how, dynamic=True)
    reactions = [r for r in own if re.fullmatch(r'\[(re ?#\d+|\d+ ?wpm|[\d,]+ ?reactions)\]', seg_text(r).lower())]
    if reactions:
        tags.section('reactions', 'earned', 'Chat reactions', layout='rows', note='Shows your own number')
        for runs in reactions:
            shown = numbers_hidden(runs)
            text = seg_text(runs)
            what = 'typing speed' if 'WPM' in text else 'reaction count' if 'Reactions' in text else 'own number'
            tags.add('reactions', shown, how=f'Chat reaction tag · shows your {what}', dynamic=True)
    minis = [(r, how) for pattern, how in MINI_EVENT_TAGS for r in own if re.fullmatch(pattern, seg_text(r))]
    if minis:
        tags.section('minievents', 'earned', 'Mini events and leaderboards', layout='rows', note='/mev · /lb')
        for runs, how in minis:
            tags.add('minievents', numbers_hidden(runs), how=how, dynamic=True)
    # Mastery (/mastery): matched on the exact 『 』 text, since a crate tag is also called [Master]
    mastery = [(r, how) for pattern, how in MASTERY_TAGS for r in own if re.fullmatch(pattern, seg_text(r))]
    if mastery:
        tags.section('mastery', 'earned', 'Mastery', layout='rows', after='operator', note='/mastery')
        for runs, how in mastery:
            dynamic = 'Tier' in seg_text(runs)
            tags.add('mastery', numbers_hidden(runs) if dynamic else runs, how=how, dynamic=dynamic)
    summer = {letters(n) for n in SUMMER_CHEMPASS_TAGS}
    tags.section('chempass-summer', 'earned', 'Summer ChemPass', note='Pass rewards and level tags')
    # the pass's own tags, then its levels in order, then the themed rewards
    order = lambda r: (0, 0) if letters(seg_text(r)) == 'chempass' else \
        (1, int(letters(seg_text(r)))) if letters(seg_text(r)).isdigit() else (2, 0)  # noqa: E731
    for runs in sorted((r for r in own if letters(seg_text(r)) in summer), key=order):
        key = letters(seg_text(runs))
        how = f'ChemPass level {key}' if key.isdigit() else 'Summer ChemPass' if key == 'chempass' \
            else 'Summer ChemPass reward'
        tags.add('chempass-summer', runs, how=how)


def build(captures):
    files = sorted(os.path.join(captures, f) for f in os.listdir(captures) if f.endswith('.jsonl'))
    print(f'{len(files)} capture files')

    kits = parse_kits(wiki_text('Kits'))
    crates_text = wiki_text('Crates')
    wiki = wiki_crates(crates_text)

    captured = {}
    for path in files:
        for title, slots in screens(path):
            if title in wiki and title not in captured:
                items = [captured_crate_item(it) for _, it in gui_items(slots)
                         if any('Rarity:' in l for l in lore_lines(it))]
                items = items or with_wiki_notes([captured_odds_item(it) for _, it in gui_items(slots)
                                                  if any('Chance:' in l for l in lore_lines(it))], wiki[title])
                if items:
                    captured[title] = items
    crates = [{'name': name, 'group': CRATE_GROUP.get(name, 'Supply'),
               'source': 'game' if name in captured else 'wiki',
               'keys': WIKI_KEYS.get(name, 'Open with a Crate Key from /buy, /vshop or /bshop'),
               **({'note': CRATE_NOTES[name]} if name in CRATE_NOTES else {}),
               'items': captured.get(name, items)} for name, items in wiki.items()]

    tags = Tags()
    own = parse_own_tags(files)
    parse_events(files, tags)
    tags.section('legacy', 'event', '2022 events', note='PvP tournaments and Fishing Week', live=False)
    for img, text, how, holders in LEGACY_TAGS:
        tags.add('legacy', text=text, img=img, how=how, **({'holders': holders} if holders else {}))
    parse_pit_tags(files, tags)
    parse_tag_crates(files, tags, crates)
    parse_tag_shop(files, tags)
    parse_achievements(files, tags, own)
    parse_vote_rewards(files, tags)
    add_confirmed_sources(tags, own)

    # compare letters only, so "[✵ Curie ✵]" in the /tags list matches the wiki's "[Curie]"
    # Tags with no letters left (e.g. [👑 29 👑] -> "") must match on their exact text instead.
    known = ({letters(generic(t['text'])) for t in tags.tags} | {letters(t['text']) for t in tags.tags}) - {''}
    known_text = {t['text'] for t in tags.tags} | {generic(t['text']) for t in tags.tags}

    def placed(runs):
        text = seg_text(runs)
        keys = [k for k in (letters(text), letters(generic(text))) if k]
        return any(k in known for k in keys) or text in known_text or generic(text) in known_text

    loose = [r for r in own if not placed(r) and not HIDDEN.match(letters(seg_text(r)))]
    if loose:
        tags.section('unsorted', 'other', 'Source needed', note='Not matched to a crate, event or shop yet')
        for runs in loose:
            tags.add('unsorted', runs, how='Source needed')

    needed_icons.update(['bundle', 'tripwire_hook', 'name_tag'])  # the Codex menu's own icons
    missing = sorted(s for s in needed_icons if not have_icon(s))
    return {
        'generated': dt.date.today().isoformat(),
        'kits': kits, 'crates': crates, 'enchants': wiki_enchants(crates_text),
        'tagSections': tags.sections, 'tags': tags.tags,
    }, missing


def self_check():
    assert rank_text([1, 2, 3]) == 'Top 3' and rank_text([1]) == '#1'
    assert rank_text([6, 7, 8, 9, 10]) == '#6–#10' and rank_text([2, 5]) == '#2, #5'
    assert generic('[11154 Fish]') == '[## Fish]' and generic('[? Days]') == '[## Days]'
    split = [{'t': '[Re #', 'c': '#fff', 'b': False}, {'t': '6', 'c': '#f00', 'b': False}, {'t': ']', 'c': '#fff', 'b': False}]
    assert seg_text(numbers_hidden(split)) == '[Re ##]'
    digits = [{'t': '『 Tier 3', 'c': '#fff', 'b': False}, {'t': '6 』', 'c': '#f00', 'b': False}]
    assert seg_text(numbers_hidden(digits)) == '『 Tier ## 』', seg_text(numbers_hidden(digits))
    assert split_top('Iron Sword (Unbreaking 1), 64x Steak') == ['Iron Sword (Unbreaking 1)', '64x Steak']
    item = parse_item('16x Blaze Rods')
    assert (item['n'], item['c'], item['icon']) == ('Blaze Rods', 16, 'blaze_rod'), item


def main():
    self_check()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--captures', required=True, help='folder of capture .jsonl files')
    ap.add_argument('--pack', help='resource pack .zip whose textures and font the site copies')
    ap.add_argument('--launcher', default='~/Library/Application Support/PrismLauncher',
                    help='PrismLauncher folder holding the installed game (default: %(default)s)')
    ap.add_argument('--mc-version', default='1.21.11', help='installed Minecraft version (default: %(default)s)')
    ap.add_argument('--fetch-icons', action='store_true', help='create icons the site lacks')
    args = ap.parse_args()
    tex = Game(os.path.expanduser(args.pack) if args.pack else None, os.path.expanduser(args.launcher), args.mc_version)
    print('game install:', 'found' if tex.jar else 'not found, using the vanilla mirror (no font)')
    data, missing = build(os.path.expanduser(args.captures))
    if tex.jar:
        chars = set(json.dumps(data, ensure_ascii=False)) | set(CHAT_PREVIEW_CHARS)
        os.makedirs(os.path.dirname(FONT_OUT), exist_ok=True)
        n, lacking = mcfont.build_font(tex.font_chain(chars), chars, FONT_OUT)
        print(f'wrote {os.path.relpath(FONT_OUT, ROOT)}: {n} glyphs, {os.path.getsize(FONT_OUT) // 1024} KB'
              + (f'; the game has no glyph for {" ".join(lacking)}' if lacking else ''))
    if args.fetch_icons:
        fetch_icons(missing, tex)
        fetch_legacy_tag_images([t for t in data['tags'] if t.get('img') and t['section'] == 'legacy'])
        fetch_master_tag_images()
        missing = [s for s in missing if not have_icon(s)]
    if missing:
        print('Missing icons (rerun with --fetch-icons):', ', '.join(missing))
    print('Now bump CODEX_DATA_VERSION in frontend/codex.js and its ?v= in index.html, or browsers keep the old data.')
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    by_group = {}
    for t in data['tags']:
        g = next(s['group'] for s in data['tagSections'] if s['id'] == t['section'])
        by_group[g] = by_group.get(g, 0) + 1
    print(f"wrote {os.path.relpath(OUT, ROOT)}: {len(data['kits'])} kits, {len(data['crates'])} crates, "
          f"{len(data['tags'])} tags {by_group}, {os.path.getsize(OUT) // 1024} KB")


if __name__ == '__main__':
    main()
