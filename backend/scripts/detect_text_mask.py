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
import shutil
import subprocess
import sys
from collections import defaultdict
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



def available_tesseract_langs() -> set[str]:
    if not shutil.which("tesseract"):
        return set()
    try:
        proc = subprocess.run(["tesseract", "--list-langs"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=10)
    except Exception:
        return set()
    langs: set[str] = set()
    for line in (proc.stdout + "\n" + proc.stderr).splitlines():
        line = line.strip()
        if not line or line.startswith("List of"):
            continue
        langs.add(line)
    return langs


def choose_tesseract_lang() -> str:
    langs = available_tesseract_langs()
    # chi_sim may not be installed on every host; include English when available
    # so UI labels / ASCII watermarks are still detected.
    parts = []
    if "chi_sim" in langs:
        parts.append("chi_sim")
    if "chi_tra" in langs:
        parts.append("chi_tra")
    if "eng" in langs:
        parts.append("eng")
    return "+".join(parts)


def detect_with_tesseract(image_path: str, sub_mode: str = "auto") -> list[dict]:
    """Detect real OCR text boxes with tesseract TSV output.

    Unlike OpenCV morphology, this only returns boxes with recognized text and
    confidence, so textured game/background regions are not exposed as selectable
    text boxes.
    """
    if not shutil.which("tesseract"):
        return []
    lang = choose_tesseract_lang()
    if not lang:
        return []
    psm = "6" if sub_mode in {"screenshot", "poster"} else "11"
    cmd = ["tesseract", image_path, "stdout", "-l", lang, "--psm", psm, "tsv"]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=45)
    if proc.returncode != 0:
        print(f"[detect_text_mask] tesseract failed: {proc.stderr.strip()}", file=sys.stderr)
        return []

    rows = []
    lines = proc.stdout.splitlines()
    if not lines:
        return []
    header = lines[0].split("\t")
    col = {name: i for i, name in enumerate(header)}
    required = {"level", "page_num", "block_num", "par_num", "line_num", "left", "top", "width", "height", "conf", "text"}
    if not required.issubset(col):
        return []

    min_conf = 35
    with Image.open(image_path) as im:
        source = ImageOps.exif_transpose(im)
        img_w, img_h = source.size

    for raw in lines[1:]:
        parts = raw.split("\t")
        if len(parts) < len(header):
            continue
        text = parts[col["text"]].strip()
        if not text:
            continue
        try:
            conf = float(parts[col["conf"]])
            x = int(float(parts[col["left"]])); y = int(float(parts[col["top"]]))
            w = int(float(parts[col["width"]])); h = int(float(parts[col["height"]]))
        except Exception:
            continue
        if conf < min_conf or w < 5 or h < 5:
            continue
        # Reject very large/non-texty OCR artifacts.
        if w > img_w * 0.92 or h > img_h * 0.30:
            continue
        rows.append({
            "key": (parts[col["page_num"]], parts[col["block_num"]], parts[col["par_num"]], parts[col["line_num"]]),
            "bbox": [x, y, x + w, y + h],
            "text": text,
            "confidence": conf,
        })

    # Merge words in the same OCR line into one selectable region.
    grouped: dict[tuple[str, str, str, str], list[dict]] = defaultdict(list)
    for row in rows:
        grouped[row["key"]].append(row)

    regions: list[dict] = []
    for group in grouped.values():
        if not group:
            continue
        x1 = min(r["bbox"][0] for r in group)
        y1 = min(r["bbox"][1] for r in group)
        x2 = max(r["bbox"][2] for r in group)
        y2 = max(r["bbox"][3] for r in group)
        text = "".join(r["text"] for r in group) if any(ord(ch) > 127 for r in group for ch in r["text"]) else " ".join(r["text"] for r in group)
        conf = sum(float(r["confidence"]) for r in group) / len(group)
        if (x2 - x1) < 6 or (y2 - y1) < 6:
            continue
        regions.append({"bbox": [x1, y1, x2, y2], "text": text.strip(), "confidence": round(conf / 100.0, 3)})

    # Stable UX guard: OCR preview should never flood the image.
    regions.sort(key=lambda r: (r["bbox"][1], r["bbox"][0]))
    return regions[:30]


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



def filter_opencv_preview_regions(regions: list[dict], width: int, height: int, sub_mode: str) -> list[dict]:
    """Make OpenCV fallback safe for preview.

    OpenCV morphology is useful for building an internal removal mask, but raw
    contours are not reliable OCR boxes. Only expose line-like, reasonably sized
    candidates and cap the count; otherwise return a reason for manual selection.
    """
    out: list[dict] = []
    for r in regions:
        x1, y1, x2, y2 = r["bbox"]
        w = max(0, x2 - x1)
        h = max(0, y2 - y1)
        area = w * h
        if w < max(18, width * 0.018) or h < max(8, height * 0.008):
            continue
        if area < width * height * 0.00008 or area > width * height * 0.035:
            continue
        aspect = w / float(h or 1)
        if aspect < 1.8 or aspect > 28:
            continue
        if h > height * 0.09:
            continue
        # Screenshot/game UI text often lives in lower UI bands; in screenshot
        # mode prefer those line-like regions and avoid foliage/texture noise.
        if sub_mode == "screenshot" and y1 < height * 0.35:
            continue
        out.append(r)

    out.sort(key=lambda r: (r["bbox"][1], r["bbox"][0]))
    # If still too many, this is not a stable preview; caller will suppress.
    return out[:60]


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

        fallback_reason = ""

        # Prefer stable OCR boxes for preview. OpenCV morphology is a last-resort
        # fallback and must not flood the frontend with texture/edge candidates.
        regions = detect_with_tesseract(str(input_path), args.sub_mode)
        detector = "tesseract" if regions else ""

        # PaddleOCR can segfault on some ARM/Linux runtime builds. Keep it behind
        # an explicit opt-in after tesseract.
        use_paddle = os.getenv("AI_SPACE_ENABLE_PADDLE_OCR", "").strip().lower() in {"1", "true", "yes"}
        if not regions and use_paddle:
            try:
                regions = detect_with_paddle(str(input_path))
                detector = "paddleocr"
            except Exception as exc:
                print(f"[detect_text_mask] PaddleOCR failed: {exc}", file=sys.stderr)

        if not regions:
            opencv_regions = detect_with_opencv(str(input_path), args.sub_mode)
            opencv_regions = filter_opencv_preview_regions(opencv_regions, width, height, args.sub_mode)
            if len(opencv_regions) > 30:
                regions = []
                detector = "opencv"
                fallback_reason = "too_many_candidates"
            else:
                regions = opencv_regions
                detector = "opencv"
                if not regions:
                    fallback_reason = "no_stable_text_regions"

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
            "fallback_reason": fallback_reason,
        }, ensure_ascii=False))
        return 0

    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)},
                         ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())