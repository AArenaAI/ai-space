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


def merge_close_components(mask: np.ndarray, width: int, height: int, sub_mode: str = "auto") -> np.ndarray:
    # Link neighboring glyph strokes into word/line masks without expanding to the
    # whole image. Kernel sizes scale with image dimensions.
    if sub_mode == "poster":
        kx = max(5, width // 120)
        ky = max(3, height // 180)
    elif sub_mode == "watermark":
        kx = max(3, width // 220)
        ky = max(2, height // 280)
    else:
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


def glyph_candidate_filter(mask: np.ndarray, width: int, height: int, sub_mode: str = "auto") -> np.ndarray:
    """Keep only small stroke-like components before word/line merging.

    This prevents non-text objects such as desktop/app icons from being joined
    with their nearby labels and removed as one large block.
    """
    filtered = np.zeros_like(mask)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    image_area = width * height
    min_area = max(3, image_area // 600000)
    if sub_mode == "poster":
        max_glyph_h = max(72, int(height * 0.16))
        max_glyph_w = max(160, int(width * 0.70))
    elif sub_mode == "watermark":
        max_glyph_h = max(48, int(height * 0.10))
        max_glyph_w = max(120, int(width * 0.55))
    else:
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
        if h > max_glyph_h and aspect < (2.2 if sub_mode == "poster" else 3.0):
            continue
        if w > max_glyph_w and aspect < (1.5 if sub_mode == "poster" else 1.8):
            continue
        fill_limit = 0.82 if sub_mode == "poster" else 0.72
        if fill > fill_limit and 0.35 <= aspect <= 3.2 and max(w, h) > 12:
            continue
        max_height_ratio = 0.34 if sub_mode == "poster" else 0.20
        if h > height * max_height_ratio or w > width * 0.90:
            continue
        cv2.drawContours(filtered, [cnt], -1, 255, thickness=cv2.FILLED)
    return filtered


def component_filter(mask: np.ndarray, width: int, height: int, sub_mode: str = "auto") -> np.ndarray:
    filtered = np.zeros_like(mask)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    image_area = width * height
    min_area = max(8, image_area // 250000)
    if sub_mode == "poster":
        max_area = max(6000, image_area // 8)
    elif sub_mode == "watermark":
        max_area = max(3000, image_area // 16)
    else:
        max_area = max(2000, image_area // 22)
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        roi = mask[y : y + h, x : x + w]
        area = int(np.count_nonzero(roi))
        if area < min_area or area > max_area:
            continue
        if w < 2 or h < 2:
            continue
        max_h_ratio = 0.42 if sub_mode == "poster" else 0.28
        if w > width * 0.95 or h > height * max_h_ratio:
            continue
        aspect = w / float(h)
        fill = area / float(w * h)
        # Text/watermarks are often long/thin or clusters of small glyphs. Be
        # conservative: square/tall merged regions are usually icons, logos,
        # desktop/file thumbnails, or content, not text lines. This is stricter
        # than the first-pass glyph filter because the mask has already been
        # dilated/merged into word-line candidates.
        if aspect < 0.12 or aspect > 80:
            continue
        if fill > 0.92:
            continue
        if sub_mode != "poster":
            if h > max(24, height * 0.09) and aspect < 2.2:
                continue
            if h > max(28, height * 0.07) and fill > 0.58 and aspect < 2.8:
                continue
            if h > height * 0.18 and w > width * 0.25:
                continue
        else:
            if h > height * 0.34 and aspect < 1.4:
                continue
            if fill > 0.88 and aspect < 1.8:
                continue
        cv2.drawContours(filtered, [cnt], -1, 255, thickness=cv2.FILLED)
    return filtered


def is_chalkboard_scene(rgb: np.ndarray) -> bool:
    """Detect dark boards with light, low-saturation chalk-like writing.

    These images need higher mask recall than desktop/logo screenshots: the
    background is mostly dark and the target strokes are pale chalk with dusty
    halos. A single global 10% mask cap under-removes long word lists such as
    classroom blackboards.
    """
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    sat = hsv[:, :, 1]
    val = hsv[:, :, 2]
    dark_background = float(np.percentile(val, 55)) < 95
    bright_low_sat = (val > 115) & (sat < 105)
    bright_fraction = float(np.count_nonzero(bright_low_sat)) / float(val.size or 1)
    return dark_background and 0.003 <= bright_fraction <= 0.18


def limit_mask_coverage(mask: np.ndarray, width: int, height: int, max_coverage: float = 0.10) -> np.ndarray:
    """Keep text removal local when auto-detection becomes over-broad.

    The product requirement is to remove requested text only, never to erase a
    broad chunk of the picture. If the automatic mask covers too much of the
    canvas, prefer doing less over damaging unrelated image content.
    """
    total_pixels = width * height
    if total_pixels <= 0:
        return mask

    if np.count_nonzero(mask) / float(total_pixels) <= max_coverage:
        return mask

    tightened = np.zeros_like(mask)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates: list[tuple[float, np.ndarray]] = []
    max_line_h = max(18, int(height * 0.07))
    max_component_area = max(64, int(total_pixels * 0.012))
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        if w < 2 or h < 2:
            continue
        roi = mask[y : y + h, x : x + w]
        area = int(np.count_nonzero(roi))
        aspect = w / float(h)
        fill = area / float(w * h)

        # Keep compact text-line candidates; reject icon-sized blobs and dense
        # square-ish components. For high-resolution banners/subtitles, a wide
        # aspect ratio still allows moderately taller text.
        if area > max_component_area and aspect < 4.0:
            continue
        if h > max_line_h and aspect < 3.0:
            continue
        if fill > 0.86 and aspect < 4.0:
            continue
        if h > height * 0.12 or w > width * 0.90:
            continue

        score = area * max(1.0, min(aspect, 8.0))
        candidates.append((score, cnt))

    # Add best candidates only until the mask remains safely local.
    budget = int(total_pixels * max_coverage)
    used = 0
    for _, cnt in sorted(candidates, key=lambda item: item[0], reverse=True):
        candidate = np.zeros_like(mask)
        cv2.drawContours(candidate, [cnt], -1, 255, thickness=cv2.FILLED)
        add = int(np.count_nonzero(cv2.bitwise_and(candidate, cv2.bitwise_not(tightened))))
        if used + add > budget:
            continue
        cv2.drawContours(tightened, [cnt], -1, 255, thickness=cv2.FILLED)
        used += add
    return tightened


def build_chalkboard_mask(rgb: np.ndarray) -> np.ndarray:
    """Higher-recall mask for light chalk strokes on dark boards.

    Keeps the mask constrained to stroke/word-like components, but includes the
    pale chalk halo around letters so inpainting does not leave readable ghosts.
    """
    height, width = rgb.shape[:2]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    sat = hsv[:, :, 1]
    val = hsv[:, :, 2]
    board_level = float(np.percentile(val, 55))

    chalk = np.zeros_like(gray)
    chalk[((val > max(100, board_level + 38)) & (sat < 125)) | ((gray > max(105, board_level + 45)) & (sat < 150))] = 255

    # Link dusty chalk strokes into letters/words but avoid swallowing the frame
    # or the chalk stick on the bottom tray.
    kx = max(5, width // 95)
    ky = max(3, height // 180)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kx, ky))
    chalk = cv2.morphologyEx(chalk, cv2.MORPH_CLOSE, kernel, iterations=1)

    filtered = np.zeros_like(chalk)
    contours, _ = cv2.findContours(chalk, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    image_area = width * height
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        if w < 2 or h < 2:
            continue
        roi = chalk[y : y + h, x : x + w]
        area = int(np.count_nonzero(roi))
        if area < max(5, image_area // 700000) or area > image_area * 0.05:
            continue
        aspect = w / float(h)
        fill = area / float(w * h)
        if aspect < 0.06 or aspect > 95:
            continue
        if h > height * 0.20 or w > width * 0.78:
            continue
        # Bottom ledge objects (loose chalk/eraser highlights) are not board text.
        if y > height * 0.78 and (aspect > 2.8 or fill > 0.75):
            continue
        if fill > 0.96 and max(w, h) > 10:
            continue
        cv2.drawContours(filtered, [cnt], -1, 255, thickness=cv2.FILLED)

    # Include antialiased/chalk-dust halo around the selected strokes.
    dilate_px = max(2, round(min(width, height) / 260))
    halo_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * dilate_px + 1, 2 * dilate_px + 1))
    filtered = cv2.dilate(filtered, halo_kernel, iterations=1)
    filtered = cv2.GaussianBlur(filtered, (3, 3), 0)
    _, filtered = cv2.threshold(filtered, 18, 255, cv2.THRESH_BINARY)
    return filtered


def build_text_mask(rgb: np.ndarray, sub_mode: str = "auto") -> np.ndarray:
    sub_mode = (sub_mode or "auto").strip().lower()
    if sub_mode not in {"auto", "screenshot", "poster", "watermark"}:
        sub_mode = "auto"
    height, width = rgb.shape[:2]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    chalkboard = is_chalkboard_scene(rgb)

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
        combined = cv2.bitwise_or(combined, glyph_candidate_filter(cand, width, height, sub_mode))

    combined = merge_close_components(combined, width, height, sub_mode)
    component_mode = "screenshot" if sub_mode == "auto" and not chalkboard else sub_mode
    combined = component_filter(combined, width, height, component_mode)

    if chalkboard:
        combined = cv2.bitwise_or(combined, build_chalkboard_mask(rgb))

    # Slight expansion covers anti-aliased glyph edges. Keep it modest so non-text
    # parts are preserved as much as possible.
    if sub_mode == "poster":
        dilate_px = max(2, round(min(width, height) / 240))
    elif sub_mode == "watermark":
        dilate_px = max(1, round(min(width, height) / 620))
    else:
        dilate_px = max(2 if chalkboard else 1, round(min(width, height) / (320 if chalkboard else 500)))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * dilate_px + 1, 2 * dilate_px + 1))
    combined = cv2.dilate(combined, kernel, iterations=1)
    combined = cv2.GaussianBlur(combined, (3, 3), 0)
    _, combined = cv2.threshold(combined, 20, 255, cv2.THRESH_BINARY)
    coverage_cap = 0.18 if chalkboard else {"screenshot": 0.07, "poster": 0.22, "watermark": 0.12}.get(sub_mode, 0.10)
    combined = limit_mask_coverage(combined, width, height, max_coverage=coverage_cap)
    return combined




def fill_uniform_mask_regions(rgb: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray, int]:
    """Fill masked regions whose surroundings are near-uniform UI/background.

    Manual text removal on game/dialog UI should not use texture inpainting:
    inpaint pulls grass/scene texture into the dark dialogue box and creates a
    blurred smear. For each external-mask component, inspect a surrounding ring;
    if the ring is dark/low-variance enough, fill the component with the ring's
    median color and remove it from the inpaint mask. Return (image, remaining_mask,
    filled_pixels).
    """
    repaired = rgb.copy()
    remaining = mask.copy()
    height, width = mask.shape[:2]
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled_pixels = 0
    for cnt in contours:
        component = np.zeros_like(mask)
        cv2.drawContours(component, [cnt], -1, 255, thickness=cv2.FILLED)
        x, y, w, h = cv2.boundingRect(cnt)
        if w < 2 or h < 2:
            continue
        ring_px = max(6, round(min(width, height) / 220))
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * ring_px + 1, 2 * ring_px + 1))
        dilated = cv2.dilate(component, kernel, iterations=1)
        ring = (dilated > 0) & (component == 0) & (mask == 0)
        samples = rgb[ring]
        if samples.size == 0 or samples.shape[0] < 16:
            continue
        med = np.median(samples, axis=0)
        # Robust spread: percentile range is less sensitive to UI highlights.
        p10 = np.percentile(samples, 10, axis=0)
        p90 = np.percentile(samples, 90, axis=0)
        spread = float(np.mean(p90 - p10))
        brightness = float(np.mean(med))
        # Dialogue boxes / caption bars are usually dark and fairly uniform. Also
        # allow light uniform panels. Avoid this path on textured scenery.
        uniform_dark = brightness < 85 and spread < 45
        uniform_light = brightness >= 85 and spread < 32
        if not (uniform_dark or uniform_light):
            continue
        fill_color = np.clip(med, 0, 255).astype(np.uint8)
        # Fill row-by-row when possible so semi-transparent dialogue panels keep
        # their vertical gradient/noise instead of becoming a flat rectangle.
        rows = np.where(np.any(component > 0, axis=1))[0]
        for yy in rows:
            xs = np.where(component[yy] > 0)[0]
            if xs.size == 0:
                continue
            x1, x2 = int(xs.min()), int(xs.max())
            pad = max(8, round(width / 220))
            left = rgb[yy, max(0, x1 - pad):x1]
            right = rgb[yy, x2 + 1:min(width, x2 + 1 + pad)]
            row_samples = np.concatenate([left, right], axis=0) if left.size or right.size else np.empty((0, 3), dtype=np.uint8)
            if row_samples.shape[0] >= 4:
                row_color = np.median(row_samples, axis=0).astype(np.uint8)
            else:
                row_color = fill_color
            repaired[yy, xs] = row_color
        remaining[component > 0] = 0
        filled_pixels += int(np.count_nonzero(component))
    return repaired, remaining, filled_pixels


def main() -> int:
    parser = argparse.ArgumentParser(description="Remove text/watermarks locally while preserving visual dimensions")
    parser.add_argument("--input", required=True, help="Input source image path")
    parser.add_argument("--output", required=True, help="Output PNG path")
    parser.add_argument("--prompt", default="", help="User text description; currently used for logging only")
    parser.add_argument("--sub-mode", default="auto", choices=["auto", "manual", "screenshot", "poster", "watermark"], help="Detection strategy: auto/manual/legacy modes; manual expects --mask-input")
    parser.add_argument("--mask-input", default="", help="External mask image path (white=process, black=preserve). If provided, skips auto text detection.")
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
        chalkboard = is_chalkboard_scene(rgb)

        # Use external mask if provided, otherwise auto-detect
        external_mask = bool(args.mask_input)
        if external_mask:
            mask_path = Path(args.mask_input)
            if not mask_path.exists():
                print(json.dumps({"ok": False, "error": f"mask_not_found: {mask_path}"}, ensure_ascii=False), file=sys.stderr)
                return 2
            with Image.open(mask_path) as mask_im:
                mask_im = ImageOps.exif_transpose(mask_im)
                if mask_im.size != original_size:
                    mask_im = mask_im.resize(original_size, Image.Resampling.NEAREST)
                mask = np.array(mask_im.convert("L"))
            mask = (mask > 127).astype(np.uint8) * 255
            if args.sub_mode != "manual":
                # Automatic preview boxes are rectangular. Do not repair the
                # whole rectangle; shrink to visible text-like strokes inside it.
                # This prevents obvious rectangular patches on semi-transparent
                # dialogue panels.
                hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
                gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
                bright_text = ((gray > 135) & (hsv[:, :, 1] < 145)).astype(np.uint8) * 255
                mask = cv2.bitwise_and(mask, bright_text)
                refine_px = max(2, round(min(original_size) / 520))
                refine_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * refine_px + 1, 2 * refine_px + 1))
                mask = cv2.dilate(mask, refine_kernel, iterations=1)
                mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, refine_kernel, iterations=1)
            else:
                # Manual masks come from direct user painting. Expand only
                # modestly to catch antialiasing/glow; excessive expansion
                # destroys UI panels.
                expand_px = max(3, round(min(original_size) / 360))
                kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * expand_px + 1, 2 * expand_px + 1))
                mask = cv2.dilate(mask, kernel, iterations=1)
                mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=1)
        else:
            mask = build_text_mask(rgb, args.sub_mode)

        if args.mask_output:
            mask_path = Path(args.mask_output)
            mask_path.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(mask).save(mask_path)

        # External/manual masks: first fill near-uniform UI/background regions
        # with neighboring median color. Only remaining textured regions use
        # OpenCV inpaint. This avoids smearing game dialogue boxes into blurry
        # scene-colored strips.
        fill_pixels = 0
        inpaint_source = rgb
        inpaint_mask = mask
        if external_mask:
            inpaint_source, inpaint_mask, fill_pixels = fill_uniform_mask_regions(rgb, mask)

        # OpenCV expects BGR. Telea inpaint changes only masked pixels.
        bgr = cv2.cvtColor(inpaint_source, cv2.COLOR_RGB2BGR)
        if external_mask:
            radius = max(3, round(min(original_size) / 420))
        else:
            radius = max(4 if chalkboard else 3, round(min(original_size) / (220 if chalkboard else 350)))
        if np.count_nonzero(inpaint_mask) > 0:
            repaired_bgr = cv2.inpaint(bgr, inpaint_mask, radius, cv2.INPAINT_TELEA)
            repaired_rgb = cv2.cvtColor(repaired_bgr, cv2.COLOR_BGR2RGB)
        else:
            repaired_rgb = inpaint_source.copy()
        # Hard pixel-preservation guard: OpenCV inpaint is only supposed to
        # change masked pixels, but force every unmasked pixel back to the exact
        # original RGB value before saving. This prevents any accidental global
        # enhancement, smoothing, color shift, resize side-effect, or redraw.
        repaired_rgb[mask == 0] = rgb[mask == 0]
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
                    "uniform_fill_pixels": fill_pixels,
                    "sub_mode": args.sub_mode,
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

