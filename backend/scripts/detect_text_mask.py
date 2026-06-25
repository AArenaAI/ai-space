#!/usr/bin/env python3
"""Detect text regions in an image using PaddleOCR.

Returns JSON on stdout with text region coordinates and content, allowing the
frontend to show a preview overlay so users can select which text to remove.

Falls back to OpenCV morphology detection when PaddleOCR is unavailable.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps


def detect_with_paddle(image_path: str) -> list[dict]:
    """Use PaddleOCR to detect text regions.

    Returns a list of regions:
        [{"bbox": [x1, y1, x2, y2], "text": "...", "confidence": 0.95}, ...]
    """
    from paddleocr import PaddleOCR

    # use angle classification + detection, no recognition needed for removal
    # but recognition helps user identify which text block is which
    ocr = PaddleOCR(use_textline_orientation=True, lang="ch")

    with Image.open(image_path) as im:
        source = ImageOps.exif_transpose(im)
        rgb = np.array(source.convert("RGB"))
        # PaddleOCR expects BGR
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

    result = ocr.ocr(bgr, cls=True)

    regions: list[dict] = []
    if not result or not result[0]:
        return regions

    for line in result[0]:
        box_points = line[0]  # [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
        text_info = line[1]   # (text, confidence)

        xs = [int(p[0]) for p in box_points]
        ys = [int(p[1]) for p in box_points]
        x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)

        text = str(text_info[0]) if text_info and text_info[0] else ""
        conf = float(text_info[1]) if text_info and len(text_info) > 1 else 0.0

        # Skip tiny detections (< 6px in any dimension)
        if (x2 - x1) < 6 or (y2 - y1) < 6:
            continue

        regions.append({
            "bbox": [x1, y1, x2, y2],
            "text": text,
            "confidence": round(conf, 3),
        })

    return regions


def detect_with_opencv(image_path: str, sub_mode: str = "auto") -> list[dict]:
    """Fallback: OpenCV morphology-based text region detection.

    Uses the existing build_text_mask logic from remove_text.py to generate
    a mask, then extracts bounding boxes from the mask contours.
    """
    # Import from remove_text.py
    script_dir = Path(__file__).parent
    sys.path.insert(0, str(script_dir))
    from remove_text import build_text_mask  # type: ignore

    with Image.open(image_path) as im:
        source = ImageOps.exif_transpose(im).convert("RGB")
        rgb = np.array(source)

    height, width = rgb.shape[:2]
    mask = build_text_mask(rgb, sub_mode)

    regions: list[dict] = []
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        if w < 4 or h < 4:
            continue
        # Skip very large regions (likely false positives)
        if w > width * 0.9 or h > height * 0.4:
            continue
        area = int(np.count_nonzero(mask[y:y+h, x:x+w]))
        if area < 8:
            continue
        regions.append({
            "bbox": [x, y, x + w, y + h],
            "text": "",  # No OCR text available
            "confidence": 0.5,
        })

    return regions


def merge_overlapping(regions: list[dict], overlap_threshold: float = 0.6) -> list[dict]:
    """Merge overlapping text regions to reduce duplicates."""
    if len(regions) <= 1:
        return regions

    # Sort by area descending
    def area(r):
        b = r["bbox"]
        return (b[2] - b[0]) * (b[3] - b[1])

    regions_sorted = sorted(regions, key=area, reverse=True)
    merged: list[dict] = []
    used = [False] * len(regions_sorted)

    for i, r in enumerate(regions_sorted):
        if used[i]:
            continue
        bx1, by1, bx2, by2 = r["bbox"]
        bw, bh = bx2 - bx1, by2 - by1

        for j in range(i + 1, len(regions_sorted)):
            if used[j]:
                continue
            ax1, ay1, ax2, ay2 = regions_sorted[j]["bbox"]
            aw, ah = ax2 - ax1, ay2 - ay1

            # Compute intersection
            ix1 = max(bx1, ax1)
            iy1 = max(by1, ay1)
            ix2 = min(bx2, ax2)
            iy2 = min(by2, ay2)

            if ix1 < ix2 and iy1 < iy2:
                inter = (ix2 - ix1) * (iy2 - iy1)
                smaller = min(aw * ah, bw * bh)
                if smaller > 0 and (inter / smaller) > overlap_threshold:
                    # Merge: expand bounding box
                    bx1 = min(bx1, ax1)
                    by1 = min(by1, ay1)
                    bx2 = max(bx2, ax2)
                    by2 = max(by2, ay2)
                    bw, bh = bx2 - bx1, by2 - by1
                    used[j] = True

        merged.append({
            "bbox": [bx1, by1, bx2, by2],
            "text": r["text"],
            "confidence": r["confidence"],
        })
        used[i] = True

    return merged


def main() -> int:
    parser = argparse.ArgumentParser(description="Detect text regions for removal preview")
    parser.add_argument("--input", required=True, help="Input source image path")
    parser.add_argument("--sub-mode", default="auto",
                        choices=["auto", "screenshot", "poster", "watermark"],
                        help="Detection strategy")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(json.dumps({"ok": False, "error": f"input_not_found: {input_path}"},
                         ensure_ascii=False), file=sys.stderr)
        return 2

    try:
        with Image.open(input_path) as im:
            source = ImageOps.exif_transpose(im)
            width, height = source.size

        # PaddleOCR can segfault on some ARM/Linux runtime builds. Keep it behind
        # an explicit opt-in and use the stable OpenCV detector by default.
        use_paddle = os.getenv("AI_SPACE_ENABLE_PADDLE_OCR", "").strip().lower() in {"1", "true", "yes"}
        if use_paddle:
            try:
                regions = detect_with_paddle(str(input_path))
                detector = "paddleocr"
            except Exception as exc:
                print(f"[detect_text_mask] PaddleOCR failed, falling back to OpenCV: {exc}", file=sys.stderr)
                regions = detect_with_opencv(str(input_path), args.sub_mode)
                detector = "opencv"
        else:
            regions = detect_with_opencv(str(input_path), args.sub_mode)
            detector = "opencv"

        # Merge overlapping regions
        regions = merge_overlapping(regions)

        # Sort by reading order (top to bottom, left to right)
        regions.sort(key=lambda r: (r["bbox"][1], r["bbox"][0]))

        print(json.dumps({
            "ok": True,
            "width": width,
            "height": height,
            "detector": detector,
            "regions": regions,
            "count": len(regions),
        }, ensure_ascii=False))
        return 0

    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)},
                         ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())