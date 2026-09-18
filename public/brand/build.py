#!/usr/bin/env python3
"""Build the A&R brand masters — level 1 of the promo build order.

  0.1  the block mark      -> public/brand/mark/*.svg + *.png
  0.2  the property lockups -> public/brand/lockups/*.svg
  0.5  the stroke icon set  -> public/brand/icons/*.svg + anr-icons.svg sprite

Approved 2026-09-11 (docs/mockups/anr-brand-marks-mockup.html):
  1. favicon at 16/32 is the ampersand alone
  2. no article in any lockup: [A&R] TEAM, never THE [A&R] TEAM
  3. four fills: green, paper green, mono ink, purple
  4. icons are 2px square-capped strokes; vote is the dial

Type is converted to outlines with fontTools so the SVGs depend on no
installed font. PNGs are rendered FROM the SVGs by headless Chrome
(`./build.py --png`), so a PNG can never drift from its master.

    python3 build.py          # SVGs only
    python3 build.py --png    # SVGs, then PNGs via Chrome (needs Google Chrome)
"""
import os, sys, math, subprocess, time, http.server, threading, socketserver
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
FONT = os.path.join(ROOT, 'assets', 'fonts', 'archivo-v20-latin-900.woff')

# ---- brand tokens (anr-brand skill) ----
GREEN, PURPLE, INK, PAPER_INK, WHITE = '#4BB749', '#6D5FE0', '#0E0C1A', '#141224', '#FFFFFF'
GREEN_PAPER, PURPLE_PAPER = '#2F8F2E', '#4C3FBD'
SCREEN_TYPE = '#EAE9F2'      # descriptor on dark ground
SKEW = 13                    # degrees; never changes
TAN = math.tan(math.radians(SKEW))

font = TTFont(FONT)
GS, CMAP, UPM = font.getGlyphSet(), font.getBestCmap(), font['head'].unitsPerEm


def text_outline(s, size, tracking_em=0.0):
    """Return (path_d, bbox) for string s set in Archivo 900 at `size` units,
    baseline at y=0, starting at x=0, with tracking in em. Y is flipped to SVG."""
    scale = size / UPM
    x = 0.0
    d, bounds = [], BoundsPen(GS)
    for ch in s:
        g = CMAP[ord(ch)]
        if ch != ' ':
            pen = SVGPathPen(GS)
            GS[g].draw(TransformPen(pen, (scale, 0, 0, -scale, x, 0)))
            GS[g].draw(TransformPen(bounds, (scale, 0, 0, -scale, x, 0)))
            d.append(pen.getCommands())
        x += GS[g].width * scale + tracking_em * size
    return ' '.join(d), bounds.bounds  # (xmin, ymin, xmax, ymax), y grows down


def fmt(v):
    return ('%.2f' % v).rstrip('0').rstrip('.')


# ---- 0.1 the block ----
def block_svg(S, fill, type_fill, amp=False, outline=False, margin=0.0):
    """One block of side S. Returns (svg_inner, W, H) with the skewed bounding
    box at the origin plus `margin` on every side. Type is upright and optically
    centred on the square; the block leans 13 deg with its top to the right."""
    W = S * (1 + TAN)
    m = margin
    cx, cy = m + W / 2, m + S / 2
    rx = S * 0.04
    if outline:
        sw = S * 0.05
        rect = (f'<rect x="{fmt(cx - S/2 + sw/2)}" y="{fmt(cy - S/2 + sw/2)}" width="{fmt(S - sw)}" '
                f'height="{fmt(S - sw)}" rx="{fmt(rx)}" fill="none" stroke="{fill}" stroke-width="{fmt(sw)}"/>')
    else:
        rect = f'<rect x="{fmt(cx - S/2)}" y="{fmt(cy - S/2)}" width="{fmt(S)}" height="{fmt(S)}" rx="{fmt(rx)}" fill="{fill}"/>'
    g = (f'<g transform="translate({fmt(cx)} {fmt(cy)}) skewX(-{SKEW}) translate({fmt(-cx)} {fmt(-cy)})">{rect}</g>')
    if amp:
        d, (x0, y0, x1, y1) = text_outline('&', S * 0.62)
    else:
        d, (x0, y0, x1, y1) = text_outline('A&R', S * 0.39, tracking_em=-0.05)
    tx = cx - (x0 + x1) / 2
    ty = cy - (y0 + y1) / 2
    text = f'<path transform="translate({fmt(tx)} {fmt(ty)})" d="{d}" fill="{type_fill}"/>'
    return g + text, W + 2 * m, S + 2 * m


