#!/usr/bin/env python3
"""Local same-size image quality enhancement without generative rewriting.

This script is for the strict "画质高清" tool semantics: improve clarity only,
without changing the visual canvas size, aspect ratio, composition, subject, or
content. It normalizes EXIF orientation to match browser visual orientation and
applies conservative denoise/contrast/sharpen filters at the original size.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageFilter, ImageOps


def enhance_rgb(rgb: np.ndarray) -> np.ndarray:
    """Apply conservative same-size enhancement.

    The operations are deterministic pixel filters, not generative restoration:
    - light color denoise to reduce compression noise
    - mild CLAHE on luminance to improve local contrast
    - unsharp masking to recover edge clarity

    All arrays keep the exact original HxW shape.
    """
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ValueError("expected RGB image")

    # OpenCV works in BGR. Keep denoising conservative to avoid painterly changes.
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    denoised = cv2.fastNlMeansDenoisingColored(bgr, None, 3, 3, 7, 21)

    # Local contrast on luminance only; clip limit is intentionally low to avoid
    # changing the mood/lighting or creating halos.
    lab = cv2.cvtColor(denoised, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=1.25, tileGridSize=(8, 8))
    l2 = clahe.apply(l)
    contrast_bgr = cv2.cvtColor(cv2.merge((l2, a, b)), cv2.COLOR_LAB2BGR)
    contrast_rgb = cv2.cvtColor(contrast_bgr, cv2.COLOR_BGR2RGB)

    # PIL UnsharpMask is stable and same-size. Moderate values avoid inventing
    # detail or changing object boundaries.
    pil = Image.fromarray(contrast_rgb, mode="RGB")
    sharpened = pil.filter(ImageFilter.UnsharpMask(radius=1.1, percent=85, threshold=4))
    return np.array(sharpened, dtype=np.uint8)


def main() -> int:
    parser = argparse.ArgumentParser(description="Enhance image quality locally while preserving visual dimensions")
    parser.add_argument("--input", required=True, help="Input source image path")
    parser.add_argument("--output", required=True, help="Output PNG path")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    if not input_path.exists():
        print(json.dumps({"ok": False, "error": f"input_not_found: {input_path}"}, ensure_ascii=False), file=sys.stderr)
        return 2

    try:
        with Image.open(input_path) as im:
            source = ImageOps.exif_transpose(im).convert("RGB")
        original_size = source.size
        rgb = np.array(source)
        enhanced = enhance_rgb(rgb)
        result = Image.fromarray(enhanced, mode="RGB")

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
