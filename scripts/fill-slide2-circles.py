#!/usr/bin/env python3
"""Fill slide 2's Kristoff and Anna circles with photos.

    python3 scripts/fill-slide2-circles.py <deck.pptx> <kristoff.png> <anna.png>

The circles are ellipse shapes named ph-kristoff and ph-anna. Giving the shape a
picture fill means PowerPoint clips the photo to the ellipse itself, so the crop
follows the circle instead of leaving square corners. Each source is centre
cropped to a square first, so a portrait or landscape photo keeps its
proportions rather than being squashed into the circle.

Rewrites the deck in place. Keep an untouched original beside it.
"""
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

SHAPES = {"ph-kristoff": None, "ph-anna": None}


def square_crop(src: Path, out: Path, size: int = 900) -> None:
    """Centre crop to a square and resize, using sips (ships with macOS)."""
    dims = subprocess.run(
        ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(src)],
        capture_output=True, text=True, check=True,
    ).stdout
    w = int(re.search(r"pixelWidth:\s*(\d+)", dims).group(1))
    h = int(re.search(r"pixelHeight:\s*(\d+)", dims).group(1))
    side = min(w, h)
    shutil.copy(src, out)
    subprocess.run(["sips", "-c", str(side), str(side), str(out)],
                   capture_output=True, check=True)
    subprocess.run(["sips", "-z", str(size), str(size), str(out)],
                   capture_output=True, check=True)
    subprocess.run(["sips", "-s", "format", "png", str(out)],
                   capture_output=True, check=True)


def main() -> None:
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    deck, kris, anna = (Path(a) for a in sys.argv[1:4])
    for p in (deck, kris, anna):
        if not p.exists():
            sys.exit(f"missing: {p}")

    tmp = Path(tempfile.mkdtemp())
    SHAPES["ph-kristoff"] = tmp / "kristoff.png"
    SHAPES["ph-anna"] = tmp / "anna.png"
    square_crop(kris, SHAPES["ph-kristoff"])
    square_crop(anna, SHAPES["ph-anna"])

    zin = zipfile.ZipFile(deck)
    names = set(zin.namelist())
    slide, rels_path = "ppt/slides/slide2.xml", "ppt/slides/_rels/slide2.xml.rels"
    xml = zin.read(slide).decode()
    rels = zin.read(rels_path).decode()

    used = [int(m) for m in re.findall(r'Id="rId(\d+)"', rels)]
    next_rid = max(used, default=0) + 1
    media_nums = [int(m) for m in re.findall(r"ppt/media/image(\d+)\.png", "\n".join(names))]
    next_img = max(media_nums, default=0) + 1

    additions, new_rels = {}, []
    for shape, img in SHAPES.items():
        media = f"ppt/media/image{next_img}.png"
        rid = f"rId{next_rid}"
        additions[media] = img.read_bytes()
        new_rels.append(
            f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/'
            f'officeDocument/2006/relationships/image" Target="../media/image{next_img}.png"/>'
        )

        pattern = re.compile(r'(<p:sp>(?:(?!</p:sp>).)*?name="' + shape + r'".*?</p:sp>)', re.S)
        m = pattern.search(xml)
        if not m:
            sys.exit(f"shape not found: {shape}")
        sp = m.group(1)

        # Picture fill in place of the flat colour.
        sp2 = re.sub(
            r"<a:solidFill><a:srgbClr val=\"1A2437\"/></a:solidFill>",
            f'<a:blipFill rotWithShape="1"><a:blip r:embed="{rid}"/>'
            f"<a:stretch><a:fillRect/></a:stretch></a:blipFill>",
            sp, count=1,
        )
        # A dashed outline reads as "placeholder"; a thin solid ring frames a face.
        sp2 = sp2.replace('<a:prstDash val="dash"/>', "")
        sp2 = sp2.replace('<a:ln w="9525">', '<a:ln w="12700">')
        # Drop the K / A letter now that there is a face behind it.
        sp2 = re.sub(r"<a:r>.*?</a:r>", "", sp2, flags=re.S)

        xml = xml.replace(sp, sp2, 1)
        next_rid += 1
        next_img += 1

    rels = rels.replace("</Relationships>", "".join(new_rels) + "</Relationships>")

    out = deck.with_suffix(".pptx.tmp")
    zout = zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED)
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == slide:
            data = xml.encode()
        elif item.filename == rels_path:
            data = rels.encode()
        zout.writestr(item, data)
    for path, blob in additions.items():
        zout.writestr(path, blob)
    zout.close()
    zin.close()
    shutil.move(out, deck)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"filled both circles in {deck}")


if __name__ == "__main__":
    main()
