"""Generate placeholder fabric images for the sample catalog.

Each tarha gets a draped-fabric image in its own colour and fabric type, so the
store looks like a real catalogue until real photos are uploaded.

Usage: python scripts/make-sample-images.py
Output: public/samples/<slug>-1.jpg, <slug>-2.jpg, category-<slug>.jpg
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "samples"
OUT.mkdir(parents=True, exist_ok=True)
CATALOG = json.loads((ROOT / "src" / "sample-catalog.json").read_text(encoding="utf-8"))
PAPER = np.array([0xFA, 0xF5, 0xF1], dtype=np.float32) / 255
W, H = 900, 1200


def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32) / 255


def folds(w, h, rng, n=7, fan=0.55, freq=(2.0, 9.0)):
    """Vertical folds that fan out towards the bottom, like cloth hanging from the shoulders."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    x /= w
    y /= h
    spread = (1 - fan) + fan * y
    xs = (x - 0.5) / spread + 0.5
    f = np.zeros((h, w), np.float32)
    for _ in range(n):
        fr = rng.uniform(*freq)
        ph = rng.uniform(0, 2 * np.pi)
        amp = rng.uniform(0.4, 1.0) / fr ** 0.35
        wob = rng.uniform(0.02, 0.07) * np.sin(2 * np.pi * (y * rng.uniform(0.6, 1.6)) + ph)
        f += amp * np.sin(2 * np.pi * fr * (xs + wob) + ph)
    f -= f.min()
    f /= f.max()
    return f, x, y


def print_motif(w, h, rng, base, fold_disp):
    """Small scattered flowers / diamonds, displaced by the folds so the print follows the cloth."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    x = x + fold_disp * 18
    cell = 70
    cx = (x % cell) - cell / 2
    cy = ((y + (x // cell % 2) * cell / 2) % cell) - cell / 2
    r = np.sqrt(cx ** 2 + cy ** 2)
    ang = np.arctan2(cy, cx)
    petals = 13 + 6 * np.cos(5 * ang)
    flower = np.clip((petals - r) / 2, 0, 1)
    centre = np.clip((5 - r) / 1.5, 0, 1)
    img = np.repeat(base[None, None, :], h, 0).repeat(w, 1).copy()
    gold = np.array([0.86, 0.68, 0.30], np.float32)
    cream = np.array([0.97, 0.93, 0.85], np.float32)
    img = img * (1 - flower[..., None]) + cream * flower[..., None]
    img = img * (1 - centre[..., None]) + gold * centre[..., None]
    return img


def render_fabric(color, texture, w, h, seed, zoom=1.0):
    rng = np.random.default_rng(seed)
    base = hex_rgb(color)
    nfold = 9 if zoom > 1 else 7
    f, x, y = folds(w, h, rng, n=nfold, fan=0.55 if zoom == 1 else 0.25,
                    freq=(2.0 * zoom, 9.0 * zoom))
    lum = base.mean()

    if texture == "printed":
        img = print_motif(w, h, rng, base, f)
    else:
        img = np.repeat(base[None, None, :], h, 0).repeat(w, 1).copy()

    # Shading from the folds; dark colours need gentler shading to keep their hue.
    depth = 0.30 if lum > 0.35 else 0.22
    if texture == "cotton":
        depth *= 0.7
    shade = (1 - depth) + depth * f
    img *= shade[..., None]

    if texture == "satin":
        spec = np.clip((f - 0.62) / 0.38, 0, 1) ** 3
        img = img + (1 - img) * (spec[..., None] * 0.32)
    if texture == "chiffon":
        # Sheer: a little of the paper shows through, and layered edges are lighter.
        sheer = 0.12 + 0.10 * np.sin(2 * np.pi * (x * 3.1 + y * 0.4)) ** 2
        img = img * (1 - sheer[..., None]) + PAPER * sheer[..., None]
    if texture == "cotton":
        weave = (np.sin(x * w * 1.9) * np.sin(y * h * 1.9)) * 0.025
        img += weave[..., None]

    # Soft vignette and grain.
    v = 1 - 0.18 * (((x - 0.5) * 1.3) ** 2 + ((y - 0.45) * 1.1) ** 2)
    img *= v[..., None]
    img += rng.normal(0, 0.012, img.shape).astype(np.float32)
    img = np.clip(img, 0, 1)
    out = Image.fromarray((img * 255).astype(np.uint8), "RGB")
    return out.filter(ImageFilter.GaussianBlur(0.6))


def main():
    cats = {c["slug"]: c for c in CATALOG["categories"]}
    for i, p in enumerate(CATALOG["products"]):
        tex = cats[p["category"]]["texture"]
        render_fabric(p["swatch"], tex, W, H, seed=100 + i).save(OUT / f"{p['slug']}-1.jpg", quality=86)
        render_fabric(p["swatch"], tex, W, H, seed=500 + i, zoom=1.8).save(OUT / f"{p['slug']}-2.jpg", quality=86)
        print("product", p["slug"])

    for j, c in enumerate(CATALOG["categories"]):
        panels = [render_fabric(col, c["texture"], W // 3, H, seed=900 + j * 10 + k) for k, col in enumerate(c["colors"])]
        tile = Image.new("RGB", (W // 3 * 3, H))
        for k, panel in enumerate(panels):
            tile.paste(panel, (k * (W // 3), 0))
        tile.save(OUT / f"category-{c['slug']}.jpg", quality=86)
        print("category", c["slug"])


if __name__ == "__main__":
    main()
