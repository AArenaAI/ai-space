#!/usr/bin/env python3
"""Local text/watermark removal without generative image rewriting.

The script normalizes EXIF orientation, builds a conservative text-like mask with
OpenCV morphology/contour heuristics, and inpaints only the masked pixels. It
keeps the output canvas exactly equal to the visual input size.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps


def odd_kernel(value: int) -> int:
    value = max(3, int(value))
    return value if value % 2 == 1 else value + 1


def merge_close_components(mask: np.ndarray, width: int, height: int) -> np.ndarray:
    # Link neighboring glyph strokes into word/line masks without expanding to the
    # whole image. Kernel sizes scale with image dimensions.
    kx = max(3, width // 180)
    ky = max(2, height // 240)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kx, ky))
    merged = cv2.dilate(mask, kernel, iterations=1)
    merged = cv2.morphologyEx(merged, cv2.MORPH_CLOSE, kernel, iterations=1)
    return merged


def component_filter(mask: np.ndarray, width: int, height: int) -> np.ndarray:
    filtered = np.zeros_like(mask)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    image_area = width * height
    min_area = max(8, image_area // 250000)
    max_area = max(2000, image_area // 18)
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        roi = mask[y : y + h, x : x + w]
        area = int(np.count_nonzero(roi))
        if area < min_area or area > max_area:
            continue
        if w < 2 or h < 2:
            continue
        if w > width * 0.95 or h > height * 0.35:
            continue
        aspect = w / float(h)
        fill = area / float(w * h)
        # Text/watermarks are often long/thin or clusters of small glyphs. Keep a
        # broad range but reject solid blocks and very tall photographic regions.
        if aspect < 0.08 or aspect > 80:
            continue
        if fill > 0.97:
            continue
        if h > height * 0.22 and w > width * 0.35:
            continue
        cv2.drawContours(filtered, [cnt], -1, 255, thickness=cv2.FILLED)
    return filtered


def build_text_mask(rgb: np.ndarray) -> np.ndarray:
    height, width = rgb.shape[:2]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)

    # Normalize illumination while preserving edges/strokes.
    gray_blur = cv2.GaussianBlur(gray, (3, 3), 0)
    candidates: list[np.ndarray] = []

    # Dark-on-light and light-on-dark text via blackhat/tophat.
    for scale in (80, 45, 28):
        kx = odd_kernel(max(5, width // scale))
        ky = odd_kernel(max(3, height // (scale * 2)))
        rect = cv2.getStructuringElement(cv2.MORPH_RECT, (kx, ky))
        blackhat = cv2.morphologyEx(gray_blur, cv2.MORPH_BLACKHAT, rect)
        tophat = cv2.morphologyEx(gray_blur, cv2.MORPH_TOPHAT, rect)
        for img in (blackhat, tophat):
            _, th = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
            candidates.append(th)

    # Edge-rich small strokes.
    edges = cv2.Canny(gray_blur, 60, 180)
    candidates.append(edges)

    # High-saturation/bright overlay text often used in watermarks/subtitles.
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    sat = hsv[:, :, 1]
    val = hsv[:, :, 2]
    color_text = np.zeros_like(gray)
    # Saturated overlays and very dark strokes are reliable direct candidates.
    # Do not mark all bright low-saturation pixels: light skies/walls would become
    # one huge component and swallow nearby white text before filtering.
    color_text[((sat > 80) & (val > 100)) | ((val < 55) & (sat < 110))] = 255
    candidates.append(color_text)

    combined = np.zeros_like(gray)
    for cand in candidates:
        combined = cv2.bitwise_or(combined, cand)

    combined = merge_close_components(combined, width, height)
    combined = component_filter(combined, width, height)

    # Slight expansion covers anti-aliased glyph edges. Keep it modest so non-text
    # parts are preserved as much as possible.
    dilate_px = max(1, round(min(width, height) / 500))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * dilate_px + 1, 2 * dilate_px + 1))
    combined = cv2.dilate(combined, kernel, iterations=1)
    combined = cv2.GaussianBlur(combined, (3, 3), 0)
    _, combined = cv2.threshold(combined, 20, 255, cv2.THRESH_BINARY)
    return combined


def main() -> int:
    parser = argparse.ArgumentParser(description="Remove text/watermarks locally while preserving visual dimensions")
    parser.add_argument("--input", required=True, help="Input source image path")
    parser.add_argument("--output", required=True, help="Output PNG path")
    parser.add_argument("--prompt", default="", help="User text description; currently used for logging only")
    parser.add_argument("--mask-output", default="", help="Optional debug mask output path")
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
        mask = build_text_mask(rgb)

        if args.mask_output:
            mask_path = Path(args.mask_output)
            mask_path.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(mask).save(mask_path)

        # OpenCV expects BGR. Telea inpaint changes only masked pixels.
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        radius = max(3, round(min(original_size) / 350))
        repaired_bgr = cv2.inpaint(bgr, mask, radius, cv2.INPAINT_TELEA)
        repaired_rgb = cv2.cvtColor(repaired_bgr, cv2.COLOR_BGR2RGB)
        result = Image.fromarray(repaired_rgb, mode="RGB")

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
        mask_pixels = int(np.count_nonzero(mask))
        total_pixels = int(mask.shape[0] * mask.shape[1])
        print(
            json.dumps(
                {
                    "ok": True,
                    "input_size": [original_size[0], original_size[1]],
                    "output_size": [result.size[0], result.size[1]],
                    "mask_pixels": mask_pixels,
                    "mask_coverage": round(mask_pixels / total_pixels, 6) if total_pixels else 0,
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
