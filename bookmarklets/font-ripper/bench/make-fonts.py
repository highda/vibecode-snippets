"""Generate distinct test fonts f01..f80 from one base font.

Each font gets its own internal name ("Int NN") and scaled advance widths, so
files are byte-distinct and glyph-metric-distinct. Pages register them under
"Vec NN", which lets the benchmark tell attributed files from unattributed ones.
"""
import sys, pathlib
from fontTools.ttLib import TTFont
from fontTools import subset

BASE = "/System/Library/Fonts/Supplemental/Georgia.ttf"
OUT = pathlib.Path(__file__).parent / "fonts"
OUT.mkdir(exist_ok=True)
N = int(sys.argv[1]) if len(sys.argv) > 1 else 80

opts = subset.Options()
opts.layout_features = []
opts.name_IDs = [1, 2, 4, 6, 16, 17]
opts.hinting = False
text = "".join(chr(c) for c in range(0x20, 0x7F)) + "Příliš žluťoučký kůň úpěl ďábelské ódy"

for i in range(1, N + 1):
    f = TTFont(BASE)
    s = subset.Subsetter(opts)
    s.populate(text=text)
    s.subset(f)
    k = 1 + i * 0.006
    f["hmtx"].metrics = {g: (round(a * k), lsb) for g, (a, lsb) in f["hmtx"].metrics.items()}
    name = f"Int {i:02d}"
    for rec in f["name"].names:
        if rec.nameID in (1, 16): rec.string = name
        elif rec.nameID == 4: rec.string = name + " Regular"
        elif rec.nameID == 6: rec.string = name.replace(" ", "") + "-Regular"
    for flavor, ext in ((None, "ttf"), ("woff", "woff"), ("woff2", "woff2")):
        f.flavor = flavor
        f.save(OUT / f"f{i:02d}.{ext}")
print(f"wrote {N} fonts x3 formats to {OUT}")
