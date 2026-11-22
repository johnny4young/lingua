#!/usr/bin/env bash
# Rebuilds scripts/brand/glyph-outlines.json, the Fraunces outlines behind the
# logo. Only needed when the mark or wordmark is redrawn; the app never loads it.
# Needs uv (https://docs.astral.sh/uv/). Then run: node scripts/brand/generate-brand-assets.mjs
set -euo pipefail

# Same google/fonts commit as scripts/fonts/build-variable-fonts.sh.
FONTS_COMMIT=06bfe0d62a98375cb09c942fa18e68bd32cff057
URL="https://raw.githubusercontent.com/google/fonts/${FONTS_COMMIT}/ofl/fraunces/Fraunces-Italic%5BSOFT,WONK,opsz,wght%5D.ttf"

repo="$(cd "$(dirname "$0")/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
curl -fsSL "$URL" -o "$work/fraunces-italic.ttf"

uv run --quiet --isolated --no-project --with 'uharfbuzz==0.53.3' python - "$work/fraunces-italic.ttf" \
  "$repo/scripts/brand/glyph-outlines.json" <<'PY'
import json, sys
import uharfbuzz as hb

font_path, out_path = sys.argv[1], sys.argv[2]
face = hb.Face(hb.Blob.from_file_path(font_path))
UPEM = face.upem
AXES = {"opsz": 144, "SOFT": 100, "WONK": 1}

def fmt(v):
    return f"{round(v, 1):g}"

class Pen:
    def __init__(self):
        self.dx, self.parts = 0.0, []
    def moveTo(self, p): self.parts.append(f"M{fmt(p[0] + self.dx)} {fmt(p[1])}")
    def lineTo(self, p): self.parts.append(f"L{fmt(p[0] + self.dx)} {fmt(p[1])}")
    def qCurveTo(self, *pts):
        (cx, cy), (x, y) = pts
        self.parts.append(f"Q{fmt(cx + self.dx)} {fmt(cy)} {fmt(x + self.dx)} {fmt(y)}")
    def curveTo(self, *pts):
        coords = " ".join(f"{fmt(x + self.dx)} {fmt(y)}" for x, y in pts)
        self.parts.append(f"C{coords}")
    def closePath(self): self.parts.append("Z")

def font_at(weight):
    font = hb.Font(face)
    font.set_variations({**AXES, "wght": weight})
    return font

def shape(text, weight, tracking_em=0.0):
    font = font_at(weight)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {})
    pen, x = Pen(), 0.0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        pen.dx = x + pos.x_offset
        font.draw_glyph_with_pen(info.codepoint, pen)
        x += pos.x_advance + tracking_em * UPEM
    return font, "".join(pen.parts), x, buf

def glyph(text, weight):
    _, d, advance, _ = shape(text, weight)
    return {"weight": weight, "d": d, "advance": round(advance, 1)}

# Wordmark: lower case, dotless i, tracking -1 %; the dot is drawn by the generator.
font, d, advance, buf = shape("lıngua", 520, -0.01)
pos = buf.glyph_positions
dotless_x = pos[0].x_advance - 0.01 * UPEM
# x-height = top of the x glyph at the wordmark weight.
x_height = font.get_glyph_extents(font.get_nominal_glyph(ord("x"))).y_bearing

out = {
    "source": "Fraunces Italic (opsz 144, SOFT 100, WONK 1), google/fonts commit pinned in outline-glyphs.sh",
    "unitsPerEm": UPEM,
    "markL": glyph("l", 500),
    "liteL": glyph("l", 600),
    "wordmark": {
        "weight": 520,
        "d": d,
        "advance": round(advance, 1),
        "xHeight": x_height,
        "dotlessX": round(dotless_x, 1),
        "dotlessAdvance": pos[1].x_advance,
    },
}
with open(out_path, "w") as fh:
    json.dump(out, fh, indent=2)
    fh.write("\n")
PY
echo "wrote scripts/brand/glyph-outlines.json"
