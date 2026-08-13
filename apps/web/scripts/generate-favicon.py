#!/usr/bin/env python3
"""Generate the SpendTracker favicon.

Draws the mark from geometry and writes apps/web/public/favicon.ico (16, 32 and
48 px) plus apple-touch-icon.png (180 px). Run it after changing the colours or
the shape:

    python3 apps/web/scripts/generate-favicon.py

Standard library only, on purpose: an icon that regenerates on any machine with
python3 is worth more than one that needs a Pillow install first. PNG encoding
is a zlib stream plus four chunks, and an ICO is a small header wrapping those
PNGs, so neither justifies a dependency.

The mark is three ascending bars on the spend red the charts already use
(echartsTheme.ts), which is the app's most recognisable colour. Bars, not a
letter: a glyph survives 16 px, and a monogram of a two-word name does not.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

# Straight from apps/web/src/lib/echartsTheme.ts, where `spend` is the identity
# colour that stays put across light and dark.
GROUND_COLOR = (227, 73, 72, 255)  # #e34948
BAR_COLOR = (255, 255, 255, 255)

ICO_SIZES = (16, 32, 48)
APPLE_TOUCH_SIZE = 180

# Supersampling factor per axis. 4 means 16 samples a pixel, which is what keeps
# the rounded corners and bar edges from looking chewed at 16 px.
SAMPLES_PER_AXIS = 4

# Geometry in unit coordinates, origin top left, so the mark scales to any size.
GROUND_RADIUS = 0.22
BAR_COUNT = 3
BAR_WIDTH = 0.18
BAR_GAP = 0.07
BAR_RADIUS = 0.035
BAR_BASELINE = 0.79
BAR_TOPS = (0.50, 0.34, 0.18)

Color = tuple[int, int, int, int]


def rounded_rect_contains(
    x: float,
    y: float,
    left: float,
    top: float,
    right: float,
    bottom: float,
    radius: float,
) -> bool:
    """Whether (x, y) falls inside a rounded rectangle."""
    if x < left or x > right or y < top or y > bottom:
        return False

    radius = min(radius, (right - left) / 2, (bottom - top) / 2)
    if radius <= 0:
        return True

    # Only the four corner boxes need the circular test; everything else is
    # inside by the bounds check above.
    corner_x = None
    corner_y = None
    if x < left + radius:
        corner_x = left + radius
    elif x > right - radius:
        corner_x = right - radius
    if y < top + radius:
        corner_y = top + radius
    elif y > bottom - radius:
        corner_y = bottom - radius

    if corner_x is None or corner_y is None:
        return True

    return (x - corner_x) ** 2 + (y - corner_y) ** 2 <= radius**2


def bar_bounds() -> list[tuple[float, float, float, float]]:
    """The three bars as (left, top, right, bottom) in unit coordinates."""
    span = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP
    first_left = (1.0 - span) / 2
    bars = []
    for index, bar_top in enumerate(BAR_TOPS):
        left = first_left + index * (BAR_WIDTH + BAR_GAP)
        bars.append((left, bar_top, left + BAR_WIDTH, BAR_BASELINE))
    return bars


def sample_color(x: float, y: float, bars: list[tuple[float, float, float, float]]) -> Color | None:
    """The colour at a unit-coordinate point, or None where the icon is transparent."""
    if not rounded_rect_contains(x, y, 0.0, 0.0, 1.0, 1.0, GROUND_RADIUS):
        return None
    for left, top, right, bottom in bars:
        if rounded_rect_contains(x, y, left, top, right, bottom, BAR_RADIUS):
            return BAR_COLOR
    return GROUND_COLOR


def render_rgba(size: int) -> bytes:
    """Render the mark at `size` px as raw RGBA rows."""
    bars = bar_bounds()
    sample_count = SAMPLES_PER_AXIS * SAMPLES_PER_AXIS
    pixels = bytearray()

    for row in range(size):
        for column in range(size):
            red_total = green_total = blue_total = alpha_total = 0
            for sub_row in range(SAMPLES_PER_AXIS):
                for sub_column in range(SAMPLES_PER_AXIS):
                    x = (column + (sub_column + 0.5) / SAMPLES_PER_AXIS) / size
                    y = (row + (sub_row + 0.5) / SAMPLES_PER_AXIS) / size
                    color = sample_color(x, y, bars)
                    if color is None:
                        continue
                    red_total += color[0]
                    green_total += color[1]
                    blue_total += color[2]
                    alpha_total += color[3]

            if alpha_total == 0:
                pixels.extend((0, 0, 0, 0))
                continue

            # Average the colour over the samples that actually landed on the
            # mark, then let coverage drive alpha. Averaging colour over the
            # empty samples too would darken every edge toward black.
            covered = alpha_total / 255
            pixels.extend(
                (
                    round(red_total / covered),
                    round(green_total / covered),
                    round(blue_total / covered),
                    round(alpha_total / sample_count),
                )
            )

    return bytes(pixels)


def png_chunk(tag: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + tag
        + payload
        + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
    )


def encode_png(size: int, rgba: bytes) -> bytes:
    """Minimal RGBA PNG: signature, IHDR, IDAT, IEND."""
    stride = size * 4
    # Filter byte 0 (None) in front of every scanline.
    raw = b"".join(b"\x00" + rgba[row * stride : (row + 1) * stride] for row in range(size))
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", zlib.compress(raw, 9))
        + png_chunk(b"IEND", b"")
    )


def encode_ico(images: list[tuple[int, bytes]]) -> bytes:
    """Pack PNG payloads into an ICO container.

    PNG-compressed entries are what every current browser reads, and they keep
    the file a fraction of the size of the equivalent BMP entries.
    """
    header = struct.pack("<HHH", 0, 1, len(images))
    directory = b""
    payloads = b""
    offset = len(header) + 16 * len(images)

    for size, png in images:
        # 0 in the size byte means 256 in the ICO format.
        directory += struct.pack(
            "<BBBBHHII",
            size if size < 256 else 0,
            size if size < 256 else 0,
            0,  # palette entries, 0 for a true-colour image
            0,  # reserved
            1,  # colour planes
            32,  # bits per pixel
            len(png),
            offset,
        )
        payloads += png
        offset += len(png)

    return header + directory + payloads


def main() -> None:
    public_directory = Path(__file__).resolve().parents[1] / "public"
    public_directory.mkdir(parents=True, exist_ok=True)

    ico_images = [(size, encode_png(size, render_rgba(size))) for size in ICO_SIZES]
    ico_path = public_directory / "favicon.ico"
    ico_path.write_bytes(encode_ico(ico_images))
    print(f"wrote {ico_path} ({', '.join(f'{size}x{size}' for size in ICO_SIZES)})")

    apple_touch_png = encode_png(APPLE_TOUCH_SIZE, render_rgba(APPLE_TOUCH_SIZE))
    apple_touch_path = public_directory / "apple-touch-icon.png"
    apple_touch_path.write_bytes(apple_touch_png)
    print(f"wrote {apple_touch_path} ({APPLE_TOUCH_SIZE}x{APPLE_TOUCH_SIZE})")


if __name__ == "__main__":
    main()
