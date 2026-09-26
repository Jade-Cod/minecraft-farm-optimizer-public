"""Read in-game GUI captures (JSONL from a client-side capture mod).

Each line is a record: `screen` opens a GUI (with its title), `full` and `delta`
fill its slots, `close`/`end` finish it. A page can arrive as an empty `full`
followed by a `delta`, so slots are accumulated until the screen closes.
Item names and lore are Minecraft text components ({text, color, bold, extra}).
"""
import json
import re

# Minecraft's named colours (§ codes) as hex
MC_COLORS = {
    'black': '#000000', 'dark_blue': '#0000aa', 'dark_green': '#00aa00', 'dark_aqua': '#00aaaa',
    'dark_red': '#aa0000', 'dark_purple': '#aa00aa', 'gold': '#ffaa00', 'gray': '#aaaaaa',
    'dark_gray': '#555555', 'blue': '#5555ff', 'green': '#55ff55', 'aqua': '#55ffff', 'red': '#ff5555',
    'light_purple': '#ff55ff', 'yellow': '#ffff55', 'white': '#ffffff',
}
TAG_BULLET = re.compile(r'^[•●]\s+(Exclusive\s+)?\[.*\]\s+(chat\s+)?tag$', re.I)


def plain(c):
    """Text component -> plain string."""
    if c is None:
        return ''
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return ''.join(plain(x) for x in c)
    return (c.get('text', '') or c.get('translate', '')) + ''.join(plain(x) for x in c.get('extra', []))


def screens(path):
    """Yield (title, {slot: item}) once per GUI screen, after all its updates."""
    title, slots = None, None
    with open(path, encoding='utf-8') as f:
        for line in f:
            r = json.loads(line)
            kind = r['type']
            if kind == 'screen':
                title, slots = plain(r['title']).strip(), {}
            elif kind in ('full', 'delta') and slots is not None:
                slots.update(r.get('slots') or {})
            elif kind in ('close', 'end') and slots is not None:
                yield title, slots
                slots = None


def gui_items(slots):
    """(slot, item) for the chest part of a GUI (slots 0-53), skipping the player's inventory."""
    return [(int(k), slots[k]) for k in sorted(slots, key=int) if int(k) < 54]


def lore_lines(item):
    return [plain(l).strip() for l in item.get('lore', [])]


def segs(component):
    """Flatten a component into styled runs [{t, c, b}], merging neighbours with the same style."""
    out = []

    def walk(node, color, bold):
        if isinstance(node, str):
            node = {'text': node}
        color = MC_COLORS.get(node.get('color'), node.get('color')) or color
        bold = node.get('bold', bold)
        if node.get('text'):
            out.append({'t': node['text'], 'c': color, 'b': bool(bold)})
        for child in node.get('extra', []):
            walk(child, color, bold)

    walk(component, '#ffffff', False)
    merged = []
    for s in out:
        if merged and merged[-1]['c'] == s['c'] and merged[-1]['b'] == s['b']:
            merged[-1] = {**merged[-1], 't': merged[-1]['t'] + s['t']}
        else:
            merged.append(s)
    return merged


def seg_text(runs):
    return ''.join(r['t'] for r in runs)


def trim_runs(runs, suffix=''):
    """Drop a trailing plain-text suffix (e.g. ' Tag') and surrounding whitespace from styled runs."""
    runs = [dict(r) for r in runs]
    text = seg_text(runs).rstrip()
    cut = len(seg_text(runs)) - len(text)
    if suffix and text.lower().endswith(suffix.lower()):
        cut += len(suffix)
    while cut > 0 and runs:
        n = min(cut, len(runs[-1]['t']))
        runs[-1]['t'] = runs[-1]['t'][:len(runs[-1]['t']) - n]
        cut -= n
        if not runs[-1]['t']:
            runs.pop()
    while runs and not runs[-1]['t'].strip():
        runs.pop()
    while runs and not runs[0]['t'].strip():
        runs.pop(0)
    if runs:
        runs[-1]['t'] = runs[-1]['t'].rstrip()
        runs[0]['t'] = runs[0]['t'].lstrip()
    return runs


def bracket_runs(component):
    """Styled runs of the first [...] tag inside a lore line such as '• Exclusive [Runner]  chat tag'."""
    runs = segs(component)
    text = seg_text(runs)
    start, end = text.find('['), text.find(']', text.find('['))
    if start < 0 or end < 0:
        return []
    out, pos = [], 0
    for r in runs:
        a, b = pos, pos + len(r['t'])
        lo, hi = max(a, start), min(b, end + 1)
        if lo < hi:
            out.append({**r, 't': r['t'][lo - a:hi - a]})
        pos = b
    return out


if __name__ == '__main__':
    line = {'text': '', 'extra': [
        {'text': ' • ', 'color': 'gray'}, {'text': 'Exclusive ', 'color': 'gray'},
        {'text': '[', 'color': 'dark_gray'}, {'text': 'Run', 'color': '#F02C2C', 'bold': True},
        {'text': 'ner', 'color': '#F02C2C', 'bold': True}, {'text': ']', 'color': 'dark_gray'},
        {'text': '  chat tag', 'color': 'gray'}]}
    assert TAG_BULLET.match(plain(line).strip()), plain(line)
    got = bracket_runs(line)
    assert seg_text(got) == '[Runner]', got
    assert got[1] == {'t': 'Runner', 'c': '#F02C2C', 'b': True}, got  # same-style runs merged
    assert got[0]['c'] == '#555555'                                     # named colour -> hex
    name = {'text': '', 'extra': [{'text': '[', 'color': 'gray'}, {'text': 'TOXIC', 'color': 'dark_green'},
                                  {'text': ']', 'color': 'gray'}, {'text': ' Tag ', 'color': 'white'}]}
    assert seg_text(trim_runs(segs(name), 'Tag')) == '[TOXIC]'
    assert TAG_BULLET.match('● [Mason] Chat Tag') and not TAG_BULLET.match('• Museum Head')
    print('capture self-check ok')
