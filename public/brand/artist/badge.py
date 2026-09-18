#!/usr/bin/env python3
"""The "Rated at The A&R Meeting" badge (4.9) — an SVG an artist can drop onto
their own artwork, site or press kit, with the text as outlines so it needs no
font. Carries the DATE, never the score.

    python3 badge.py 2026-09-10            -> badge-2026-09-10.svg (+ -paper.svg)
    python3 badge.py 2026-09-10 --png      -> also badge-2026-09-10.png at 2x via Chrome
"""
import os, sys, subprocess, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('build', os.path.join(HERE, '..', 'build.py'))
build = importlib.util.module_from_spec(spec); spec.loader.exec_module(build)
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

MONO = TTFont(os.path.join(build.ROOT, 'assets', 'fonts', 'space-mono-v17-latin-700.ttf'))
MGS, MCMAP, MUPM = MONO.getGlyphSet(), MONO.getBestCmap(), MONO['head'].unitsPerEm

def mono_outline(s, size, tracking_em=0.12):
    scale = size / MUPM; x = 0.0; d = []; b = BoundsPen(MGS)
    for ch in s:
        g = MCMAP.get(ord(ch), MCMAP[ord('?')])
        if ch != ' ':
            pen = SVGPathPen(MGS); MGS[g].draw(TransformPen(pen, (scale, 0, 0, -scale, x, 0))); d.append(pen.getCommands())
            MGS[g].draw(TransformPen(b, (scale, 0, 0, -scale, x, 0)))
        x += MGS[g].width * scale + tracking_em * size
    return ' '.join(d), b.bounds

def badge(date_mmddyy, paper=False):
    """[block]  RATED AT THE A&R MEETING  ·  09.10.26   in a 13°-cut pill, height 100."""
    H = 100; S = 56
    fill = build.GREEN_PAPER if paper else build.GREEN
    ink = build.PAPER_INK if paper else build.SCREEN_TYPE     # text: dark on paper, light on the dark pill
    ground = '#FFFFFF' if paper else '#171328'                # the pill: white on paper, panel on dark
    block, bw, bh = build.block_svg(S, fill, '#FFFFFF' if paper else build.INK)
    label, (lx0, ly0, lx1, ly1) = mono_outline('RATED AT THE A&R MEETING', 17)
    date, (dx0, dy0, dx1, dy1) = mono_outline(date_mmddyy, 17)
    pad = 24; gap = 18
    x_block = pad
    x_label = x_block + bw + gap - lx0
    x_dot = x_label + lx1 + gap
    x_date = x_dot + 12 + gap - dx0
    W = x_date + dx1 + pad + 14
    cy = H / 2
    ly = cy - (ly0 + ly1) / 2; dy = cy - (dy0 + dy1) / 2
    cut = H * build.TAN
    pill = (f'<path d="M{cut:.1f} 0 H{W:.1f} V{H} H0 Z" fill="{ground}"/>')  # leans like the block
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} {H}" width="{W:.1f}" height="{H}">'
            f'<title>Rated at The A&amp;R Meeting {date_mmddyy}</title>{pill}'
            f'<g transform="translate({x_block} {cy - S/2})">{block}</g>'
            f'<path transform="translate({x_label:.2f} {ly:.2f})" d="{label}" fill="{ink}"/>'
            f'<path d="M{x_dot + 6*build.TAN:.1f} {cy - 3} h6 L{x_dot + 6:.1f} {cy + 3} H{x_dot:.1f} Z" fill="{fill}"/>'   # a 13° tick-dot, drawn in place
            f'<path transform="translate({x_date:.2f} {dy:.2f})" d="{date}" fill="{ink}"/></svg>\n')

if __name__ == '__main__':
    iso = sys.argv[1] if len(sys.argv) > 1 else '2026-09-10'
    y, m, d = iso.split('-'); mmddyy = f'{m}.{d}.{y[-2:]}'
    for paper in (False, True):
        out = os.path.join(HERE, f'badge-{iso}{"-paper" if paper else ""}.svg')
        open(out, 'w').write(badge(mmddyy, paper)); print(os.path.basename(out))
    if '--png' in sys.argv:
        for paper in (False, True):
            svg = f'badge-{iso}{"-paper" if paper else ""}.svg'
            html = os.path.join(HERE, '_badge.html')
            open(html, 'w').write(f'<!doctype html><body style="margin:0;background:transparent"><img src="{svg}" style="display:block;height:200px"></body>')
            srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8777', '--bind', '127.0.0.1', '--directory', HERE], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                import time; time.sleep(0.5)
                subprocess.run([build.CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                                '--default-background-color=00000000', '--window-size=1400,200', '--virtual-time-budget=5000',
                                f'--screenshot={os.path.join(HERE, svg[:-4] + ".png")}', 'http://127.0.0.1:8777/_badge.html'], capture_output=True)
            finally:
                srv.terminate(); os.remove(html)
            try:   # trim the transparent canvas to the badge
                from PIL import Image
                png = os.path.join(HERE, svg[:-4] + '.png'); im = Image.open(png).convert('RGBA')
                bbox = im.getchannel('A').getbbox(); im.crop(bbox).save(png)
            except ImportError:
                pass
            print(svg[:-4] + '.png')
