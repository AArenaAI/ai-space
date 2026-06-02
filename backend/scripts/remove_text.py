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


def remove_skinny_full_height_artifacts(mask: np.ndarray, width: int, height: int) -> np.ndarray:
    """Drop crop/border artifacts that run through most of the image."""
    cleaned = mask.copy()
    contours, _ = cv2.findContours(cleaned, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        if h > height * 0.70 and w <= max(4, int(width * 0.03)):
            cv2.drawContours(cleaned, [cnt], -1, 0, thickness=cv2.FILLED)
        elif w > width * 0.70 and h <= max(4, int(height * 0.03)):
            cv2.drawContours(cleaned, [cnt], -1, 0, thickness=cv2.FILLED)
    return cleaned


def glyph_candidate_filter(mask: np.ndarray, width: int, height: int) -> np.ndarray:
    """Keep only small stroke-like components before word/line merging.

    This prevents non-text objects such as desktop/app icons from being joined
    with their nearby labels and removed as one large block.
    """
    filtered = np.zeros_like(mask)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    image_area = width * height
    min_area = max(3, image_area // 600000)
    max_glyph_h = max(36, int(height * 0.07))
    max_glyph_w = max(80, int(width * 0.45))
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        if w < 1 or h < 1:
            continue
        roi = mask[y : y + h, x : x + w]
        area = int(np.count_nonzero(roi))
        if area < min_area:
            continue
        fill = area / float(w * h)
        aspect = w / float(h)

        # Icons/logos and UI blocks are usually square-ish, saturated, and/or
        # much larger than individual glyph strokes. Reject them before dilation
        # can merge them with adjacent text labels.
        if h > max_glyph_h and aspect < 3.0:
            continue
        if w > max_glyph_w and aspect < 1.8:
            continue
        if fill > 0.72 and 0.35 <= aspect <= 3.2 and max(w, h) > 12:
            continue
        if h > height * 0.20 or w > width * 0.90:
            continue
        cv2.drawContours(filtered, [cnt], -1, 255, thickness=cv2.FILLED)
    return filtered


def component_filter(mask: np.ndarray, width: int, height: int) -> np.ndarray:
    filtered = np.zeros_like(mask)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    image_area = width * height
    min_area = max(8, image_area // 250000)
    max_area = max(2000, image_area // 22)
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        roi = mask[y : y + h, x : x + w]
        area = int(np.count_nonzero(roi))
        if area < min_area or area > max_area:
            continue
        if w < 2 or h < 2:
            continue
        if w > width * 0.95 or h > height * 0.28:
            continue
        aspect = w / float(h)
        fill = area / float(w * h)
        # Text/watermarks are often long/thin or clusters of small glyphs. Be
        # conservative: square/tall merged regions are usually icons or content,
        # not text lines.
        if aspect < 0.12 or aspect > 80:
            continue
        if fill > 0.92:
            continue
        if h > max(70, height * 0.10) and aspect < 2.0:
            continue
        if h > height * 0.18 and w > width * 0.25:
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

    # Very dark strokes are reliable direct candidates. Avoid using saturation as
    # a direct signal here: app/file icons are often saturated and sit directly
    # above labels, so a saturated-icon mask can merge with label text and erase
    # the whole desktop item.
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    sat = hsv[:, :, 1]
    val = hsv[:, :, 2]
    color_text = np.zeros_like(gray)
    color_text[(val < 55) & (sat < 140)] = 255
    candidates.append(color_text)

    combined = np.zeros_like(gray)
    for cand in candidates:
        cand = remove_skinny_full_height_artifacts(cand, width, height)
        combined = cv2.bitwise_or(combined, glyph_candidate_filter(cand, width, height))

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
