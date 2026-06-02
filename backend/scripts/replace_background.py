#!/usr/bin/env python3
"""Pixel-position-preserving background replacement.

This script keeps the original subject pixels in their original visual position.
It normalizes EXIF orientation, removes only the original background to obtain an
alpha cutout, resizes/crops a generated background to cover the same canvas, then
alpha-composites the original cutout over that background.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageOps
from rembg import remove, new_session


def cover_resize(im: Image.Image, size: tuple[int, int]) -> Image.Image:
    target_w, target_h = size
    src_w, src_h = im.size
    if src_w <= 0 or src_h <= 0 or target_w <= 0 or target_h <= 0:
        raise ValueError(f"invalid_size: src={im.size} target={size}")
    scale = max(target_w / src_w, target_h / src_h)
    new_w = max(1, round(src_w * scale))
    new_h = max(1, round(src_h * scale))
    resized = im.resize((new_w, new_h), Image.Resampling.LANCZOS)
    left = max(0, (new_w - target_w) // 2)
    top = max(0, (new_h - target_h) // 2)
    return resized.crop((left, top, left + target_w, top + target_h))


def main() -> int:
    parser = argparse.ArgumentParser(description="Replace background while preserving original subject pixels and visual dimensions")
    parser.add_argument("--input", required=True, help="Input source image path")
    parser.add_argument("--background", required=True, help="Generated background image path")
    parser.add_argument("--output", required=True, help="Output PNG path")
    parser.add_argument("--model", default="u2net", help="rembg model name, default: u2net")
    args = parser.parse_args()

    input_path = Path(args.input)
    background_path = Path(args.background)
    output_path = Path(args.output)
    if not input_path.exists():
        print(json.dumps({"ok": False, "error": f"input_not_found: {input_path}"}, ensure_ascii=False), file=sys.stderr)
        return 2
    if not background_path.exists():
        print(json.dumps({"ok": False, "error": f"background_not_found: {background_path}"}, ensure_ascii=False), file=sys.stderr)
        return 2

    try:
        with Image.open(input_path) as im:
            source = ImageOps.exif_transpose(im).convert("RGBA")
        original_size = source.size

        session = new_session(args.model)
        cutout = remove(source, session=session)
        if not isinstance(cutout, Image.Image):
            raise TypeError(f"rembg returned unsupported result type: {type(cutout).__name__}")
        cutout = cutout.convert("RGBA")
        if cutout.size != original_size:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "error": "cutout_size_mismatch",
                        "input_size": [original_size[0], original_size[1]],
                        "cutout_size": [cutout.size[0], cutout.size[1]],
                    },
                    ensure_ascii=False,
                ),
                file=sys.stderr,
            )
            return 3

        with Image.open(background_path) as bg_im:
            background = ImageOps.exif_transpose(bg_im).convert("RGBA")
        background = cover_resize(background, original_size)

        # Preserve source RGB only where the matte keeps the subject. The model-generated
        # image is used as background layer only, never as a source for the subject.
        result = Image.alpha_composite(background, cutout).convert("RGBA")
        if result.size != original_size:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "error": "output_size_mismatch",
                        "input_size": [original_size[0], original_size[1]],
                        "output_size": [result.size[0], result.size[1]],
                    },
                    ensure_ascii=False,
                ),
                file=sys.stderr,
            )
            return 3

        output_path.parent.mkdir(parents=True, exist_ok=True)
        result.save(output_path, format="PNG")
        print(
            json.dumps(
                {
                    "ok": True,
                    "input_size": [original_size[0], original_size[1]],
                    "background_size": [background.size[0], background.size[1]],
                    "output_size": [result.size[0], result.size[1]],
                    "output": str(output_path),
                },
                ensure_ascii=False,
            )
        )
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
