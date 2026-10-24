#!/usr/bin/env python3
"""Scale the Kristoff/Anna row on slide 2 and re-space it.

    python3 scripts/resize-slide2-circles.py <deck.pptx> [size_emu]

Only touches the <a:xfrm> of the five shapes in that row. Every run, every text
body and every other shape on the slide is left exactly as it was, so hand
edits to the copy survive.
"""
import re
import shutil
import sys
import zipfile
from pathlib import Path

MARGIN = 685800   # the left text margin the rest of the slide already uses
GAP = 800000      # space between the two circles, where the arrow sits
LABEL_W = 1200000
LABEL_DROP = 150000  # gap between the bottom of a circle and its label


def layout(size: int, top: int):
    k_x, a_x = MARGIN, MARGIN + size + GAP
    return {
        "ph-kristoff": (k_x, top, size, size),
        "ph-anna": (a_x, top, size, size),
        # The arrow is a zero-height line, centred vertically on the circles.
        "ph-arrow": (k_x + size + 50000, top + size // 2, GAP - 100000, 0),
        "ph-kristoff-lbl": (k_x + size // 2 - LABEL_W // 2, top + size + LABEL_DROP, LABEL_W, 220000),
        "ph-anna-lbl": (a_x + size // 2 - LABEL_W // 2, top + size + LABEL_DROP, LABEL_W, 220000),
    }


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    deck = Path(sys.argv[1])
    size = int(sys.argv[2]) if len(sys.argv) > 2 else 1500000
    # Keep the row bottom-anchored so a bigger circle grows upward into the
    # empty band under the subtitle rather than off the bottom of the slide.
    bottom = 6120000
    top = bottom - 220000 - LABEL_DROP - size

    zin = zipfile.ZipFile(deck)
    slide = "ppt/slides/slide2.xml"
    xml = zin.read(slide).decode()

    for name, (x, y, cx, cy) in layout(size, top).items():
        pat = re.compile(
            r'(name="' + name + r'".*?<a:off x=")(-?\d+)(" y=")(-?\d+)'
            r'("/><a:ext cx=")(\d+)(" cy=")(\d+)',
            re.S,
        )
        m = pat.search(xml)
        if not m:
            sys.exit(f"shape not found: {name}")
        xml = (xml[:m.start()] +
               f'{m.group(1)}{x}{m.group(3)}{y}{m.group(5)}{cx}{m.group(7)}{cy}' +
               xml[m.end():])
        print(f"  {name:18} -> off=({x},{y}) ext=({cx},{cy})")

    out = deck.with_suffix(".pptx.tmp")
    zout = zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED)
    for item in zin.infolist():
        data = xml.encode() if item.filename == slide else zin.read(item.filename)
        zout.writestr(item, data)
    zout.close()
    zin.close()
    shutil.move(out, deck)
    print(f"resized to {size} EMU ({size/914400:.2f}in) in {deck}")


if __name__ == "__main__":
    main()
