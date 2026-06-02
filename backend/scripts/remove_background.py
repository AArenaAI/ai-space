#!/usr/bin/env python3
"""Pixel-size-preserving background removal.

This script removes only the background alpha channel. It does not upscale,
recompose, crop, or enhance the image. Output dimensions are guaranteed to
match input dimensions; failure is reported if a provider/library returns a
mismatched size.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageOps
from rembg import remove, new_session


def main() -> int:
    parser = argparse.ArgumentParser(description="Remove image background while preserving original dimensions")
    parser.add_argument("--input", required=True, help="Input image path")
    parser.add_argument("--output", required=True, help="Output PNG path")
    parser.add_argument("--model", default="u2net", help="rembg model name, default: u2net")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    if not input_path.exists():
        print(json.dumps({"ok": False, "error": f"input_not_found: {input_path}"}, ensure_ascii=False), file=sys.stderr)
        return 2

    try:
        with Image.open(input_path) as im:
            # Normalize EXIF orientation up front so JPEGs from phones/cameras keep
            # the same visual orientation the browser shows. Without this, rembg/PIL
            # may output 3024x4032 for a raw 4032x3024 JPEG with Orientation=6,
            # causing a false size-mismatch failure.
            source = ImageOps.exif_transpose(im).convert("RGBA")
            original_size = source.size

        # rembg performs segmentation and returns an RGBA cutout at the same visual size.
        session = new_session(args.model)
        result = remove(source, session=session)
        if not isinstance(result, Image.Image):
            raise TypeError(f"rembg returned unsupported result type: {type(result).__name__}")
        result = result.convert("RGBA")

        if result.size != original_size:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "error": "size_mismatch",
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
