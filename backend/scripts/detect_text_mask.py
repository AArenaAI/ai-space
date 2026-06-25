#!/usr/bin/env python3
"""Detect selectable text regions for text removal preview.

This is a precision-first detector. It does not expose raw OpenCV texture
contours as user-selectable text boxes. Instead it classifies the image and uses
specialized strategies for common AI Space inputs:

- game/ui screenshots: detect bright text over dark UI/dialogue panels
- code/web screenshots: detect text lines over flat UI backgrounds
- receipt/document photos: detect printed/handwritten text-like strokes on paper

Output stays backward compatible with the existing preview endpoint while adding
metadata for better UX and repair routing.
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


def clamp(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, int(v)))


def bbox_area(b: list[int]) -> int:
    return max(0, b[2] - b[0]) * max(0, b[3] - b[1])


def merge_boxes(boxes: list[list[int]], x_gap: int, y_overlap_ratio: float = 0.35) -> list[list[int]]:
    if not boxes:
        return []
    boxes = sorted(boxes, key=lambda b: (b[1], b[0]))
    lines: list[list[list[int]]] = []
    for b in boxes:
        placed = False
        by1, by2 = b[1], b[3]
        bh = max(1, by2 - by1)
        for line in lines:
            ly1 = min(x[1] for x in line)
            ly2 = max(x[3] for x in line)
            inter = max(0, min(by2, ly2) - max(by1, ly1))
            if inter / float(min(bh, max(1, ly2 - ly1))) >= y_overlap_ratio:
                line.append(b)
                placed = True
                break
        if not placed:
            lines.append([b])
    merged: list[list[int]] = []
    for line in lines:
        line = sorted(line, key=lambda b: b[0])
        cur = line[0][:]
        for b in line[1:]:
            if b[0] - cur[2] <= x_gap:
                cur = [min(cur[0], b[0]), min(cur[1], b[1]), max(cur[2], b[2]), max(cur[3], b[3])]
            else:
                merged.append(cur)
                cur = b[:]
        merged.append(cur)
    return merged


def classify_image(rgb: np.ndarray) -> dict:
    h, w = rgb.shape[:2]
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    sat = hsv[:, :, 1]
    val = hsv[:, :, 2]

    # Receipt/document photos often have a large pink/white low-saturation paper
    # area and non-axis-aligned real-world background.
    mean = rgb.reshape(-1, 3).mean(axis=0)
    paper_mask = (rgb[:, :, 0] > 120) & (rgb[:, :, 1] > 75) & (rgb[:, :, 2] > 85) & (rgb[:, :, 0] > rgb[:, :, 1] + 4)
    paper_fraction = float(np.mean(paper_mask))
    paper_like = ((mean[0] > 130 and mean[1] > 95 and mean[2] > 95 and float(np.mean(sat < 120)) > 0.25) or paper_fraction > 0.18)
    pinkish = (mean[0] > mean[1] + 6 and mean[0] > mean[2] + 3) or paper_fraction > 0.18

    # Code/devtools screenshots have large flat bright UI surfaces and many dark
    # small components spread across the canvas.
    bright_flat = float(np.mean(val > 210)) > 0.45 and float(np.mean(sat < 70)) > 0.55

    bottom = rgb[int(h * 0.55):]
    bottom_gray = gray[int(h * 0.55):]
    dark_bottom = float(np.mean(bottom_gray < 70)) > 0.25
    bright_text_bottom = float(np.mean((bottom_gray > 150))) > 0.015

    if bright_flat:
        image_type = "code_ui_screenshot"
    elif paper_like and pinkish:
        image_type = "receipt_document"
    elif dark_bottom and bright_text_bottom:
        image_type = "game_ui_screenshot"
    else:
        image_type = "general_image"
    return {
        "image_type": image_type,
        "width": w,
        "height": h,
        "mean_rgb": [round(float(x), 2) for x in mean],
    }


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


def choose_tesseract_lang(image_type: str = "general_image") -> str:
    langs = available_tesseract_langs()
    parts: list[str] = []
    if image_type == "receipt_document" and "chi_tra" in langs:
        parts.append("chi_tra")
    if "chi_sim" in langs:
        parts.append("chi_sim")
    if "eng" in langs:
        parts.append("eng")
    return "+".join(parts)


def is_meaningful_ocr_text(text: str, image_type: str = "general_image") -> bool:
    text = (text or "").strip()
    if not text:
        return False
    letters = [ch for ch in text if ch.isalpha()]
    digits = [ch for ch in text if ch.isdigit()]
    if not letters and not digits:
        return False
    non_latin_letters = [ch for ch in letters if not ("a" <= ch.lower() <= "z")]
    if non_latin_letters:
        return True
    latin = "".join(ch.lower() for ch in letters)
    if image_type == "code_ui_screenshot":
        # code/devtools commonly has identifiers, urls, filenames and warnings
        return len(latin) >= 2 or len(digits) >= 2
    if image_type == "receipt_document":
        return len(latin) >= 2 or len(digits) >= 2
    if len(latin) >= 5:
        vowels = sum(1 for ch in latin if ch in "aeiou")
        return vowels >= 2
    return False


def run_tesseract(image_path: str, image_type: str, timeout: int = 8) -> list[dict]:
    if not shutil.which("tesseract"):
        return []
    lang = choose_tesseract_lang(image_type)
    if not lang:
        return []
    with Image.open(image_path) as im:
        source = ImageOps.exif_transpose(im).convert("RGB")
    w, h = source.size
    crop = source
    x_offset = 0
    y_offset = 0
    if image_type == "game_ui_screenshot" and h > 480:
        y_offset = int(h * 0.50)
        crop = source.crop((0, y_offset, w, h))
    max_w = 1600 if image_type in {"receipt_document", "code_ui_screenshot"} else 1280
    scale = 1.0
    if crop.size[0] > max_w:
        scale = max_w / float(crop.size[0])
        crop = crop.resize((max_w, max(1, round(crop.size[1] * scale))), Image.Resampling.LANCZOS)
    tmp = str(Path(image_path).with_suffix(f".tesseract-{image_type}.png"))
    ImageOps.grayscale(crop).save(tmp)
    psm = "6" if image_type in {"game_ui_screenshot", "code_ui_screenshot"} else "11"
    cmd = ["tesseract", tmp, "stdout", "-l", lang, "--psm", psm, "tsv"]
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        print("[detect_text_mask] tesseract timed out", file=sys.stderr)
        return []
    if proc.returncode != 0:
        print(f"[detect_text_mask] tesseract failed: {proc.stderr.strip()}", file=sys.stderr)
        return []
    lines = proc.stdout.splitlines()
    if not lines:
        return []
    header = lines[0].split("\t")
    col = {name: i for i, name in enumerate(header)}
    required = {"level", "page_num", "block_num", "par_num", "line_num", "left", "top", "width", "height", "conf", "text"}
    if not required.issubset(col):
        return []
    rows: list[dict] = []
    min_conf = 30 if image_type in {"code_ui_screenshot", "receipt_document"} else 50
    for raw in lines[1:]:
        parts = raw.split("\t")
        if len(parts) < len(header):
            continue
        text = parts[col["text"]].strip()
        if not is_meaningful_ocr_text(text, image_type):
            continue
        try:
            conf = float(parts[col["conf"]])
            x = int(float(parts[col["left"]]) / scale) + x_offset
            y = int(float(parts[col["top"]]) / scale) + y_offset
            ww = int(float(parts[col["width"]]) / scale)
            hh = int(float(parts[col["height"]]) / scale)
        except Exception:
            continue
        if conf < min_conf or ww < 2 or hh < 4:
            continue
        if ww > w * 0.96 or hh > h * 0.35:
            continue
        rows.append({
            "key": (parts[col["page_num"]], parts[col["block_num"]], parts[col["par_num"]], parts[col["line_num"]]),
            "bbox": [x, y, x + ww, y + hh],
            "text": text,
            "confidence": conf,
        })
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
        if not is_meaningful_ocr_text(text, image_type):
            continue
        regions.append(make_region([x1, y1, x2, y2], text.strip(), round(conf / 100.0, 3), "tesseract", image_type))
    return sorted(regions, key=lambda r: (r["bbox"][1], r["bbox"][0]))[:80]


def make_region(bbox: list[int], text: str, confidence: float, detector: str, image_type: str, region_type: str = "") -> dict:
    if not region_type:
        region_type = {
            "game_ui_screenshot": "ui_text",
            "code_ui_screenshot": "code_line",
            "receipt_document": "document_text",
        }.get(image_type, "text")
    repair_strategy = {
        "game_ui_screenshot": "uniform_fill",
        "code_ui_screenshot": "uniform_fill",
        "receipt_document": "paper_fill_or_inpaint",
    }.get(image_type, "local_inpaint")
    risk = "low" if image_type in {"game_ui_screenshot", "code_ui_screenshot"} else ("medium" if image_type == "receipt_document" else "medium")
    return {
        "bbox": [int(x) for x in bbox],
        "text": text,
        "confidence": float(confidence),
        "detector": detector,
        "type": region_type,
        "repair_strategy": repair_strategy,
        "risk": risk,
        "selectable": True,
    }


def detect_bright_text_regions(rgb: np.ndarray, image_type: str) -> list[dict]:
    """Local high-precision text-like region detector for UI/code/receipt images.

    It returns line/word boxes without pretending to know OCR content. This fills
    the gap when Tesseract fails but the text is visually obvious.
    """
    h, w = rgb.shape[:2]
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    if image_type == "game_ui_screenshot":
        # Game dialogue/caption text usually sits in the bottom UI band. Avoid
        # scanning the lower battle scene: white highlights on corpses/clothes
        # are otherwise indistinguishable from text by local morphology.
        roi_y = int(h * 0.72)
        work = np.zeros_like(gray)
        # bright low-saturation UI text in the actual dark dialogue/UI band.
        # This avoids selecting white highlights on characters/ground in the scene.
        mask = ((gray > 145) & (hsv[:, :, 1] < 120)).astype(np.uint8) * 255
        work[roi_y:, :] = mask[roi_y:, :]
        kx, ky = max(9, w // 180), max(3, h // 360)
        x_gap = max(16, w // 90)
        region_type = "ui_text"
        repair = "uniform_fill"
    elif image_type == "code_ui_screenshot":
        # dark/colored text over bright flat UI backgrounds
        mask = ((gray < 185) & (hsv[:, :, 1] < 210)).astype(np.uint8) * 255
        work = mask
        kx, ky = max(12, w // 140), max(2, h // 600)
        x_gap = max(10, w // 160)
        region_type = "code_line"
        repair = "uniform_fill"
    elif image_type == "receipt_document":
        # ink on pink/white paper: dark or reddish strokes
        mask = ((gray < 170) | ((hsv[:, :, 0] < 15) & (hsv[:, :, 1] > 50) & (gray < 220))).astype(np.uint8) * 255
        work = mask
        kx, ky = max(7, w // 240), max(3, h // 360)
        x_gap = max(8, w // 180)
        region_type = "document_text"
        repair = "paper_fill_or_inpaint"
    else:
        return []
    work = cv2.morphologyEx(work, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2)))
    contours, _ = cv2.findContours(work, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    glyphs: list[list[int]] = []
    area_total = w * h
    for cnt in contours:
        x, y, ww, hh = cv2.boundingRect(cnt)
        area = cv2.contourArea(cnt)
        if area < max(4, area_total // 900000):
            continue
        if ww < 2 or hh < 4:
            continue
        if hh > h * (0.08 if image_type != "receipt_document" else 0.16):
            continue
        if ww > w * 0.8 or bbox_area([x, y, x + ww, y + hh]) > area_total * 0.06:
            continue
        # reject square/solid icons unless receipt/document where logos may be text-like
        fill = float(np.count_nonzero(work[y:y+hh, x:x+ww])) / float(max(1, ww * hh))
        aspect = ww / float(hh)
        if image_type != "receipt_document" and fill > 0.82 and aspect < 1.6 and max(ww, hh) > 12:
            continue
        glyphs.append([x, y, x + ww, y + hh])
    merged = merge_boxes(glyphs, x_gap=x_gap, y_overlap_ratio=0.25)
    # Merge one more time with horizontal kernels to produce user-friendly line/word boxes.
    regions: list[dict] = []
    for b in merged:
        bw, bh = b[2] - b[0], b[3] - b[1]
        if bw < 8 or bh < 6:
            continue
        if image_type == "game_ui_screenshot":
            cx = (b[0] + b[2]) / 2.0 / max(1, w)
            cy = (b[1] + b[3]) / 2.0 / max(1, h)
            # Keep only main dialogue text band, right-bottom UI buttons,
            # and the left-bottom speaker-name label. Exclude avatar/body areas.
            in_dialogue = 0.24 <= cx <= 0.86 and 0.80 <= cy <= 0.91
            in_right_buttons = 0.84 <= cx <= 0.99 and 0.86 <= cy <= 0.98
            in_speaker_name = 0.10 <= cx <= 0.24 and 0.88 <= cy <= 0.99
            if not (in_dialogue or in_right_buttons or in_speaker_name):
                continue
        if image_type == "code_ui_screenshot" and bw < 14:
            continue
        risk = "medium" if image_type == "receipt_document" else "low"
        reg = make_region(b, "", 0.62, "local-vision", image_type, region_type)
        reg["repair_strategy"] = repair
        reg["risk"] = risk
        regions.append(reg)
    regions = sorted(regions, key=lambda r: (r["bbox"][1], r["bbox"][0]))
    return regions[:120]


def dedupe_regions(regions: list[dict]) -> list[dict]:
    out: list[dict] = []
    for r in sorted(regions, key=lambda x: (bbox_area(x["bbox"]), x["confidence"]), reverse=True):
        x1, y1, x2, y2 = r["bbox"]
        keep = True
        for e in out:
            a1, b1, a2, b2 = e["bbox"]
            ix1, iy1 = max(x1, a1), max(y1, b1)
            ix2, iy2 = min(x2, a2), min(y2, b2)
            if ix1 < ix2 and iy1 < iy2:
                inter = (ix2 - ix1) * (iy2 - iy1)
                smaller = min(bbox_area(r["bbox"]), bbox_area(e["bbox"]))
                if smaller and inter / smaller > 0.72:
                    keep = False
                    break
        if keep:
            out.append(r)
    return sorted(out, key=lambda r: (r["bbox"][1], r["bbox"][0]))


def main() -> int:
    parser = argparse.ArgumentParser(description="Detect text regions for removal preview")
    parser.add_argument("--input", required=True, help="Input source image path")
    parser.add_argument("--sub-mode", default="auto", choices=["auto", "manual", "screenshot", "poster", "watermark"], help="Detection strategy")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(json.dumps({"ok": False, "error": f"input_not_found: {input_path}"}, ensure_ascii=False), file=sys.stderr)
        return 2

    try:
        with Image.open(input_path) as im:
            source = ImageOps.exif_transpose(im).convert("RGB")
            width, height = source.size
        rgb = np.array(source)
        info = classify_image(rgb)
        image_type = info["image_type"]
        fallback_reason = ""

        ocr_regions = run_tesseract(str(input_path), image_type)
        local_regions = detect_bright_text_regions(rgb, image_type)
        regions = dedupe_regions(ocr_regions + local_regions)
        if image_type == "game_ui_screenshot":
            filtered = []
            for r in regions:
                b = r["bbox"]
                cx = (b[0] + b[2]) / 2.0 / max(1, width)
                cy = (b[1] + b[3]) / 2.0 / max(1, height)
                in_dialogue = 0.24 <= cx <= 0.86 and 0.80 <= cy <= 0.91
                in_right_buttons = 0.84 <= cx <= 0.99 and 0.86 <= cy <= 0.98
                in_speaker_name = 0.10 <= cx <= 0.24 and 0.88 <= cy <= 0.99
                if in_dialogue or in_right_buttons or in_speaker_name:
                    filtered.append(r)
            regions = filtered
        detector = "hybrid" if ocr_regions and local_regions else ("tesseract" if ocr_regions else ("local-vision" if local_regions else "none"))
        if not regions:
            fallback_reason = "no_stable_text_regions"

        print(json.dumps({
            "ok": True,
            "width": width,
            "height": height,
            "detector": detector,
            "image_type": image_type,
            "analysis": info,
            "regions": regions,
            "count": len(regions),
            "fallback_reason": fallback_reason,
        }, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