def svg(inner, W, H, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(W)} {fmt(H)}" width="{fmt(W)}" height="{fmt(H)}">'
            f'<title>{title}</title>{inner}</svg>\n')


MARKS = {
    # name: (fill, type, amp, outline)
    'anr-mark':          (GREEN, INK, False, False),
    'anr-mark-paper':    (GREEN_PAPER, WHITE, False, False),
    'anr-mark-ink':      (PAPER_INK, WHITE, False, False),
    'anr-mark-purple':   (PURPLE, INK, False, False),
    'anr-mark-outline':  ('currentColor', 'currentColor', False, True),
    'anr-mark-amp':      (GREEN, INK, True, False),
    'anr-mark-amp-paper':(GREEN_PAPER, WHITE, True, False),
}


def build_marks(out):
    os.makedirs(out, exist_ok=True)
    for name, (fill, tfill, amp, outline) in MARKS.items():
        inner, W, H = block_svg(1000, fill, tfill, amp=amp, outline=outline)
        open(os.path.join(out, name + '.svg'), 'w').write(svg(inner, W, H, 'A&amp;R mark'))
    print('marks: %d svg' % len(MARKS))


# ---- 0.2 the lockups ----
PROPS = {
    'room':         ('ROOM',         GREEN,  GREEN_PAPER),
    'team':         ('TEAM',         GREEN,  GREEN_PAPER),
    'meeting':      ('MEETING',      GREEN,  GREEN_PAPER),
    'service-pack': ('SERVICE PACK', PURPLE, PURPLE_PAPER),
}


def lockup_h(S, word, fill, type_fill, word_fill):
    """[block] WORD on one line, caps optically centred on the block's centre.
    Word at .9375S with -.04em tracking, starting .16S past the block's bbox."""
    m = S * 0.5                                        # clear space = half a side
    inner, W, H = block_svg(S, fill, type_fill, margin=0)
    d, (x0, y0, x1, y1) = text_outline(word, S * 0.9375, tracking_em=-0.04)
    wx = W + S * 0.16 - x0
    wy = S / 2 - (y0 + y1) / 2
    total_w = wx + x1 + m * 2
    total_h = S + m * 2
    body = (f'<g transform="translate({fmt(m)} {fmt(m)})">{inner}'
            f'<path transform="translate({fmt(wx)} {fmt(wy)})" d="{d}" fill="{word_fill}"/></g>')
    return body, total_w, total_h


def lockup_stack(S, word, fill, type_fill, word_fill):
    """Block above, descriptor below at .46S, left edge .235S left of the block's
    bottom-left corner. Two-word descriptors break onto two lines at .86 leading."""
    m = S * 0.5
    inner, W, H = block_svg(S, fill, type_fill)
    size = S * 0.46
    lines = word.split(' ')
    paths, maxx = [], 0
    y = S + S * 0.2                                    # margin-top .2S, then cap top
    for i, ln in enumerate(lines):
        d, (x0, y0, x1, y1) = text_outline(ln, size, tracking_em=-0.04)
        cap = y1 - y0
        by = y + cap if i == 0 else y                  # baseline: first line sits its caps at y
        if i > 0:
            by = prev_base + size * 0.86
        paths.append(f'<path transform="translate({fmt(-x0)} {fmt(by)})" d="{d}" fill="{word_fill}"/>')
        maxx = max(maxx, x1 - x0)
        prev_base = by
    total_w = max(W + S * 0.235, maxx) + m * 2
    total_h = prev_base + m * 2
    body = (f'<g transform="translate({fmt(m)} {fmt(m)})">'
            f'<g transform="translate({fmt(S * 0.235)} 0)">{inner}</g>' + ''.join(paths) + '</g>')
    return body, total_w, total_h


def build_lockups(out):
    os.makedirs(out, exist_ok=True)
    n = 0
    for key, (word, fill, pfill) in PROPS.items():
        for paper in (False, True):
            f = pfill if paper else fill
            tf = WHITE if paper else INK
            wf = PAPER_INK if paper else SCREEN_TYPE
            suffix = '-paper' if paper else ''
            body, W, H = lockup_h(200, word, f, tf, wf)
            open(os.path.join(out, f'anr-{key}-h{suffix}.svg'), 'w').write(svg(body, W, H, f'A&amp;R {word.title()}'))
            body, W, H = lockup_stack(200, word, f, tf, wf)
            open(os.path.join(out, f'anr-{key}-stack{suffix}.svg'), 'w').write(svg(body, W, H, f'A&amp;R {word.title()}'))
            n += 2
    print('lockups: %d svg' % n)


