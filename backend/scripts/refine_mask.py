#!/usr/bin/env python3
import argparse
import base64
import io
import json
import sys

import cv2
import numpy as np
from PIL import Image


def read_mask_data(data_url: str) -> Image.Image:
    if ',' in data_url:
        data_url = data_url.split(',', 1)[1]
    return Image.open(io.BytesIO(base64.b64decode(data_url))).convert('RGBA')


def encode_png(mask_rgba: Image.Image) -> str:
    buf = io.BytesIO()
    mask_rgba.save(buf, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--image', required=True)
    ap.add_argument('--mask-data', required=True)
    ap.add_argument('--object-bbox', default='')  # JSON: {x,y,width,height} in image pixels
    args = ap.parse_args()

    pil_img = Image.open(args.image).convert('RGB')
    pil_mask = read_mask_data(args.mask_data)
    if pil_mask.size != pil_img.size:
        pil_mask = pil_mask.resize(pil_img.size, Image.Resampling.BILINEAR)

    img_rgb = np.array(pil_img)
    h, w = img_rgb.shape[:2]
    alpha = np.array(pil_mask)[:, :, 3]
    seed = alpha > 12
    seed_count = int(seed.sum())
    if seed_count < 20:
        print(json.dumps({'ok': False, 'error': 'mask_too_small'}, ensure_ascii=False))
        return

    ys, xs = np.where(seed)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    pad = int(max(24, min(max(bw, bh) * 0.45, max(w, h) * 0.18)))
    rx0, ry0 = max(0, x0 - pad), max(0, y0 - pad)
    rx1, ry1 = min(w - 1, x1 + pad), min(h - 1, y1 + pad)
    rect = (rx0, ry0, max(2, rx1 - rx0 + 1), max(2, ry1 - ry0 + 1))
    bbox = None
    if args.object_bbox:
        try:
            raw_bbox = json.loads(args.object_bbox)
            bx = int(raw_bbox.get('x', 0))
            by = int(raw_bbox.get('y', 0))
            bw2 = int(raw_bbox.get('width', 0))
            bh2 = int(raw_bbox.get('height', 0))
            if bw2 > 4 and bh2 > 4:
                bx0 = max(0, bx)
                by0 = max(0, by)
                bx1 = min(w - 1, bx + bw2 - 1)
                by1 = min(h - 1, by + bh2 - 1)
                if bx0 < bx1 and by0 < by1:
                    bbox = (bx0, by0, bx1, by1)
                    # Intersect GrabCut ROI with the model-predicted object box, with a small safety pad.
                    bpad = int(max(8, min(max(bx1 - bx0 + 1, by1 - by0 + 1) * 0.08, max(w, h) * 0.035)))
                    rx0 = max(rx0, bx0 - bpad)
                    ry0 = max(ry0, by0 - bpad)
                    rx1 = min(rx1, bx1 + bpad)
                    ry1 = min(ry1, by1 + bpad)
                    rect = (rx0, ry0, max(2, rx1 - rx0 + 1), max(2, ry1 - ry0 + 1))
        except Exception:
            bbox = None


    # GrabCut mask: probable background by default, user strokes = sure foreground.
    gc_mask = np.full((h, w), cv2.GC_PR_BGD, dtype=np.uint8)
    gc_mask[:ry0, :] = cv2.GC_BGD
    gc_mask[ry1 + 1:, :] = cv2.GC_BGD
    gc_mask[:, :rx0] = cv2.GC_BGD
    gc_mask[:, rx1 + 1:] = cv2.GC_BGD

    # Inner seed is definite foreground. A small dilation gives GrabCut enough positive signal.
    kernel_seed = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    sure_fg = cv2.dilate(seed.astype(np.uint8), kernel_seed, iterations=1).astype(bool)
    gc_mask[sure_fg] = cv2.GC_FGD

    # Far outside a padded user box is definite background, limiting runaway selection.
    bg_pad = int(max(10, min(bw, bh) * 0.18))
    bg = np.ones((h, w), dtype=np.uint8)
    bg[max(0, y0-bg_pad):min(h, y1+bg_pad+1), max(0, x0-bg_pad):min(w, x1+bg_pad+1)] = 0
    gc_mask[bg.astype(bool)] = cv2.GC_BGD

    bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(bgr, gc_mask, rect, bgd, fgd, 5, cv2.GC_INIT_WITH_MASK)
    except Exception as e:
        print(json.dumps({'ok': False, 'error': 'grabcut_failed', 'detail': str(e)}, ensure_ascii=False))
        return

    refined = np.where((gc_mask == cv2.GC_FGD) | (gc_mask == cv2.GC_PR_FGD), 255, 0).astype('uint8')

    # Keep only components connected to the user's original strokes.
    num, labels, stats, _ = cv2.connectedComponentsWithStats(refined, 8)
    keep = np.zeros_like(refined)
    seed_labels = set(int(v) for v in np.unique(labels[seed]) if int(v) != 0)
    for lab in seed_labels:
        area = int(stats[lab, cv2.CC_STAT_AREA])
        if area > 0:
            keep[labels == lab] = 255

    if int(keep.sum() // 255) < seed_count * 0.65:
        keep = (seed.astype('uint8') * 255)

    # Conservative instance guardrails. GrabCut often leaks into ground/shadows when
    # texture is connected to the object; prune pixels that are too far from the
    # user's positive strokes or too different from the seed's color distribution.
    keep_bool = keep > 0
    if bbox is not None:
        bx0, by0, bx1, by1 = bbox
        bbox_allowed = np.zeros((h, w), dtype=bool)
        bpad2 = int(max(6, min(max(bx1 - bx0 + 1, by1 - by0 + 1) * 0.06, max(w, h) * 0.025)))
        bbox_allowed[max(0, by0-bpad2):min(h, by1+bpad2+1), max(0, bx0-bpad2):min(w, bx1+bpad2+1)] = True
        keep_bool &= bbox_allowed | seed
    inv_seed = np.where(seed, 0, 255).astype('uint8')
    dist = cv2.distanceTransform(inv_seed, cv2.DIST_L2, 5)
    max_dist = max(22.0, min(max(bw, bh) * 0.38, max(w, h) * 0.10))
    keep_bool &= dist <= max_dist

    lab_img = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    seed_lab = lab_img[seed]
    if len(seed_lab) > 0:
        center = np.median(seed_lab, axis=0)
        seed_dist = np.linalg.norm(seed_lab - center, axis=1)
        color_limit = float(np.percentile(seed_dist, 86) + 14.0)
        color_dist = np.linalg.norm(lab_img - center, axis=2)
        # Keep original user strokes even if the stroke crossed highlight/shadow.
        keep_bool &= (color_dist <= color_limit) | seed

    keep = (keep_bool.astype('uint8') * 255)

    # Remove tiny background islands after pruning, but keep any island touched by the seed.
    num, labels, stats, _ = cv2.connectedComponentsWithStats(keep, 8)
    pruned = np.zeros_like(keep)
    seed_labels = set(int(v) for v in np.unique(labels[seed]) if int(v) != 0)
    min_area = max(24, int(seed_count * 0.03))
    for lab in seed_labels:
        if int(stats[lab, cv2.CC_STAT_AREA]) >= min_area:
            pruned[labels == lab] = 255
    keep = pruned if int(pruned.sum() // 255) else (seed.astype('uint8') * 255)

    # Guardrail: reject very large runaway regions. User can paint more if needed.
    keep_area = int(keep.sum() // 255)
    roi_area = max(1, (rx1 - rx0 + 1) * (ry1 - ry0 + 1))
    max_area = max(seed_count * 5, int(roi_area * 0.26), int(w * h * 0.10))
    if keep_area > max_area:
        # Prefer a local, edge-smoothed expansion around the strokes instead of the
        # raw seed, so the UI still feels like recognition happened without flooding.
        local = cv2.dilate(seed.astype('uint8'), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)), iterations=2) * 255
        keep = cv2.bitwise_and(keep, local)
        if int(keep.sum() // 255) < seed_count * 0.8:
            keep = local
        keep_area = int(keep.sum() // 255)

    # Smooth edges but do not flood-fill huge background.
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    keep = cv2.morphologyEx(keep, cv2.MORPH_CLOSE, kernel, iterations=1)
    keep = cv2.morphologyEx(keep, cv2.MORPH_OPEN, kernel, iterations=1)
    keep = cv2.GaussianBlur(keep, (5, 5), 0)

    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[:, :, 0] = 168
    rgba[:, :, 1] = 85
    rgba[:, :, 2] = 247
    rgba[:, :, 3] = np.where(keep > 32, 122, 0).astype(np.uint8)
    out_img = Image.fromarray(rgba, 'RGBA')
    ys2, xs2 = np.where(keep > 32)
    if len(xs2):
        bounds = {'x': int(xs2.min()), 'y': int(ys2.min()), 'width': int(xs2.max()-xs2.min()+1), 'height': int(ys2.max()-ys2.min()+1)}
    else:
        bounds = {'x': x0, 'y': y0, 'width': bw, 'height': bh}
    print(json.dumps({
        'ok': True,
        'refined_mask_data': encode_png(out_img),
        'bounds': bounds,
        'coverage': round((int((keep > 32).sum()) / (w*h)) * 100, 2),
        'source_seed_coverage': round((seed_count / (w*h)) * 100, 2),
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
