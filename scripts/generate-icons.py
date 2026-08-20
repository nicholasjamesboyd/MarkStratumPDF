"""Generate app icons and branding assets from public/logo-source.png."""

from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "logo-source.png"
PUBLIC = ROOT / "public"
BUILD = ROOT / "build"

ICO_SIZES = (256, 128, 64, 48, 32, 16)
NEAR_WHITE = 236
SHADOW_CHROMA = 18
SHADOW_MIN = 70
SHADOW_DILATE = 7
CONTENT_PADDING_RATIO = 0.03
ICON_BACKGROUND = (255, 255, 255)


def as_rgb(image: Image.Image) -> Image.Image:
    if image.mode == "RGBA":
        canvas = Image.new("RGB", image.size, ICON_BACKGROUND)
        canvas.paste(image, mask=image.getchannel("A"))
        return canvas
    return image.convert("RGB")


def outer_background_mask(rgb: Image.Image) -> Image.Image:
    width, height = rgb.size
    pixels = rgb.load()
    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def is_background(x: int, y: int) -> bool:
        red, green, blue = pixels[x, y]
        if red >= NEAR_WHITE and green >= NEAR_WHITE and blue >= NEAR_WHITE:
            return True
        chroma = max(red, green, blue) - min(red, green, blue)
        return chroma <= SHADOW_CHROMA and min(red, green, blue) >= SHADOW_MIN

    def enqueue(x: int, y: int) -> None:
        if not is_background(x, y):
            return
        index = y * width + x
        if visited[index]:
            return
        visited[index] = 1
        queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        if x > 0:
            enqueue(x - 1, y)
        if x + 1 < width:
            enqueue(x + 1, y)
        if y > 0:
            enqueue(x, y - 1)
        if y + 1 < height:
            enqueue(x, y + 1)

    mask = Image.frombytes("L", (width, height), bytes(b * 255 for b in visited))
    return mask.filter(ImageFilter.MaxFilter(SHADOW_DILATE))


def crop_content(image: Image.Image, background_mask: Image.Image) -> tuple[Image.Image, Image.Image]:
    content = Image.eval(background_mask, lambda value: 0 if value else 255)
    bbox = content.getbbox()
    if bbox is None:
        return image, background_mask

    left, top, right, bottom = bbox
    pad = max(2, round(max(right - left, bottom - top) * CONTENT_PADDING_RATIO))
    crop_box = (
        max(0, left - pad),
        max(0, top - pad),
        min(image.width, right + pad),
        min(image.height, bottom + pad),
    )
    return image.crop(crop_box), background_mask.crop(crop_box)


def to_transparent(rgb: Image.Image, background_mask: Image.Image) -> Image.Image:
    alpha = Image.eval(background_mask, lambda value: 0 if value else 255)
    rgba = rgb.convert("RGBA")
    rgba.putalpha(alpha)
    return rgba


def flatten_background(rgb: Image.Image, background_mask: Image.Image) -> Image.Image:
    white = Image.new("RGB", rgb.size, ICON_BACKGROUND)
    return Image.composite(white, rgb, background_mask)


def fit_on_square(source: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGB", (size, size), ICON_BACKGROUND)
    src = as_rgb(source)
    scale = min(size / src.width, size / src.height)
    target = (max(1, round(src.width * scale)), max(1, round(src.height * scale)))
    resized = src.resize(target, Image.Resampling.LANCZOS)
    offset = ((size - target[0]) // 2, (size - target[1]) // 2)
    canvas.paste(resized, offset)
    return canvas


def write_ico(path: Path, images: list[Image.Image]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    images[0].save(
        path,
        format="ICO",
        sizes=[(image.width, image.height) for image in images],
        append_images=images[1:],
    )


def main() -> int:
    if not SOURCE.exists():
        print(f"Missing source image: {SOURCE}", file=sys.stderr)
        return 1

    rgb = as_rgb(Image.open(SOURCE))
    background_mask = outer_background_mask(rgb)
    cropped_rgb, cropped_mask = crop_content(rgb, background_mask)
    transparent = to_transparent(cropped_rgb, cropped_mask)
    opaque = flatten_background(cropped_rgb, cropped_mask)

    PUBLIC.mkdir(parents=True, exist_ok=True)
    BUILD.mkdir(parents=True, exist_ok=True)

    transparent.save(PUBLIC / "markstratum-logo.png", format="PNG", optimize=True)

    square_icons = [fit_on_square(opaque, size) for size in ICO_SIZES]
    write_ico(PUBLIC / "favicon.ico", square_icons)
    write_ico(BUILD / "icon.ico", square_icons)

    icon_256 = fit_on_square(opaque, 256)
    icon_256.save(PUBLIC / "icon-256.png", format="PNG", optimize=True)
    fit_on_square(opaque, 512).save(BUILD / "icon.png", format="PNG", optimize=True)

    print("Generated branding assets from public/logo-source.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
