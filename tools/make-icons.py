#!/usr/bin/env python3
"""Regenerates icons/*.png (needs Pillow). Only needed if you want to change the icon."""
from PIL import Image, ImageDraw
import math, os

def icon(size):
    s = size * 4                                   # supersample for smooth edges
    im = Image.new("RGB", (s, s), (11, 15, 20))
    d = ImageDraw.Draw(im)
    # parabola of sample dots (projectile path), kept inside the maskable safe zone (central 60%)
    x0, x1 = 0.24 * s, 0.76 * s
    base, peak = 0.68 * s, 0.30 * s
    n = 7
    for i in range(n):
        u = i / (n - 1)
        x = x0 + (x1 - x0) * u
        y = base - 4 * (base - peak) * u * (1 - u)
        r = (0.035 + 0.012 * math.sin(math.pi * u)) * s
        d.ellipse((x - r, y - r, x + r, y + r), fill=(74, 163, 255))
    d.line((0.2 * s, base + 0.07 * s, 0.8 * s, base + 0.07 * s), fill=(147, 161, 177), width=int(0.012 * s))
    return im.resize((size, size), Image.LANCZOS)

here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "..", "icons")
os.makedirs(out, exist_ok=True)
for n in (180, 192, 512):
    icon(n).save(os.path.join(out, f"icon-{n}.png"), optimize=True)
