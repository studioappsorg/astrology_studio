"""
AstrologyStudio ·
web/fonts/make-glyph-font.py

Builds the app's symbol font, "Studio Astro Glyphs", from Roberto Corona's Astronomicon.

Astronomicon puts its symbols on keyboard characters (Q is the Sun, A is Aries, ! is the
conjunction). The app writes the standard Unicode astrology characters (☉, ♈, ☌), so this
copies each symbol onto its Unicode character and keeps only those. Text that has nothing to
do with astrology is never drawn with it.

The OFL forbids a modified version from using the reserved name "Astronomicon", hence the new
name. The copyright notice and licence travel with it (OFL.txt and the font's own metadata).

    .venv/bin/python web/fonts/make-glyph-font.py path/to/Astronomicon.ttf

(on Windows, .venv/Scripts/python). fonttools and brotli come with the development setup
(server[dev], which F5 installs); elsewhere, pip install fonttools brotli first.

writes web/fonts/StudioAstroGlyphs.woff2. Download Astronomicon from
https://astronomicon.co/en/astronomicon-fonts/ (version 1.1).

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

FAMILY = "Studio Astro Glyphs"

# Unicode character the app uses -> the Astronomicon character holding that symbol.
MAP = {
    # Signs (Capricorn in the European form, J; the American form is \)
    **{chr(0x2648 + i): src for i, src in enumerate("ABCDEFGHIJKL")},
    # Planets and points
    "☉": "Q",
    "☽": "R",
    "☿": "S",
    "♀": "T",
    "♂": "U",
    "♃": "V",
    "♄": "W",
    "♅": "X",
    "♆": "Y",
    "♇": "Z",
    "♁": "h",
    "⚷": "q",
    "⚳": "l",
    "⚴": "m",
    "⚵": "n",
    "⚶": "o",
    "☊": "g",
    "☋": "i",
    "⚸": "z",
    "⊗": "?",
    "℞": "M",
    # Aspects
    "☌": "!",
    "☍": '"',
    "□": "#",
    "△": "$",
    "⚹": "%",
    "⚻": "&",
    "⚺": "'",
    "∠": "(",
    "⚼": ")",
    # No Unicode characters exist for these, so they use the private use area (see astro.ts).
    "": "+",  # quintile
    "": "*",  # biquintile
}


def main(source: str) -> None:
    font = TTFont(source)
    names = font.getBestCmap()
    unicode_map = {ord(target): names[ord(src)] for target, src in MAP.items()}
    for table in font["cmap"].tables:
        if table.isUnicode():
            table.cmap.update(unicode_map)

    options = subset.Options()
    options.name_IDs = ["*"]
    options.notdef_outline = True
    options.flavor = "woff2"
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=list(unicode_map))
    subsetter.subset(font)

    name = font["name"]
    for record in list(name.names):
        if record.nameID in (1, 3, 4, 16, 18, 21):
            record.string = FAMILY
        elif record.nameID == 6:
            record.string = FAMILY.replace(" ", "")
        elif record.nameID == 5:
            record.string = "Version 1.1; derived from Astronomicon 1.1 by Roberto Corona"
    out = Path(__file__).with_name("StudioAstroGlyphs.woff2")
    font.save(out)
    print(f"Wrote {out} ({out.stat().st_size} bytes, {len(unicode_map)} symbols)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "Astronomicon.ttf")
