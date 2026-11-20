#!/usr/bin/env python3
"""tagih launcher icon: a bill sheet with a paid check, because tagih means
"to bill / collect payment".

Same shared rules as the other vanipy apps: numbers-only version strip across
the bottom 24%, picture inside the round-mask safe circle, deterministic
output (pinned Pillow + pinned DejaVu font vendored in tools/fonts/, fail
instead of substituting).
    pip install pillow==12.3.0
"""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

PILLOW_PIN = "12.3.0"
import PIL

if PIL.__version__ != PILLOW_PIN:
    sys.exit("Pillow %s required, found %s" % (PILLOW_PIN, PIL.__version__))

import importlib.util

HELPERS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "badge_common.py")
spec = importlib.util.spec_from_file_location("badge_common", HELPERS)
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)

S = common.S


def sheet(version):
    BG = (146, 64, 14, 255)         # tagih warm amber-brown (#92400e, web primary)
    STRIP = (95, 45, 11, 255)       # darker shade of the same
    CREAM = (247, 243, 234, 255)    # paper
    FOLD = (229, 221, 205, 255)     # folded corner
    LINE = (183, 150, 113, 255)     # faint writing lines
    INK = (146, 64, 14, 255)        # the bold total line
    GREEN = (47, 158, 68, 255)      # paid check badge
    WHITE = (255, 255, 255, 255)

    art, d = common.new_layer()
    # bill sheet: rounded rectangle, above the version strip
    common.rrect(d, (0.33, 0.16, 0.67, 0.62), 0.035, CREAM)
    # folded top-right corner
    d.polygon([(0.585 * S, 0.16 * S), (0.67 * S, 0.245 * S), (0.585 * S, 0.245 * S)],
              fill=FOLD)
    # three writing lines
    for y in (0.315, 0.395, 0.475):
        common.rrect(d, (0.39, y, 0.61, y + 0.024), 0.012, LINE)
    # bold total line
    common.rrect(d, (0.39, 0.545, 0.56, 0.575), 0.012, INK)
    # paid check badge overlapping the sheet's bottom-right corner
    cx, cy, r = 0.635, 0.575, 0.088
    d.ellipse([((cx - r)) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], fill=GREEN)
    # white check mark
    pts = [(0.60, 0.575), (0.625, 0.603), (0.672, 0.55)]
    d.line([(x * S, y * S) for x, y in pts], fill=WHITE, width=int(0.022 * S),
           joint="curve")
    return common.compose(BG, art, version, STRIP, CREAM, rounded=.2)


def main():
    version = common.parse_version(sys.argv)
    root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    common.write_densities(sheet(version), os.path.join(root, "android/app/src/main/res"))
    print("wrote tagih icons for", version)


if __name__ == "__main__":
    main()