# ---- 0.5 the icons ----
ICONS = {
    'play':     '<path d="M7 4 L20 12 L7 20 Z"/>',
    'vote':     '<path d="M4 15 A8 8 0 0 1 20 15"/><path d="M12 15 L17.5 9.5"/><path d="M3 19 H21"/>',
    'clock':    '<circle cx="12" cy="12" r="9"/><path d="M12 7 V12 H16"/>',
    'mic':      '<path d="M9 3 H15 V12 A3 3 0 0 1 9 12 Z"/><path d="M5 11 A7 7 0 0 0 19 11"/><path d="M12 18 V21 M8 21 H16"/>',
    'chart':    '<path d="M3 20 H21"/><path d="M5 20 V12 H9 V20"/><path d="M10 20 V5 H14 V20"/><path d="M15 20 V14 H19 V20"/>',
    'download': '<path d="M12 3 V16"/><path d="M6 10 L12 16 L18 10"/><path d="M4 20 H20"/>',
    'check':    '<path d="M4 12 L10 18 L20 6"/>',
    'arrow':    '<path d="M4 12 H20"/><path d="M13 5 L20 12 L13 19"/>',
}
STROKE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"'


def build_icons(out):
    os.makedirs(out, exist_ok=True)
    for name, body in ICONS.items():
        open(os.path.join(out, f'{name}.svg'), 'w').write(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" {STROKE}>{body}</svg>\n')
    sprite = ''.join(f'<symbol id="i-{n}" viewBox="0 0 24 24">{b}</symbol>' for n, b in ICONS.items())
    open(os.path.join(out, 'anr-icons.svg'), 'w').write(
        f'<svg xmlns="http://www.w3.org/2000/svg" {STROKE}><defs>{sprite}</defs></svg>\n')
    print('icons: %d svg + sprite' % len(ICONS))


# ---- PNGs, rendered from the SVGs by Chrome ----
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
# (file, source svg, canvas w, h, background or None, block side in px)
PNGS = [
    ('mark/anr-mark-512.png', 'mark/anr-mark.svg', 512, 512, None, 416),
    ('mark/anr-mark-192.png', 'mark/anr-mark.svg', 192, 192, None, 156),
    ('mark/anr-mark-96.png',  'mark/anr-mark.svg',  96,  96, None,  78),
    ('mark/anr-mark-48.png',  'mark/anr-mark.svg',  48,  48, None,  39),
    ('mark/favicon-32.png',   'mark/anr-mark-amp.svg', 32, 32, None, 26),
    ('mark/favicon-16.png',   'mark/anr-mark-amp.svg', 16, 16, None, 13),
    ('mark/apple-touch-icon-180.png', 'mark/anr-mark.svg', 180, 180, INK, 104),
    ('mark/anr-mark-purple-512.png', 'mark/anr-mark-purple.svg', 512, 512, None, 416),
    ('mark/anr-mark-ink-512.png', 'mark/anr-mark-ink.svg', 512, 512, '#FFFFFF', 416),
]


def build_pngs():
    port = 8771
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    handler = lambda *a, **k: Quiet(*a, directory=HERE, **k)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(('127.0.0.1', port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    time.sleep(0.3)
    tmp = os.path.join(HERE, '_render.html')
    try:
        for out, src, w, h, bg, side in PNGS:
            bw = side * (1 + TAN)
            body_bg = bg or 'transparent'
            open(tmp, 'w').write(
                f'<!doctype html><html style="background:transparent"><body style="margin:0;width:{w}px;height:{h}px;'
                f'background:{body_bg};display:flex;align-items:center;justify-content:center">'
                f'<img src="{src}" style="width:{bw:.3f}px;height:{side}px;display:block"></body></html>')
            outp = os.path.join(HERE, out)
            subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                            '--force-device-scale-factor=1', '--default-background-color=00000000',
                            f'--window-size={w},{h}', '--virtual-time-budget=5000',
                            f'--screenshot={outp}', f'http://127.0.0.1:{port}/_render.html'],
                           capture_output=True)
            print('png:', out)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
        srv.shutdown()


if __name__ == '__main__':
    build_marks(os.path.join(HERE, 'mark'))
    build_lockups(os.path.join(HERE, 'lockups'))
    build_icons(os.path.join(HERE, 'icons'))
    if '--png' in sys.argv:
        build_pngs()
