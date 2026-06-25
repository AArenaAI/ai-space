"use client";

import { useState, useRef, useEffect, useCallback, Suspense, useMemo, forwardRef, useImperativeHandle } from "react";
import { Upload, Loader2 as Spinner, Sparkles, Eraser, Download, RotateCcw, ArrowRight, Wand2, Type, ZoomIn, ImagePlus, History, Trash2, Loader, RefreshCw, AlertCircle, Clock, Image as ImageIcon, Plus, Brush, Paintbrush, RotateCcw as ResetIcon, ScanSearch } from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useImage } from "@/hooks/useImage";
import { toast } from "sonner";
import BeforeAfterSlider from "@/components/ui/BeforeAfterSlider";
import { resolveImageUrl } from "@/lib/resolveImageUrl";
import CreationHistoryPanel, { type CreationHistoryItem } from "@/components/creative/CreationHistoryPanel";
import { getGuestId } from "@/lib/guestId";
import { normalizeError, readApiError } from "@/lib/errors";
import type { UserFacingError } from "@/lib/errors";

const API_BASE_URL = "";

type EditMode = "remove-bg" | "replace-bg" | "text-removal" | "upscale" | "inpaint" | "region-brush";
type ImageEditIntent =
  | "remove_background"
  | "replace_background"
  | "remove_text"
  | "faithful_enhance"
  | "ai_upscale"
  | "local_replace"
  | "local_modify"
  | "local_add"
  | "local_repair"
  | "object_remove_repair";

type TextRegion = { bbox: [number, number, number, number]; text: string; confidence: number };

type ImageEditRoute = { subMode: string; intent: ImageEditIntent };
type PrecisionModeOption = ImageEditRoute & { labelKey: string; descriptionKey: string };

const DEFAULT_EDIT_ROUTES: Record<EditMode, ImageEditRoute> = {
  "remove-bg": { subMode: "standard", intent: "remove_background" },
  "replace-bg": { subMode: "realistic", intent: "replace_background" },
  "text-removal": { subMode: "auto", intent: "remove_text" },
  upscale: { subMode: "faithful", intent: "faithful_enhance" },
  inpaint: { subMode: "replace", intent: "local_replace" },
  "region-brush": { subMode: "remove", intent: "object_remove_repair" },
};

const PRECISION_MODE_OPTIONS: Record<EditMode, PrecisionModeOption[]> = {
  "remove-bg": [
    { subMode: "standard", intent: "remove_background", labelKey: "image.edit.precision.removeBg.standard", descriptionKey: "image.edit.precision.removeBg.standardDesc" },
    { subMode: "fine-hair", intent: "remove_background", labelKey: "image.edit.precision.removeBg.fineHair", descriptionKey: "image.edit.precision.removeBg.fineHairDesc" },
    { subMode: "product-edge", intent: "remove_background", labelKey: "image.edit.precision.removeBg.productEdge", descriptionKey: "image.edit.precision.removeBg.productEdgeDesc" },
    { subMode: "defringe", intent: "remove_background", labelKey: "image.edit.precision.removeBg.defringe", descriptionKey: "image.edit.precision.removeBg.defringeDesc" },
  ],
  "replace-bg": [
    { subMode: "solid", intent: "replace_background", labelKey: "image.edit.precision.replaceBg.solid", descriptionKey: "image.edit.precision.replaceBg.solidDesc" },
    { subMode: "commerce", intent: "replace_background", labelKey: "image.edit.precision.replaceBg.commerce", descriptionKey: "image.edit.precision.replaceBg.commerceDesc" },
    { subMode: "studio", intent: "replace_background", labelKey: "image.edit.precision.replaceBg.studio", descriptionKey: "image.edit.precision.replaceBg.studioDesc" },
    { subMode: "realistic", intent: "replace_background", labelKey: "image.edit.precision.replaceBg.realistic", descriptionKey: "image.edit.precision.replaceBg.realisticDesc" },
    { subMode: "stylized", intent: "replace_background", labelKey: "image.edit.precision.replaceBg.stylized", descriptionKey: "image.edit.precision.replaceBg.stylizedDesc" },
  ],
  "text-removal": [
    { subMode: "auto", intent: "remove_text", labelKey: "image.edit.precision.textRemoval.auto", descriptionKey: "image.edit.precision.textRemoval.autoDesc" },
    { subMode: "screenshot", intent: "remove_text", labelKey: "image.edit.precision.textRemoval.screenshot", descriptionKey: "image.edit.precision.textRemoval.screenshotDesc" },
    { subMode: "poster", intent: "remove_text", labelKey: "image.edit.precision.textRemoval.poster", descriptionKey: "image.edit.precision.textRemoval.posterDesc" },
    { subMode: "watermark", intent: "remove_text", labelKey: "image.edit.precision.textRemoval.watermark", descriptionKey: "image.edit.precision.textRemoval.watermarkDesc" },
  ],
  upscale: [
    { subMode: "faithful", intent: "faithful_enhance", labelKey: "image.edit.precision.upscale.faithful", descriptionKey: "image.edit.precision.upscale.faithfulDesc" },
    { subMode: "ai", intent: "ai_upscale", labelKey: "image.edit.precision.upscale.ai", descriptionKey: "image.edit.precision.upscale.aiDesc" },
  ],
  inpaint: [
    { subMode: "replace", intent: "local_replace", labelKey: "image.edit.precision.inpaint.replace", descriptionKey: "image.edit.precision.inpaint.replaceDesc" },
    { subMode: "modify", intent: "local_modify", labelKey: "image.edit.precision.inpaint.modify", descriptionKey: "image.edit.precision.inpaint.modifyDesc" },
    { subMode: "add", intent: "local_add", labelKey: "image.edit.precision.inpaint.add", descriptionKey: "image.edit.precision.inpaint.addDesc" },
    { subMode: "repair", intent: "local_repair", labelKey: "image.edit.precision.inpaint.repair", descriptionKey: "image.edit.precision.inpaint.repairDesc" },
  ],
  "region-brush": [
    { subMode: "remove", intent: "object_remove_repair", labelKey: "image.edit.precision.regionBrush.remove", descriptionKey: "image.edit.precision.regionBrush.removeDesc" },
    { subMode: "include-shadow", intent: "object_remove_repair", labelKey: "image.edit.precision.regionBrush.includeShadow", descriptionKey: "image.edit.precision.regionBrush.includeShadowDesc" },
    { subMode: "strong-cleanup", intent: "object_remove_repair", labelKey: "image.edit.precision.regionBrush.strongCleanup", descriptionKey: "image.edit.precision.regionBrush.strongCleanupDesc" },
  ],
};

/* 示例：展示原图 vs 处理后效果 */
const MODE_CONFIG = {
  "remove-bg": {
    title: "AI Background Removal",
    subtitle: "Remove image backgrounds instantly with AI",
    tabKey: "image.edit.removeBg",
    tabIcon: Eraser,
    uploadHintKey: "image.edit.uploadHint",
    exampleTitleKey: "image.edit.examplePreview",
    exampleSubtitleKey: "image.edit.removeBgExampleSubtitle",
    afterLabelKey: "image.edit.after.removeBg",
    buttonKey: "image.edit.removeBg",
    resultKey: "image.edit.result.removed",
    toastSuccessKey: "image.edit.toast.removeBgSuccess",
    category: "remove-bg",
    promptPlaceholderKey: "",
    promptLabelKey: "",
    examples: [
      { before: "/examples/remove-bg-before.png", after: "/examples/remove-bg-after.png", labelKey: "image.edit.example.portrait" },
    ],
  },
  "replace-bg": {
    title: "AI Background Replacement",
    subtitle: "Replace image backgrounds with AI-generated scenes",
    tabKey: "image.edit.replaceBg",
    tabIcon: Sparkles,
    uploadHintKey: "image.edit.uploadHint",
    exampleTitleKey: "image.edit.examplePreview",
    exampleSubtitleKey: "image.edit.replaceBgExampleSubtitle",
    afterLabelKey: "image.edit.after.replaced",
    buttonKey: "image.edit.replaceBg",
    resultKey: "image.edit.result.replaced",
    toastSuccessKey: "image.edit.toast.replaceBgSuccess",
    category: "replace-bg",
    promptPlaceholderKey: "image.edit.prompt.replaceBgPlaceholder",
    promptLabelKey: "image.edit.prompt.replaceBgLabel",
    examples: [
      { before: "/examples/replace-bg-before.png", after: "/examples/replace-bg-after.png", labelKey: "image.edit.example.beach" },
    ],
  },
  "text-removal": {
    title: "AI Text Removal",
    subtitle: "Remove text, watermarks, and unwanted inscriptions from images",
    tabKey: "image.edit.textRemoval",
    tabIcon: Type,
    uploadHintKey: "image.edit.uploadHint",
    exampleTitleKey: "image.edit.exampleScenes",
    exampleSubtitleKey: "image.edit.textRemovalExampleSubtitle",
    afterLabelKey: "image.edit.after.removed",
    buttonKey: "image.edit.removeText",
    resultKey: "image.edit.result.removed",
    toastSuccessKey: "image.edit.toast.textRemovalSuccess",
    category: "text-removal",
    promptPlaceholderKey: "",
    promptLabelKey: "",
    examples: [
      { before: "/examples/text-removal-before.png", after: "/examples/text-removal-after.png", labelKey: "image.edit.example.watermark" },
    ],
  },

  "inpaint": {
    title: "AI Inpainting",
    subtitle: "Redraw selected areas with a prompt",
    tabKey: "image.edit.inpaint",
    tabIcon: Brush,
    uploadHintKey: "image.edit.uploadHint",
    exampleTitleKey: "image.edit.examplePreview",
    exampleSubtitleKey: "image.edit.inpaintExampleSubtitle",
    afterLabelKey: "image.edit.after.inpainted",
    buttonKey: "image.edit.startInpaint",
    resultKey: "image.edit.result.inpainted",
    toastSuccessKey: "image.edit.toast.inpaintSuccess",
    category: "inpaint",
    promptPlaceholderKey: "image.edit.prompt.inpaintPlaceholder",
    promptLabelKey: "image.edit.prompt.inpaintLabel",
    examples: [
      { before: "/examples/inpaint-before.png", after: "/examples/inpaint-after.png", labelKey: "image.edit.example.localEdit" },
    ],
  },
  "region-brush": {
    title: "AI Region Brush",
    subtitle: "Brush an area to remove or repair it naturally",
    tabKey: "image.edit.regionBrush",
    tabIcon: Paintbrush,
    uploadHintKey: "image.edit.uploadHint",
    exampleTitleKey: "image.edit.examplePreview",
    exampleSubtitleKey: "image.edit.regionBrushExampleSubtitle",
    afterLabelKey: "image.edit.after.brushed",
    buttonKey: "image.edit.startRegionBrush",
    resultKey: "image.edit.result.brushed",
    toastSuccessKey: "image.edit.toast.regionBrushSuccess",
    category: "region-brush",
    promptPlaceholderKey: "image.edit.prompt.regionBrushPlaceholder",
    promptLabelKey: "image.edit.prompt.regionBrushLabel",
    examples: [
      { before: "/examples/region-brush-before.png", after: "/examples/region-brush-after.png", labelKey: "image.edit.example.areaRepair" },
    ],
  },
  "upscale": {
    title: "AI Image Upscaler",
    subtitle: "Enhance and upscale images to 4x resolution with AI",
    tabKey: "image.edit.upscale",
    tabIcon: ZoomIn,
    uploadHintKey: "image.edit.uploadHint",
    exampleTitleKey: "image.edit.examplePreview",
    exampleSubtitleKey: "image.edit.upscaleExampleSubtitle",
    afterLabelKey: "image.edit.after.enhanced",
    buttonKey: "image.edit.startEnhance",
    resultKey: "image.edit.result.enhanced",
    toastSuccessKey: "image.edit.toast.upscaleSuccess",
    category: "upscale",
    promptPlaceholderKey: "",
    promptLabelKey: "",
    examples: [
      { before: "/examples/upscale-before.png", after: "/examples/upscale-after.png", labelKey: "image.edit.example.portrait" },
    ],
  },
} as const;

const MODE_ORDER: EditMode[] = ["remove-bg", "replace-bg", "text-removal", "upscale", "inpaint", "region-brush"];

type TranslateFn = (key: string, params?: Record<string, string>) => string;

const EDIT_ERROR_MESSAGE_KEYS: Partial<Record<UserFacingError["category"], string>> = {
  auth: "image.edit.error.loginRequired",
  quota: "image.edit.error.quota",
  rate_limit: "image.edit.error.rateLimit",
  network: "image.edit.error.network",
  timeout: "image.edit.error.timeout",
  validation: "image.edit.error.default",
  file: "image.edit.error.file",
  upload: "image.edit.error.uploadFailed",
  content_policy: "image.edit.error.contentPolicy",
  server: "image.edit.error.server",
  image_edit: "image.edit.error.default",
  image_generation: "image.edit.error.default",
  unknown: "image.edit.error.default",
};

function getLocalEditErrorKey(message: string) {
  if (/识别图片过大|image.*too large.*recogn/i.test(message)) return "image.edit.error.recognitionImageTooLarge";
  if (/智能分割|物体轮廓|涂抹需要识别|蒙版生成失败|smart recognition|recognition.*failed|object contour|mask.*failed/i.test(message)) {
    return "image.edit.error.recognitionFailed";
  }
  return null;
}

function getUserFacingEditError(error: unknown, t: TranslateFn) {
  const rawMessage = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const localKey = getLocalEditErrorKey(rawMessage);
  if (localKey) return t(localKey);

  const normalized = normalizeError(error, {
    module: "image_edit",
    fallbackTitle: t("image.edit.error.editFailed"),
    fallbackMessage: t("image.edit.error.default"),
  });
  const key = EDIT_ERROR_MESSAGE_KEYS[normalized.category];
  if (key) {
    const localized = t(key);
    if (localized !== key) return localized;
  }
  return normalized.message;
}

export default function ImageEditPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[400px] items-center justify-center">
        <Spinner className="h-8 w-8 animate-spin text-text-tertiary" />
      </div>
    }>
      <ImageEditContent />
    </Suspense>
  );
}


type RecognitionPayload = { imageBlob: Blob; overlayData: string; maskData: string; maskBounds: MaskBounds };

type MaskEditorHandle = {
  exportMaskBlob: () => Promise<Blob | null>;
  exportVisibleMaskBlob: () => Promise<Blob | null>;
  exportRecognitionPayload: (maxSide?: number) => Promise<RecognitionPayload | null>;
  exportOverlayDataUrl: () => string | null;
  applyMaskDataUrl: (dataUrl: string) => Promise<MaskBounds | null>;
  clearMask: () => void;
  hasMask: () => boolean;
  refineObjectMask: () => MaskBounds | null;
  recognizeMask: () => MaskBounds | null;
};

type MaskTool = "brush" | "eraser";
type MaskBounds = { x: number; y: number; width: number; height: number; coverage: number };

const MaskBrushEditor = forwardRef<MaskEditorHandle, {
  imageUrl: string;
  disabled?: boolean;
  t: (key: string) => string;
  onMaskChange?: () => void;
  recognized?: boolean;
  recognizedLabel?: string;
  embedded?: boolean;
}>(
  function MaskBrushEditor({ imageUrl, disabled, t, onMaskChange, recognized, recognizedLabel, embedded }, ref) {
    const imgRef = useRef<HTMLImageElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef(false);
    const hasMaskRef = useRef(false);
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);
    const [brushSize, setBrushSize] = useState(44);
    const [loaded, setLoaded] = useState(false);
    const [tool, setTool] = useState<MaskTool>("brush");
    const [maskBounds, setMaskBounds] = useState<MaskBounds | null>(null);

    const computeMaskBounds = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas || !hasMaskRef.current) {
        setMaskBounds(null);
        return null;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      const { width, height } = canvas;
      const data = ctx.getImageData(0, 0, width, height).data;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      let painted = 0;
      const step = Math.max(1, Math.floor(Math.max(width, height) / 900));
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const alpha = data[(y * width + x) * 4 + 3];
          if (alpha > 8) {
            painted += step * step;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < minX || maxY < minY) {
        hasMaskRef.current = false;
        setMaskBounds(null);
        return null;
      }
      const pad = Math.max(6, Math.round(Math.min(width, height) * 0.008));
      const bounds = {
        x: Math.max(0, minX - pad),
        y: Math.max(0, minY - pad),
        width: Math.min(width - Math.max(0, minX - pad), maxX - minX + pad * 2),
        height: Math.min(height - Math.max(0, minY - pad), maxY - minY + pad * 2),
        coverage: Math.min(100, Math.round((painted / (width * height)) * 1000) / 10),
      };
      setMaskBounds(bounds);
      return bounds;
    }, []);

    const refineObjectMask = useCallback(() => {
      const maskCanvas = canvasRef.current;
      if (!maskCanvas || !hasMaskRef.current) return computeMaskBounds();
      const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
      if (!maskCtx) return computeMaskBounds();
      const width = maskCanvas.width;
      const height = maskCanvas.height;
      const maskImage = maskCtx.getImageData(0, 0, width, height);
      const data = maskImage.data;
      let minX = width, minY = height, maxX = -1, maxY = -1, painted = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          if (data[idx + 3] > 12) {
            painted++;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (!painted || maxX < minX || maxY < minY) return computeMaskBounds();

      // Safe object-selection mode: do NOT expand by color similarity. That over-selects forest/desk/background.
      // Only smooth the user's painted mask slightly so recognition never becomes a huge unrelated background area.
      const roiPad = Math.max(10, Math.round(Math.min(width, height) * 0.012));
      const roiMinX = Math.max(0, minX - roiPad);
      const roiMinY = Math.max(0, minY - roiPad);
      const roiMaxX = Math.min(width - 1, maxX + roiPad);
      const roiMaxY = Math.min(height - 1, maxY + roiPad);
      let cur = new Uint8Array(width * height);
      for (let y = roiMinY; y <= roiMaxY; y++) {
        for (let x = roiMinX; x <= roiMaxX; x++) {
          const p = y * width + x;
          if (data[p * 4 + 3] > 12) cur[p] = 1;
        }
      }
      const stepMorph = (src: Uint8Array, mode: "dilate" | "erode") => {
        const next = new Uint8Array(width * height);
        for (let y = roiMinY; y <= roiMaxY; y++) {
          for (let x = roiMinX; x <= roiMaxX; x++) {
            let hits = 0;
            for (let yy = -1; yy <= 1; yy++) {
              for (let xx = -1; xx <= 1; xx++) {
                const nx = x + xx;
                const ny = y + yy;
                if (nx < roiMinX || nx > roiMaxX || ny < roiMinY || ny > roiMaxY) continue;
                hits += src[ny * width + nx] ? 1 : 0;
              }
            }
            const p = y * width + x;
            next[p] = mode === "dilate" ? (hits >= 2 ? 1 : 0) : (hits >= 4 ? 1 : 0);
          }
        }
        return next;
      };
      cur = stepMorph(cur, "dilate");
      cur = stepMorph(cur, "erode");

      const originalArea = painted;
      let refinedArea = 0;
      for (let i = 0; i < cur.length; i++) if (cur[i]) refinedArea++;
      // Guardrail: never let recognition grow beyond a small cleanup margin.
      if (refinedArea > originalArea * 1.35) {
        return computeMaskBounds();
      }
      const out = maskCtx.createImageData(width, height);
      for (let y = roiMinY; y <= roiMaxY; y++) {
        for (let x = roiMinX; x <= roiMaxX; x++) {
          const p = y * width + x;
          if (cur[p]) {
            const idx = p * 4;
            out.data[idx] = 168;
            out.data[idx + 1] = 85;
            out.data[idx + 2] = 247;
            out.data[idx + 3] = 122;
          }
        }
      }
      maskCtx.clearRect(0, 0, width, height);
      maskCtx.putImageData(out, 0, 0);
      hasMaskRef.current = true;
      return computeMaskBounds();
    }, [computeMaskBounds]);

    const resizeCanvas = useCallback(() => {
      const img = imgRef.current;
      const canvas = canvasRef.current;
      if (!img || !canvas || !img.naturalWidth || !img.naturalHeight) return;
      if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        hasMaskRef.current = false;
        setMaskBounds(null);
      }
      setLoaded(true);
    }, []);

    const pointToImage = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * canvas.width,
        y: ((e.clientY - rect.top) / rect.height) * canvas.height,
      };
    }, []);

    const markMaskChanged = useCallback(() => {
      hasMaskRef.current = true;
      setMaskBounds(null);
      onMaskChange?.();
    }, [onMaskChange]);

    const drawSegment = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = brushSize;
      if (tool === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
        ctx.fillStyle = "rgba(0,0,0,1)";
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = "rgba(168, 85, 247, 0.48)";
        ctx.fillStyle = "rgba(168, 85, 247, 0.48)";
      }
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(to.x, to.y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      markMaskChanged();
    }, [brushSize, markMaskChanged, tool]);

    const drawAt = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      const pt = pointToImage(e);
      if (!pt) return;
      const from = lastPointRef.current ?? pt;
      drawSegment(from, pt);
      lastPointRef.current = pt;
    }, [drawSegment, pointToImage]);

    const clearMask = useCallback(() => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasMaskRef.current = false;
      setMaskBounds(null);
      lastPointRef.current = null;
      onMaskChange?.();
    }, [onMaskChange]);

    useImperativeHandle(ref, () => ({
      hasMask: () => hasMaskRef.current,
      refineObjectMask,
      recognizeMask: computeMaskBounds,
      clearMask,
      exportRecognitionPayload: async (maxSide = 1600) => {
        const img = imgRef.current;
        const maskCanvas = canvasRef.current;
        if (!img || !maskCanvas || !hasMaskRef.current) return null;
        const scale = Math.min(1, maxSide / Math.max(maskCanvas.width, maskCanvas.height));
        const width = Math.max(1, Math.round(maskCanvas.width * scale));
        const height = Math.max(1, Math.round(maskCanvas.height * scale));

        const imageCanvas = document.createElement("canvas");
        imageCanvas.width = width;
        imageCanvas.height = height;
        const imageCtx = imageCanvas.getContext("2d");
        if (!imageCtx) return null;
        imageCtx.drawImage(img, 0, 0, width, height);
        const imageBlob = await canvasToBlob(imageCanvas, "image/jpeg", 0.86);
        if (!imageBlob) return null;

        const maskExportCanvas = document.createElement("canvas");
        maskExportCanvas.width = width;
        maskExportCanvas.height = height;
        const maskCtx = maskExportCanvas.getContext("2d");
        if (!maskCtx) return null;
        maskCtx.drawImage(maskCanvas, 0, 0, width, height);
        const maskBlob = await canvasToBlob(maskExportCanvas, "image/png");
        if (!maskBlob) return null;

        const overlayCanvas = document.createElement("canvas");
        overlayCanvas.width = width;
        overlayCanvas.height = height;
        const overlayCtx = overlayCanvas.getContext("2d");
        if (!overlayCtx) return null;
        overlayCtx.drawImage(imageCanvas, 0, 0);
        overlayCtx.drawImage(maskExportCanvas, 0, 0);

        const sourceBounds = computeMaskBounds();
        if (!sourceBounds) return null;
        return {
          imageBlob,
          maskData: await blobToDataUrl(maskBlob),
          overlayData: overlayCanvas.toDataURL("image/jpeg", 0.86),
          maskBounds: {
            x: Math.round(sourceBounds.x * scale),
            y: Math.round(sourceBounds.y * scale),
            width: Math.max(1, Math.round(sourceBounds.width * scale)),
            height: Math.max(1, Math.round(sourceBounds.height * scale)),
            coverage: sourceBounds.coverage,
          },
        };
      },
      exportOverlayDataUrl: () => {
        const img = imgRef.current;
        const maskCanvas = canvasRef.current;
        if (!img || !maskCanvas || !hasMaskRef.current) return null;
        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = maskCanvas.width;
        exportCanvas.height = maskCanvas.height;
        const ctx = exportCanvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, exportCanvas.width, exportCanvas.height);
        ctx.drawImage(maskCanvas, 0, 0);
        return exportCanvas.toDataURL("image/png");
      },
      applyMaskDataUrl: async (dataUrl: string) => {
        const maskCanvas = canvasRef.current;
        if (!maskCanvas || !dataUrl) return null;
        const ctx = maskCanvas.getContext("2d");
        if (!ctx) return null;
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
            ctx.drawImage(img, 0, 0, maskCanvas.width, maskCanvas.height);
            hasMaskRef.current = true;
            resolve();
          };
          img.onerror = () => reject(new Error("分割蒙版加载失败"));
          img.src = dataUrl;
        });
        return computeMaskBounds();
      },
      exportVisibleMaskBlob: async () => {
        const maskCanvas = canvasRef.current;
        if (!maskCanvas || !hasMaskRef.current) return null;
        return await new Promise<Blob | null>((resolve) => maskCanvas.toBlob(resolve, "image/png"));
      },
      exportMaskBlob: async () => {
        const maskCanvas = canvasRef.current;
        if (!maskCanvas || !hasMaskRef.current) return null;
        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = maskCanvas.width;
        exportCanvas.height = maskCanvas.height;
        const ctx = exportCanvas.getContext("2d");
        if (!ctx) return null;
        // OpenAI mask: fully transparent pixels are edited. Keep unpainted area opaque; cut out painted strokes.
        ctx.fillStyle = "rgba(0,0,0,1)";
        ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
        ctx.globalCompositeOperation = "destination-out";
        ctx.drawImage(maskCanvas, 0, 0);
        return await new Promise<Blob | null>((resolve) => exportCanvas.toBlob(resolve, "image/png"));
      },
    }), [clearMask, computeMaskBounds, refineObjectMask]);

    return (
      <div className="w-full space-y-3">
        <div className={cn(
          embedded
            ? "relative mx-auto flex h-full min-h-0 flex-1 w-full items-center justify-center overflow-hidden rounded-xl p-3 transition-colors"
            : "relative mx-auto flex h-[clamp(640px,78vh,820px)] min-h-[640px] w-full items-center justify-center overflow-hidden rounded-2xl border bg-surface-card p-3 shadow-sm transition-colors",
          !embedded && (recognized ? "border-[color:var(--brand-border)] ring-4 ring-[color:var(--brand-focus)]" : "border-surface-border"),
          embedded && recognized && "ring-4 ring-[color:var(--brand-focus)]"
        )}>
          <div className="relative inline-block max-h-full max-w-full select-none">
            <img
              ref={imgRef}
              src={imageUrl}
              alt={t("image.edit.sourceImage")}
              className="max-h-full max-w-full rounded-xl object-contain"
              onLoad={resizeCanvas}
              draggable={false}
            />
            <canvas
              ref={canvasRef}
              className={cn(
                "absolute inset-0 h-full w-full touch-none rounded-xl",
                tool === "eraser" ? "cursor-cell" : "cursor-crosshair"
              )}
              style={{ opacity: loaded ? 1 : 0 }}
              onPointerDown={(e) => {
                if (disabled) return;
                drawingRef.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                const pt = pointToImage(e);
                lastPointRef.current = pt;
                if (pt) drawSegment(pt, pt);
              }}
              onPointerMove={(e) => {
                if (!drawingRef.current || disabled) return;
                drawAt(e);
              }}
              onPointerUp={(e) => {
                drawingRef.current = false;
                lastPointRef.current = null;
                try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
              }}
              onPointerCancel={() => {
                drawingRef.current = false;
                lastPointRef.current = null;
              }}
            />
            {recognized && maskBounds && (
              <div
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-[color:var(--brand-border)] bg-surface-card/95 px-3 py-1 text-xs font-semibold text-brand shadow-lg backdrop-blur"
                style={{
                  left: `${((maskBounds.x + maskBounds.width / 2) / (canvasRef.current?.width || 1)) * 100}%`,
                  top: `${((maskBounds.y + maskBounds.height / 2) / (canvasRef.current?.height || 1)) * 100}%`,
                }}
              >
                {recognizedLabel || t("image.edit.selectedRegion")}
              </div>
            )}
          </div>
          {!loaded && <Spinner className="absolute h-8 w-8 animate-spin text-brand" />}
          {recognized && (
            <div className="absolute left-4 top-4 rounded-full border border-[color:var(--brand-border)] bg-surface-card/90 px-3 py-1 text-xs font-medium text-brand shadow-sm backdrop-blur">
              {recognizedLabel ? `${t("image.edit.regionRecognized")}: ${recognizedLabel}` : t("image.edit.regionRecognized")}{maskBounds ? ` · ${maskBounds.coverage || 1}%` : ""}
            </div>
          )}
        </div>
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-border bg-surface-card px-4 py-3 shadow-sm">
          <div className="flex items-center gap-1 rounded-lg bg-surface-elevated p-1 dark:bg-surface">
            {([
              { key: "brush" as const, icon: Brush, label: t("image.edit.brush") },
              { key: "eraser" as const, icon: Eraser, label: t("image.edit.eraser") },
            ]).map((item) => (
              <button
                key={item.key}
                type="button"
                disabled={disabled}
                onClick={() => setTool(item.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  tool === item.key
                    ? "bg-surface-card text-brand shadow-sm"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex min-w-[220px] flex-1 items-center gap-3">
            <span className="text-xs font-medium text-text-secondary">{t("image.edit.brushSize")}</span>
            <input
              type="range"
              min="8"
              max="140"
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              disabled={disabled}
              className="flex-1 accent-[var(--brand)]"
            />
            <span className="w-9 text-right text-xs text-text-tertiary">{brushSize}</span>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={clearMask}
            className="flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            <ResetIcon className="h-3.5 w-3.5" />
            {t("image.edit.clearMask")}
          </button>
        </div>
        <p className="text-center text-xs text-text-tertiary">{t("image.edit.maskHint")}</p>
      </div>
    );
  }
);


function extractUploadedFileId(url: string) {
  const match = url.match(/\/api\/files\/(file_[^/?#]+)\/view/);
  return match?.[1] || (url.startsWith("file_") ? url : "");
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取蒙版失败"));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = src;
  });
}

async function fetchWithTransientRetry(input: RequestInfo | URL, init: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (![502, 503, 504].includes(response.status) || attempt === attempts - 1) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error("请求失败，请稍后重试");
}

function expandBounds(bounds: MaskBounds, width: number, height: number, scaleX = 1.6, scaleY = 1.4): MaskBounds {
  const nextWidth = Math.min(width, Math.max(bounds.width + 36, Math.round(bounds.width * scaleX)));
  const nextHeight = Math.min(height, Math.max(bounds.height + 36, Math.round(bounds.height * scaleY)));
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const x = Math.max(0, Math.min(width - nextWidth, Math.round(centerX - nextWidth / 2)));
  const y = Math.max(0, Math.min(height - nextHeight, Math.round(centerY - nextHeight / 2)));
  return { x, y, width: nextWidth, height: nextHeight, coverage: Math.round((nextWidth * nextHeight / (width * height)) * 1000) / 10 };
}

function ImageEditContent() {
  const { t } = useI18n();
  const { images, deleteImage, upsertImage, startPolling } = useImage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editMode = useMemo(() => {
    const mode = searchParams?.get("mode") as EditMode | null;
    return mode && MODE_ORDER.includes(mode) ? mode : "remove-bg";
  }, [searchParams]);
  const initialImageUrl = searchParams?.get("image") || "";
  const [sourceUrl, setSourceUrl] = useState(initialImageUrl);
  const [sourceFileId, setSourceFileId] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [replacePrompt, setReplacePrompt] = useState("");
  const [selectedPrecisionRoute, setSelectedPrecisionRoute] = useState<ImageEditRoute>(DEFAULT_EDIT_ROUTES[editMode]);
  const [isEditing, setIsEditing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [hoveredMode, setHoveredMode] = useState<EditMode | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deletingIds, setDeletingIds] = useState<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const maskEditorRef = useRef<MaskEditorHandle>(null);
  const config = MODE_CONFIG[editMode];
  const isRemoveBgMode = editMode === "remove-bg";
  const isMaskMode = editMode === "inpaint" || editMode === "region-brush";
  const [regionStep, setRegionStep] = useState<"paint" | "recognized">("paint");
  const [recognizedObject, setRecognizedObject] = useState<{ label: string; description?: string; confidence?: number } | null>(null);
  const [recognizedEditMaskData, setRecognizedEditMaskData] = useState("");
  const [recognitionSourceFileId, setRecognitionSourceFileId] = useState("");
  const [isRecognizingRegion, setIsRecognizingRegion] = useState(false);
  const [textRegions, setTextRegions] = useState<TextRegion[]>([]);
  const [selectedTextIndices, setSelectedTextIndices] = useState<Set<number>>(new Set());
  const [isDetectingText, setIsDetectingText] = useState(false);
  const [textDetectionDone, setTextDetectionDone] = useState(false);
  const [textDetectionNote, setTextDetectionNote] = useState("");
  const textOverlayImgRef = useRef<HTMLImageElement>(null);
  const [textOverlayScale, setTextOverlayScale] = useState(1);
  const isRegionBrushMode = editMode === "region-brush";
  const requiresRegionRecognition = editMode === "inpaint" || editMode === "region-brush";
  const isTextRemovalMode = editMode === "text-removal";
  const isRegionRecognized = !requiresRegionRecognition || regionStep === "recognized";
  const totalFrameClass = "mx-auto flex h-[clamp(640px,78vh,820px)] min-h-[640px] w-full flex-col rounded-2xl border border-surface-border bg-surface-card p-6 shadow-sm";
  const imageSlotClass = "relative flex h-full min-h-0 flex-1 w-full items-center justify-center overflow-hidden rounded-xl border border-surface-border bg-surface-elevated/55";
  const uploadSlotClass = "flex h-full min-h-0 flex-1 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-transparent py-16 text-center transition-all duration-200 hover:border-[color:var(--brand)] hover:bg-brand-muted dark:border-gray-600 dark:hover:border-[color:var(--brand)] dark:hover:bg-brand-muted";
  const resetRegionRecognition = useCallback(() => {
    setRegionStep("paint");
    setRecognizedEditMaskData("");
    setRecognitionSourceFileId("");
  }, []);

  const getStoredToken = useCallback(() => {
    const token = localStorage.getItem("token")?.trim();
    if (!token || token === "null" || token === "undefined") return "";
    return token;
  }, []);

  const buildUploadHeaders = useCallback(() => {
    const headers: Record<string, string> = {};
    const token = getStoredToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    // 上传接口支持匿名兜底；即使浏览器残留过期 token，也要带 guest id，避免提交阶段卡在上传。
    const guestId = getGuestId();
    if (guestId) headers["X-Guest-ID"] = guestId;
    return headers;
  }, [getStoredToken]);

  const uploadRecognitionImage = useCallback(async (imageBlob: Blob) => {
    const formData = new FormData();
    formData.append("file", imageBlob, "recognition-image.jpg");
    const uploadResp = await fetch(`${API_BASE_URL}/api/files/upload`, {
      method: "POST",
      headers: buildUploadHeaders(),
      body: formData,
    });
    if (!uploadResp.ok) {
      const apiError = await readApiError(uploadResp);
      if (uploadResp.status === 413) {
        throw new Error("识别图片过大，请换一张较小图片或稍后重试");
      }
      throw apiError;
    }
    const uploadData = await uploadResp.json();
    const publicId = uploadData?.public_id || "";
    if (!publicId) throw new Error(t("image.edit.error.sourceUploadFailed"));
    return publicId;
  }, [buildUploadHeaders, t]);

  const handleRecognizeRegion = useCallback(async () => {
    if (!maskEditorRef.current?.hasMask()) {
      toast.error(t("image.edit.error.maskRequired"));
      return;
    }
    const bounds = maskEditorRef.current?.refineObjectMask();
    if (!bounds) {
      toast.error(t("image.edit.error.maskRequired"));
      return;
    }
    const payload = await maskEditorRef.current?.exportRecognitionPayload?.(1600);
    setIsRecognizingRegion(true);
    try {
      if (!payload?.overlayData || !payload?.maskData || !payload?.imageBlob) {
        throw new Error("请先涂抹需要识别的物体");
      }
      const recognitionFileId = await uploadRecognitionImage(payload.imageBlob);
      if (!recognitionFileId) {
        throw new Error("原图上传失败，无法进行智能分割");
      }
      // 识别阶段上传的是压缩图，只用于分割识别；最终编辑仍使用原图，保证输出尺寸不变。
      setRecognitionSourceFileId(recognitionFileId);
      const token = localStorage.getItem("token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token && token !== "null" && token !== "undefined") headers.Authorization = `Bearer ${token}`;
      const guestId = getGuestId();
      if (guestId) headers["X-Guest-ID"] = guestId;
      const resp = await fetch(`${API_BASE_URL}/api/images/recognize-mask`, {
        method: "POST",
        headers,
        body: JSON.stringify({ image_url: recognitionFileId, overlay_data: payload.overlayData, mask_data: payload.maskData, edit_mode: editMode }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        throw new Error(data?.message || data?.error || `智能分割接口失败 (${resp.status})`);
      }
      if (!data?.refined_mask_data) {
        throw new Error("智能分割没有返回物体轮廓，请多涂抹物体主体后重试");
      }
      // refined_mask_data 与识别阶段上传的压缩源图同尺寸；同时生成一份 OpenAI 编辑用 mask，
      // 避免最终提交时重新按原图尺寸导出 mask 导致 source/mask 尺寸不一致。
      const refinedMaskImg = await loadHtmlImage(data.refined_mask_data);
      const editMaskCanvas = document.createElement("canvas");
      editMaskCanvas.width = refinedMaskImg.naturalWidth || refinedMaskImg.width;
      editMaskCanvas.height = refinedMaskImg.naturalHeight || refinedMaskImg.height;
      const editMaskCtx = editMaskCanvas.getContext("2d");
      if (!editMaskCtx) throw new Error("蒙版生成失败，请重新识别区域");
      // OpenAI Images Edit 的 mask 语义是：透明区域会被编辑，不透明区域必须保持。
      // refined_mask_data 是前端展示用的紫色半透明 overlay，不能直接 destination-out，必须二值化。
      editMaskCtx.drawImage(refinedMaskImg, 0, 0, editMaskCanvas.width, editMaskCanvas.height);
      const maskPixels = editMaskCtx.getImageData(0, 0, editMaskCanvas.width, editMaskCanvas.height);
      let selectedCount = 0;
      for (let i = 0; i < maskPixels.data.length; i += 4) {
        const selected = maskPixels.data[i + 3] > 16;
        if (selected) selectedCount += 1;
        maskPixels.data[i] = 0;
        maskPixels.data[i + 1] = 0;
        maskPixels.data[i + 2] = 0;
        maskPixels.data[i + 3] = selected ? 0 : 255;
      }
      editMaskCtx.putImageData(maskPixels, 0, 0);
      if (editMode === "inpaint" || editMode === "region-brush") {
        // 局部重绘/区域涂抹都需要处理完整对象：如果识别轮廓太窄，模型会保留原物体或只修复一小块。
        // 最终编辑 mask 使用“精细轮廓 + 用户原始涂抹外接框扩张”作为可编辑区。
        const expanded = expandBounds(payload.maskBounds, editMaskCanvas.width, editMaskCanvas.height);
        editMaskCtx.clearRect(expanded.x, expanded.y, expanded.width, expanded.height);
        selectedCount += expanded.width * expanded.height;
      }
      console.info("[region-mask] edit mask coverage", Math.round((selectedCount / (editMaskCanvas.width * editMaskCanvas.height)) * 1000) / 10);
      const editMaskBlob = await canvasToBlob(editMaskCanvas, "image/png");
      const editMaskData = editMaskBlob ? await blobToDataUrl(editMaskBlob) : "";
      if (!editMaskData) throw new Error("蒙版生成失败，请重新识别区域");
      setRecognizedEditMaskData(editMaskData);
      await maskEditorRef.current?.applyMaskDataUrl(data.refined_mask_data);
      const recognizedLabel = data?.label || "选中物体";
      setRecognizedObject({ label: recognizedLabel, description: data.description, confidence: data.confidence });
      setRegionStep("recognized");
      toast.success(`${t("image.edit.regionRecognized")}: ${recognizedLabel}`);
    } catch (error) {
      console.warn("object segmentation failed", error);
      setRegionStep("paint");
      toast.error(getUserFacingEditError(error, t));
    } finally {
      setIsRecognizingRegion(false);
    }
  }, [editMode, uploadRecognitionImage, t]);

  useEffect(() => {
    setSelectedPrecisionRoute(DEFAULT_EDIT_ROUTES[editMode]);
    setTextRegions([]);
    setSelectedTextIndices(new Set());
    setTextDetectionDone(false);
    setTextDetectionNote("");
  }, [editMode]);

  useEffect(() => {
    const image = searchParams?.get("image") || "";
    setSourceUrl(image);
    setSourceFile(null);
    setSourceFileId(extractUploadedFileId(image));
    setResult(null);
    setRegionStep("paint");
    setRecognizedEditMaskData("");
    setRecognitionSourceFileId("");
    maskEditorRef.current?.clearMask();
  }, [searchParams]);

  const switchMode = (mode: EditMode) => {
    setResult(null);
    setReplacePrompt("");
    setRegionStep("paint");
    setRecognizedEditMaskData("");
    setRecognitionSourceFileId("");
    maskEditorRef.current?.clearMask();
    const params = new URLSearchParams({ mode });
    if (sourceUrl) params.set("image", sourceUrl);
    router.replace(`/create?${params.toString()}`, { scroll: false });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("image.edit.error.selectImageFile"));
      return;
    }
    try {
      setSourceFile(file);
      setSourceFileId("");
      setRecognizedEditMaskData("");
      setRecognitionSourceFileId("");
      const reader = new FileReader();
      reader.onload = () => {
        setSourceUrl(reader.result as string);
        setResult(null);
        toast.success(t("image.edit.toast.imageSelected"));
      };
      reader.onerror = () => toast.error(t("image.edit.error.readImageFailed"));
      reader.readAsDataURL(file);
    } catch (err) {
      toast.error(getUserFacingEditError(err, t));
    }
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    handleFileSelect({ target: { files: dt.files } } as any);
  };

  const handleDetectText = async () => {
    if (!sourceUrl) {
      toast.error(t("image.edit.error.uploadFirst"));
      return;
    }
    setIsDetectingText(true);
    try {
      let imagePublicId = sourceFileId || extractUploadedFileId(sourceUrl);
      if (!imagePublicId) {
        const formData = new FormData();
        if (sourceFile) {
          formData.append("file", sourceFile, sourceFile.name || "edit-image.png");
        } else if (sourceUrl.startsWith("data:")) {
          const imageBlob = await (await fetch(sourceUrl)).blob();
          formData.append("file", imageBlob, "edit-image.png");
        } else {
          throw new Error(t("image.edit.error.sourceReadFailed"));
        }
        const uploadResp = await fetch(`${API_BASE_URL}/api/files/upload`, {
          method: "POST",
          headers: buildUploadHeaders(),
          body: formData,
        });
        if (!uploadResp.ok) throw await readApiError(uploadResp);
        const uploadData = await uploadResp.json();
        imagePublicId = uploadData.public_id;
        if (imagePublicId) setSourceFileId(imagePublicId);
      }
      if (!imagePublicId) {
        throw new Error(t("image.edit.error.sourceReadFailed"));
      }
      const token = getStoredToken();
      const res = await fetch(`${API_BASE_URL}/api/images/edit/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image_url: imagePublicId, sub_mode: selectedPrecisionRoute.subMode }),
      });
      if (!res.ok) throw await readApiError(res);
      const data = await res.json();
      if (data.ok && data.regions) {
        const regions = Array.isArray(data.regions) ? data.regions : [];
        setTextRegions(regions);
        setSelectedTextIndices(new Set(regions.map((_: TextRegion, i: number) => i)));
        setTextDetectionDone(true);
        if (regions.length > 0) {
          setTextDetectionNote("");
          toast.success(`检测到 ${regions.length} 处文字`);
        } else if (data.fallback_reason === "too_many_candidates") {
          setTextDetectionNote("自动检测不稳定，已隐藏疑似纹理误检框。请切换截图保护或后续使用手动选择区域。");
          toast.error("自动检测不稳定，未展示疑似误检框");
        } else {
          setTextDetectionNote("未识别到稳定文字区域，请尝试截图保护模式或手动选择区域。");
          toast.error("未识别到稳定文字区域");
        }
      } else {
        toast.error("未检测到文字");
      }
    } catch (err) {
      toast.error(getUserFacingEditError(err, t));
    } finally {
      setIsDetectingText(false);
    }
  };

  const handleEdit = async () => {
    if (!sourceUrl) {
      toast.error(t("image.edit.error.uploadFirst"));
      return;
    }
    if (editMode === "replace-bg" && !replacePrompt.trim()) {
      toast.error(t("image.edit.error.describeBg"));
      return;
    }
    if (isMaskMode && !maskEditorRef.current?.hasMask()) {
      toast.error(t("image.edit.error.maskRequired"));
      return;
    }
    if (requiresRegionRecognition && regionStep !== "recognized") {
      toast.error(t("image.edit.error.recognizeRequired"));
      return;
    }
    if (editMode === "inpaint" && !replacePrompt.trim()) {
      toast.error(t("image.edit.error.describeInpaint"));
      return;
    }
    const token = getStoredToken();
    if (!token) {
      toast.error(t("image.edit.error.loginRequired"));
      return;
    }
    setIsEditing(true);
    setResult(null);
    try {
      let imagePublicId = sourceFileId || extractUploadedFileId(sourceUrl);
      let uploadData: any = imagePublicId ? { public_id: imagePublicId } : null;
      if (!imagePublicId) {
        const formData = new FormData();
        if (sourceFile) {
          formData.append("file", sourceFile, sourceFile.name || "edit-image.png");
        } else if (sourceUrl.startsWith("data:")) {
          const imageBlob = await (await fetch(sourceUrl)).blob();
          formData.append("file", imageBlob, "edit-image.png");
        } else {
          throw new Error(t("image.edit.error.sourceReadFailed"));
        }

        const uploadResp = await fetch(`${API_BASE_URL}/api/files/upload`, {
          method: "POST",
          headers: buildUploadHeaders(),
          body: formData,
        });
        if (!uploadResp.ok) {
          throw await readApiError(uploadResp);
        }
        uploadData = await uploadResp.json();
        imagePublicId = uploadData.public_id;
        if (imagePublicId) setSourceFileId(imagePublicId);
      }

      let maskData = "";
      if (isMaskMode) {
        if (recognizedEditMaskData) {
          // 识别 mask 是按压缩识别图生成的；最终编辑使用原图时，必须把 mask 映射回原图画布尺寸。
          const maskImg = await loadHtmlImage(recognizedEditMaskData);
          const targetImg = await loadHtmlImage(sourceUrl);
          const targetCanvas = document.createElement("canvas");
          targetCanvas.width = targetImg.naturalWidth || targetImg.width;
          targetCanvas.height = targetImg.naturalHeight || targetImg.height;
          const targetCtx = targetCanvas.getContext("2d");
          if (!targetCtx) throw new Error(t("image.edit.error.maskExportFailed"));
          targetCtx.drawImage(maskImg, 0, 0, targetCanvas.width, targetCanvas.height);
          const resizedMaskBlob = await canvasToBlob(targetCanvas, "image/png");
          maskData = resizedMaskBlob ? await blobToDataUrl(resizedMaskBlob) : "";
          if (!maskData) throw new Error(t("image.edit.error.maskExportFailed"));
        } else {
          const maskBlob = await maskEditorRef.current?.exportMaskBlob();
          if (!maskBlob) throw new Error(t("image.edit.error.maskExportFailed"));
          maskData = await blobToDataUrl(maskBlob);
          if (!maskData) throw new Error(t("image.edit.error.maskExportFailed"));
        }
      }

      const body: Record<string, any> = {
        image_url: imagePublicId,
        edit_mode: editMode,
        sub_mode: selectedPrecisionRoute.subMode,
        intent: selectedPrecisionRoute.intent,
      };
      body.title = t(config.tabKey);
      if (editMode === "replace-bg") body.prompt = replacePrompt.trim();
      if (editMode === "inpaint") body.prompt = replacePrompt.trim();
      if (editMode === "region-brush" && replacePrompt.trim()) body.prompt = replacePrompt.trim();
      if (editMode === "text-removal" && textDetectionDone && selectedTextIndices.size > 0) {
        const maskCanvas = document.createElement("canvas");
        const maskImg = await loadHtmlImage(sourceUrl);
        maskCanvas.width = maskImg.naturalWidth || maskImg.width;
        maskCanvas.height = maskImg.naturalHeight || maskImg.height;
        const maskCtx = maskCanvas.getContext("2d");
        if (maskCtx) {
          maskCtx.fillStyle = "black";
          maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
          maskCtx.fillStyle = "white";
          const pad = Math.max(2, Math.round(Math.min(maskCanvas.width, maskCanvas.height) / 500));
          textRegions.forEach((region, i) => {
            if (selectedTextIndices.has(i)) {
              const [x1, y1, x2, y2] = region.bbox;
              maskCtx.fillRect(x1 - pad, y1 - pad, (x2 - x1) + pad * 2, (y2 - y1) + pad * 2);
            }
          });
          const maskBlob = await canvasToBlob(maskCanvas, "image/png");
          if (maskBlob) {
            const maskDataUrl = await blobToDataUrl(maskBlob);
            if (maskDataUrl) body.mask_data = maskDataUrl;
          }
        }
      }
      if (maskData) body.mask_data = maskData;

      const res = await fetchWithTransientRetry(`${API_BASE_URL}/api/images/edit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw await readApiError(res);
      }
      const data = await res.json();
      if (data?.id) {
        upsertImage({
          id: data.id,
          prompt: data.prompt || `[${t(config.tabKey)}] ${uploadData.public_id}`,
          size: data.size || "",
          image_url: data.image_url || "",
          status: data.status || "pending",
          created_at: data.created_at || new Date().toISOString(),
        });
        startPolling();
      }
      if (data.status === "pending" && data.id) {
        toast.info(t("image.edit.toast.processingStarted"));
        for (let i = 0; i < 120; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          const statusResp = await fetch(`${API_BASE_URL}/api/images/${data.id}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!statusResp.ok) continue;
          const statusData = await statusResp.json();
          upsertImage(statusData);
          if (statusData.status === "completed" && statusData.image_url) {
                  setResult(resolveImageUrl(statusData.image_url));
            toast.success(t(config.toastSuccessKey));
            return;
          }
          if (statusData.status === "failed") {
            throw new Error(statusData.error_message || t("image.edit.error.default"));
          }
        }
        throw new Error(t("image.edit.error.timeoutHistory"));
      }
      if (data?.image_url) {
        upsertImage({ ...data, status: data.status || "completed" });
          setResult(resolveImageUrl(data.image_url));
      }
      toast.success(t(config.toastSuccessKey));
    } catch (err) {
      toast.error(getUserFacingEditError(err, t));
    } finally {
      setIsEditing(false);
    }
  };

  const downloadImageUrl = async (url: string, suffix: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `aispace-${suffix}-${Date.now()}.png`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success(t("image.downloadStarted"));
    } catch {
      toast.error(t("image.downloadFailed"));
    }
  };

  const getDownloadSuffix = () =>
    editMode === "upscale"
      ? "hd"
      : editMode === "text-removal"
        ? "clean"
        : editMode === "inpaint"
          ? "inpaint"
          : editMode === "region-brush"
            ? "brush"
            : "edit";

  const handleDownload = async () => {
    if (!result) return;
    await downloadImageUrl(result, getDownloadSuffix());
  };

  const handleHistoryDownload = async (_id: number, item: CreationHistoryItem) => {
    if (!item.cover_image) return;
    await downloadImageUrl(resolveImageUrl(item.cover_image), getDownloadSuffix());
  };

  const handleReset = () => {
    setSourceUrl("");
    setReplacePrompt("");
    setResult(null);
    setRegionStep("paint");
    setRecognizedEditMaskData("");
    setRecognitionSourceFileId("");
    setTextRegions([]);
    setSelectedTextIndices(new Set());
    setTextDetectionDone(false);
    setTextDetectionNote("");
    maskEditorRef.current?.clearMask();
  };

  const useExample = (before: string) => {
    setSourceUrl(before);
    setResult(null);
    setRecognizedEditMaskData("");
    setRecognitionSourceFileId("");
    toast.success(t("image.edit.toast.exampleSelected"));
  };

  const handleDelete = async (id: number) => {
    setDeletingIds((prev) => [...prev, id]);
    try {
      await deleteImage(id);
      toast.success(t("image.deleteSuccess"));
    } catch {
      toast.error(t("image.deleteFailed"));
    } finally {
      setDeletingIds((prev) => prev.filter((i) => i !== id));
    }
  };

  const historyItems = useMemo<CreationHistoryItem[]>(() => {
    return images.map((img) => ({
      id: img.id,
      title: img.prompt || "",
      subtitle: img.size,
      updated_at: img.created_at,
      source: "image" as const,
      cover_image: img.image_url,
      status: img.status,
    }));
  }, [images]);

  const examples = config.examples;
  const precisionOptions = PRECISION_MODE_OPTIONS[editMode];
  const needsPrompt = editMode === "replace-bg" || (editMode === "inpaint" && regionStep === "recognized");
  const promptRequired = editMode === "replace-bg" || (editMode === "inpaint" && regionStep === "recognized");
  const submitDisabled = (promptRequired && !replacePrompt.trim()) || (requiresRegionRecognition && regionStep !== "recognized") || (isTextRemovalMode && textDetectionDone && selectedTextIndices.size === 0);

  const renderPrecisionModeSelector = (compact = false) => (
    <div className={cn("w-full rounded-xl border border-surface-border bg-surface-card p-4 shadow-sm", compact ? "max-w-3xl" : "max-w-4xl")}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-primary">{t("image.edit.precision.title")}</p>
          <p className="mt-1 text-xs text-text-tertiary">{t("image.edit.precision.desc")}</p>
        </div>
      </div>
      <div className={cn("grid gap-2", precisionOptions.length <= 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3")}>
        {precisionOptions.map((option) => {
          const selected = selectedPrecisionRoute.subMode === option.subMode;
          return (
            <button
              key={option.subMode}
              type="button"
              onClick={() => {
                setSelectedPrecisionRoute({ subMode: option.subMode, intent: option.intent });
                if (editMode === "text-removal") {
                  setTextRegions([]);
                  setSelectedTextIndices(new Set());
                  setTextDetectionDone(false);
                  setTextDetectionNote("");
                }
              }}
              disabled={isEditing}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-all",
                selected
                  ? "border-[color:var(--brand-border)] bg-brand-muted text-brand shadow-sm"
                  : "border-surface-border bg-surface-elevated text-text-secondary hover:border-[color:var(--brand-border)] hover:text-text-primary"
              )}
            >
              <span className="block text-xs font-semibold">{t(option.labelKey)}</span>
              <span className={cn("mt-1 block text-[11px] leading-4", selected ? "text-brand/80" : "text-text-tertiary")}>{t(option.descriptionKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  // 选择 TabIcon
  const TabIcon = config.tabIcon;

  return (
    <>
      {/* 顶部栏：历史按钮（对所有 editMode 共用） */}
      <header className="shrink-0 h-12 flex items-center justify-end px-4 bg-surface relative z-10">
        <div className="relative">
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200",
              historyOpen
                ? "bg-surface-card text-text-primary font-medium shadow-sm"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-card"
            )}
          >
            <History className="w-4 h-4" />
            <span>{t("common.history")}</span>
            {images.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-elevated text-text-tertiary">
                {images.length}
              </span>
            )}
          </button>
        </div>
      </header>

      <CreationHistoryPanel
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={t("image.historyTitle")}
        items={historyItems}
        onSelect={() => setHistoryOpen(false)}
        onDownload={handleHistoryDownload}
        onDelete={(id) => handleDelete(id)}
        emptyText={t("image.historyEmpty")}
      />

      {editMode === "remove-bg" ? (
        <div className="flex h-full flex-col bg-surface-elevated text-text-primary dark:bg-surface">
          <div className="flex-1 overflow-auto px-6 py-6 pb-10 md:px-10 md:py-8 md:pb-12">
            <div className="mx-auto flex h-full max-w-[1280px] flex-col">
              {!result ? (
                <div className="flex flex-1 flex-col items-center justify-start gap-6">
                  {/* 上传区 - 大白框（黄框区域）内部虚线上传触发区 */}
                  {!sourceUrl ? (
                    <>
                    <div className="flex w-full flex-col items-center justify-start">
                      <div className={totalFrameClass}>
                        <div
                          onDragOver={handleDragOver}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDrop}
                          onClick={() => fileInputRef.current?.click()}
                          className={cn(
                            uploadSlotClass,
                            dragOver && "border-[color:var(--brand)] bg-brand-muted"
                          )}
                        >
                          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-muted">
                            <ImagePlus className="h-8 w-8 text-brand" />
                          </div>
                          <p className="text-base font-medium text-text-primary">
                            {t("image.edit.uploadHint")}
                          </p>
                          <p className="mt-2 text-xs text-text-tertiary">
                            {t("image.edit.creditCostPrefix")} <span className="text-brand font-medium">3</span> {t("image.edit.creditCostSuffix")}
                          </p>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={handleFileSelect}
                          />
                        </div>

                      </div>
                    </div>
                  {/* 底部示例区 */}
                  {!sourceUrl && !isEditing && (
                    <div className="w-full shrink-0">
                      <div className="group/video mx-auto w-full max-w-[560px] overflow-hidden rounded-[22px] border border-surface-border bg-surface-card shadow-sm">
                        {/* 图片区域 */}
                        <div className="relative h-[190px] overflow-hidden p-4">
                          {/* 默认：左右双图对比 */}
                          <div className="flex items-center gap-4 transition-all duration-500 ease-out group-hover/video:-translate-y-2 group-hover/video:scale-[0.94] group-hover/video:opacity-0">
                            <div className="flex-1 text-center">
                              <img
                                src={examples[0].before}
                                alt={t("image.edit.before")}
                                className="h-36 w-full rounded-2xl object-cover bg-surface-elevated"
                              />
                              <div className="mt-2 text-xs font-medium text-text-tertiary">{t("image.edit.before")}</div>
                            </div>
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-[0_8px_18px_var(--brand-shadow)]">
                              <ArrowRight className="h-5 w-5" />
                            </div>
                            <div className="flex-1 text-center">
                              <div className="flex h-36 w-full items-center justify-center overflow-hidden rounded-2xl bg-[linear-gradient(45deg,#f0f0f0_25%,transparent_25%,transparent_75%,#f0f0f0_75%),linear-gradient(45deg,#f0f0f0_25%,transparent_25%,transparent_75%,#f0f0f0_75%)] bg-[length:16px_16px] bg-[position:0_0,8px_8px] dark:bg-surface-elevated">
                                <img
                                  src={examples[0].after}
                                  alt={t("image.edit.after")}
                                  className="h-full w-full rounded-2xl object-cover"
                                />
                              </div>
                              <div className="mt-2 text-xs font-medium text-brand">{t("image.edit.after.removeBg")}</div>
                            </div>
                          </div>
                          {/* 悬浮：BeforeAfterSlider */}
                          <div className="pointer-events-none absolute inset-5 translate-y-4 scale-[0.98] overflow-hidden rounded-2xl border border-surface-border bg-surface-card opacity-0 shadow-[0_18px_42px_rgba(80,64,120,0.16)] transition-all duration-500 ease-out group-hover/video:translate-y-0 group-hover/video:scale-100 group-hover/video:opacity-100 group-hover/video:pointer-events-auto">
                            <BeforeAfterSlider
                              beforeImage={examples[0].before}
                              afterImage={examples[0].after}
                              beforeLabel={t("image.edit.before")}
                              afterLabel={t("image.edit.after.removeBg")}
                              className="h-full [&>*:first-child]:!aspect-auto [&>*:first-child]:!h-full border-0 rounded-none"
                            />
                          </div>
                        </div>
                        {/* 标签 + 按钮 */}
                        <div className="flex items-center justify-between border-t border-surface-border/70 bg-surface-card/70 px-5 py-3">
                          <span className="text-sm font-medium text-text-secondary">{t(examples[0].labelKey)}</span>
                          <button
                            onClick={() => useExample(examples[0].before)}
                            className="flex items-center gap-1.5 rounded-full border border-[color:var(--brand-border)] bg-brand-muted px-4 py-1.5 text-xs font-medium text-brand transition-all duration-200 hover:border-[color:var(--brand-focus)] hover:bg-[var(--brand-soft-hover)]"
                          >
                            <Wand2 className="h-3.5 w-3.5" />
                            {t("image.edit.tryExample")}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                    </>
                  ) : (
                    <>
                      <div className={totalFrameClass}>
                        {isEditing ? (
                          <div className={cn(imageSlotClass, "flex-col gap-5 bg-surface-card px-10 py-16")}>
                            <Spinner className="h-12 w-12 animate-spin text-brand" />
                            <div className="text-center">
                              <p className="text-base font-semibold text-text-primary">{t("image.edit.processing")}</p>
                              <p className="mt-1 text-sm text-text-tertiary">{t("image.edit.processingRemoveBg")}</p>
                            </div>
                          </div>
                        ) : (
                          <div className={cn(imageSlotClass, "p-3 bg-surface-card")}>
                            <img
                              src={sourceUrl}
                              alt={t("image.edit.sourceImage")}
                              className="h-full max-h-full max-w-full rounded-lg object-contain"
                            />
                          </div>
                        )}
                      </div>
                      {!isEditing && renderPrecisionModeSelector()}
                      {!isEditing && (
                        <div className="flex items-center justify-center gap-3">
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={handleFileSelect}
                          />
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-card px-6 py-2.5 text-sm font-medium text-text-secondary shadow-sm transition-all hover:text-text-primary"
                          >
                            <Upload className="h-4 w-4" />
                            {t("image.edit.reupload")}
                          </button>
                          <button
                            onClick={handleEdit}
                            className="flex items-center gap-2 rounded-lg bg-brand px-8 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-hover"
                          >
                            <Sparkles className="h-4 w-4" />
                            {t("common.confirm")}
                          </button>
                        </div>
                      )}
                    </>
                  )}

                </div>
              ) : (
                /* 结果展示 */
                <div className="mx-auto w-full max-w-[1280px] space-y-6 py-8">
                  <div className="overflow-hidden rounded-2xl border border-surface-border bg-surface-card p-3 shadow-sm">
                    <BeforeAfterSlider
                      beforeImage={sourceUrl}
                      afterImage={result}
                      beforeLabel={t("image.edit.original")}
                      afterLabel={t(config.resultKey)}
                      className="h-[clamp(560px,72vh,760px)] [&>*:first-child]:!aspect-auto [&>*:first-child]:!h-full"
                    />
                  </div>
                  <div className="flex items-center justify-center gap-3">
                    <button
                      onClick={handleDownload}
                      className="flex items-center gap-2 rounded-lg bg-brand px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-hover"
                    >
                      <Download className="h-4 w-4" />
                      {t("image.edit.downloadImage")}
                    </button>
                    <button
                      onClick={handleReset}
                      className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-card px-6 py-2.5 text-sm font-medium text-text-secondary shadow-sm transition-all hover:text-text-primary"
                    >
                      <RotateCcw className="h-4 w-4" />
                      {t("image.edit.reupload")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col bg-surface-elevated text-text-primary dark:bg-surface">
          <div className="flex-1 overflow-auto px-6 py-6 pb-10 md:px-10 md:py-8 md:pb-12">
            <div className="mx-auto flex h-full max-w-[1280px] flex-col">
              {!result ? (
                <div className="flex flex-1 flex-col items-center justify-start gap-6">
                  {/* 上传区 */}
                  {!sourceUrl ? (
                    <>
                    <div className="flex w-full flex-col items-center justify-start">
                      <div className={totalFrameClass}>
                        <div
                          onDragOver={handleDragOver}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDrop}
                          onClick={() => fileInputRef.current?.click()}
                          className={cn(
                            uploadSlotClass,
                            dragOver && "border-[color:var(--brand)] bg-brand-muted"
                          )}
                        >
                          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-muted">
                            <TabIcon className="h-8 w-8 text-brand" />
                          </div>
                          <p className="text-base font-medium text-text-primary">
                            {t("image.edit.uploadHint")}
                          </p>
                          <p className="mt-2 text-xs text-text-tertiary">
                            {t("image.edit.supportedFormats")}
                          </p>
                          <div className="mt-4 flex items-center gap-3">
                            <span className="text-xs text-text-tertiary">{t("common.or")}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                useExample(examples[0].before);
                              }}
                              className="flex items-center gap-1.5 rounded-full border border-[color:var(--brand-border)] bg-brand-muted px-4 py-1.5 text-xs font-medium text-brand transition-all duration-200 hover:bg-[var(--brand-soft-hover)]"
                            >
                              <Wand2 className="h-3.5 w-3.5" />
                              {t("image.edit.tryExample")}
                            </button>
                          </div>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={handleFileSelect}
                          />
                        </div>

                      </div>
                    </div>
                  {/* 底部示例区 */}
                  {!sourceUrl && !isEditing && (
                    <div className="w-full shrink-0">
                      {examples.map((ex) => (
                        <div
                          key={ex.labelKey}
                          className="group/video mx-auto w-full max-w-[560px] overflow-hidden rounded-[22px] border border-surface-border bg-surface-card shadow-sm"
                        >
                          <div className="relative h-[190px] overflow-hidden p-4">
                            {/* 默认：左右双图对比 */}
                            <div className="flex items-center gap-4 transition-all duration-500 ease-out group-hover/video:-translate-y-2 group-hover/video:scale-[0.94] group-hover/video:opacity-0">
                              <div className="flex-1 text-center">
                                <img
                                  src={ex.before}
                                  alt={t("image.edit.before")}
                                  className="h-36 w-full rounded-2xl object-cover bg-surface-elevated"
                                />
                                <div className="mt-2 text-xs font-medium text-text-tertiary">{t("image.edit.before")}</div>
                              </div>
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-[0_8px_18px_var(--brand-shadow)]">
                                <ArrowRight className="h-5 w-5" />
                              </div>
                              <div className="flex-1 text-center">
                                <div className={cn(
                                  "flex h-36 w-full items-center justify-center rounded-2xl overflow-hidden",
                                  isRemoveBgMode
                                    ? "bg-[linear-gradient(45deg,#f0f0f0_25%,transparent_25%,transparent_75%,#f0f0f0_75%),linear-gradient(45deg,#f0f0f0_25%,transparent_25%,transparent_75%,#f0f0f0_75%)] bg-[length:16px_16px] bg-[position:0_0,8px_8px] dark:bg-surface-elevated"
                                    : "bg-surface-elevated"
                                )}>
                                  <img
                                    src={ex.after}
                                    alt={t("image.edit.after")}
                                    className="h-full w-full rounded-2xl object-cover"
                                  />
                                </div>
                                <div className="mt-2 text-xs font-medium text-brand">{t(config.afterLabelKey)}</div>
                              </div>
                            </div>
                            {/* 悬浮：BeforeAfterSlider */}
                            <div className="pointer-events-none absolute inset-5 translate-y-4 scale-[0.98] overflow-hidden rounded-2xl border border-surface-border bg-surface-card opacity-0 shadow-[0_18px_42px_rgba(80,64,120,0.16)] transition-all duration-500 ease-out group-hover/video:translate-y-0 group-hover/video:scale-100 group-hover/video:opacity-100 group-hover/video:pointer-events-auto">
                              <BeforeAfterSlider
                                beforeImage={ex.before}
                                afterImage={ex.after}
                                beforeLabel={t("image.edit.before")}
                                afterLabel={t(config.afterLabelKey)}
                                className="h-full [&>*:first-child]:!aspect-auto [&>*:first-child]:!h-full border-0 rounded-none"
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-between border-t border-surface-border/70 bg-surface-card/70 px-5 py-3">
                            <span className="text-sm font-medium text-text-secondary">{t(ex.labelKey)}</span>
                            <button
                              onClick={() => useExample(ex.before)}
                              className="flex items-center gap-1.5 rounded-full border border-[color:var(--brand-border)] bg-brand-muted px-4 py-1.5 text-xs font-medium text-brand transition-all duration-200 hover:bg-[var(--brand-soft-hover)]"
                            >
                              <Wand2 className="h-3.5 w-3.5" />
                              {t("image.edit.tryExample")}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                    </>
                  ) : (
                    <>
                      <div className={totalFrameClass}>
                        {isEditing ? (
                          <div className={cn(imageSlotClass, "flex-col gap-5 bg-brand-muted px-10 py-16")}>
                            <Spinner className="h-12 w-12 animate-spin text-brand" />
                            <div className="text-center">
                              <p className="text-base font-semibold text-text-primary">{t("image.edit.processing")}</p>
                            </div>
                          </div>
                        ) : (
                          isMaskMode ? (
                            <MaskBrushEditor ref={maskEditorRef} embedded imageUrl={sourceUrl} disabled={isEditing || isRecognizingRegion} t={t} onMaskChange={resetRegionRecognition} recognized={requiresRegionRecognition && regionStep === "recognized"} recognizedLabel={recognizedObject?.label ? `${t("image.edit.selectedObject")}: ${recognizedObject.label}` : undefined} />
                          ) : isTextRemovalMode && textDetectionDone && textRegions.length > 0 ? (
                            <div className={cn(imageSlotClass, "p-3 bg-surface-card")}>
                              <div className="relative inline-flex max-w-full max-h-full">
                                <img
                                  ref={textOverlayImgRef}
                                  src={sourceUrl}
                                  alt={t("image.edit.sourceImage")}
                                  className="max-h-full max-w-full rounded-lg object-contain"
                                  onLoad={() => {
                                    const img = textOverlayImgRef.current;
                                    if (img) setTextOverlayScale(img.clientWidth / (img.naturalWidth || img.width || 1));
                                  }}
                                />
                                {textRegions.map((region, i) => {
                                  const selected = selectedTextIndices.has(i);
                                  const [rx1, ry1, rx2, ry2] = region.bbox;
                                  const s = textOverlayScale;
                                  return (
                                    <button
                                      key={i}
                                      type="button"
                                      onClick={() => {
                                        const next = new Set(selectedTextIndices);
                                        if (next.has(i)) next.delete(i);
                                        else next.add(i);
                                        setSelectedTextIndices(next);
                                      }}
                                      className={cn(
                                        "absolute border-2 rounded transition-all cursor-pointer",
                                        selected ? "border-red-500 bg-red-500/20" : "border-gray-400/60 bg-gray-400/10 hover:border-gray-500"
                                      )}
                                      style={{
                                        left: `${rx1 * s}px`,
                                        top: `${ry1 * s}px`,
                                        width: `${(rx2 - rx1) * s}px`,
                                        height: `${(ry2 - ry1) * s}px`,
                                      }}
                                      title={region.text || `区域 ${i + 1}`}
                                    >
                                      {region.text && (
                                        <span className="absolute -top-5 left-0 text-[10px] px-1 rounded bg-red-500 text-white whitespace-nowrap pointer-events-none">{region.text}</span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            <div className={cn(imageSlotClass, "p-3 bg-surface-card")}>
                              <img src={sourceUrl} alt={t("image.edit.sourceImage")} className="h-full max-h-full max-w-full rounded-lg object-contain" />
                            </div>
                          )
                        )}
                      </div>

                      {!isEditing && renderPrecisionModeSelector()}

                      {isTextRemovalMode && !isEditing && (
                        <div className="w-full max-w-2xl rounded-xl border border-surface-border bg-surface-card p-4 shadow-sm">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="text-sm font-semibold text-text-primary">文字检测</p>
                              <p className="mt-1 text-xs text-text-tertiary">
                                {textDetectionDone
                                  ? (textRegions.length > 0 ? `检测到 ${textRegions.length} 处文字，已选 ${selectedTextIndices.size} 处。点击框可切换。` : textDetectionNote || "未识别到稳定文字区域。")
                                  : "点击下方按钮检测图片中的文字区域，可选择要删除的文字。"}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {textDetectionDone && textRegions.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (selectedTextIndices.size === textRegions.length) {
                                      setSelectedTextIndices(new Set());
                                    } else {
                                      setSelectedTextIndices(new Set(textRegions.map((_, i) => i)));
                                    }
                                  }}
                                  className="flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface-elevated px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
                                >
                                  {selectedTextIndices.size === textRegions.length ? "取消全选" : "全选"}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={handleDetectText}
                                disabled={isDetectingText}
                                className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-hover disabled:opacity-50"
                              >
                                {isDetectingText ? <Spinner className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                                {isDetectingText ? "检测中..." : textDetectionDone ? "重新检测" : "检测文字"}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {requiresRegionRecognition && !isEditing && (
                        <div className="w-full max-w-2xl rounded-xl border border-surface-border bg-surface-card p-4 shadow-sm">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="text-sm font-semibold text-text-primary">
                                {regionStep === "recognized"
                                  ? t(editMode === "inpaint" ? "image.edit.inpaintStepRecognizedTitle" : "image.edit.regionStepRecognizedTitle")
                                  : t(editMode === "inpaint" ? "image.edit.inpaintStepPaintTitle" : "image.edit.regionStepPaintTitle")}
                              </p>
                              <p className="mt-1 text-xs text-text-tertiary">
                                {regionStep === "recognized"
                                  ? t(editMode === "inpaint" ? "image.edit.inpaintStepRecognizedDesc" : "image.edit.regionStepRecognizedDesc")
                                  : t(editMode === "inpaint" ? "image.edit.inpaintStepPaintDesc" : "image.edit.regionStepPaintDesc")}
                              </p>
                              {regionStep === "recognized" && recognizedObject?.description && (
                                <p className="mt-2 rounded-lg bg-brand-muted px-3 py-2 text-xs font-medium text-brand">
                                  {recognizedObject.description}
                                </p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={handleRecognizeRegion}
                              disabled={regionStep === "recognized" || isRecognizingRegion}
                              className={cn(
                                "flex shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all",
                                regionStep === "recognized"
                                  ? "border border-[color:var(--brand-border)] bg-brand-muted text-brand"
                                  : "bg-brand text-white shadow-sm hover:bg-brand-hover"
                              )}
                            >
                              {isRecognizingRegion ? <Spinner className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                              {isRecognizingRegion ? t("image.edit.recognizingRegion") : regionStep === "recognized" ? (recognizedObject?.label ? `${t("image.edit.regionRecognized")}: ${recognizedObject.label}` : t("image.edit.regionRecognized")) : t("image.edit.recognizeRegion")}
                            </button>
                          </div>
                        </div>
                      )}

                      {needsPrompt && (
                        <div className="w-full max-w-lg rounded-xl border border-surface-border bg-surface-card p-4 shadow-sm">
                          <label className="mb-2 block text-xs font-medium text-text-secondary">
                            {config.promptLabelKey ? t(config.promptLabelKey) : ""}
                          </label>
                          <textarea
                            value={replacePrompt}
                            onChange={(e) => setReplacePrompt(e.target.value)}
                            placeholder={config.promptPlaceholderKey ? t(config.promptPlaceholderKey) : ""}
                            disabled={isEditing}
                            className="h-20 w-full resize-none rounded-lg border border-surface-border bg-surface-elevated p-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-focus)]"
                          />
                        </div>
                      )}

                      {!isEditing && (
                        <div className="flex items-center justify-center gap-3">
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={handleFileSelect}
                          />
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-card px-6 py-2.5 text-sm font-medium text-text-secondary shadow-sm transition-all hover:text-text-primary"
                          >
                            <Upload className="h-4 w-4" />
                            {t("image.edit.reupload")}
                          </button>
                          <button
                            onClick={handleEdit}
                            disabled={submitDisabled}
                            className={cn(
                              "flex items-center gap-2 rounded-lg bg-brand px-8 py-2.5 text-sm font-semibold text-white shadow-sm transition-all",
                              submitDisabled
                                ? "opacity-50 cursor-not-allowed"
                                : "hover:bg-brand-hover"
                            )}
                          >
                            <Sparkles className="h-4 w-4" />
                            {t(config.buttonKey)}
                          </button>
                        </div>
                      )}
                    </>
                  )}

                </div>
              ) : (
                /* 结果展示 */
                <div className="mx-auto w-full max-w-[1280px] space-y-6 py-8">
                  <div className="overflow-hidden rounded-2xl border border-surface-border bg-surface-card p-3 shadow-sm">
                    <BeforeAfterSlider
                      beforeImage={sourceUrl}
                      afterImage={result}
                      beforeLabel={t("image.edit.original")}
                      afterLabel={t(config.resultKey)}
                      className="h-[clamp(560px,72vh,760px)] [&>*:first-child]:!aspect-auto [&>*:first-child]:!h-full"
                    />
                  </div>
                  <div className="flex items-center justify-center gap-3">
                    <button
                      onClick={handleDownload}
                      className="flex items-center gap-2 rounded-lg bg-brand px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-hover"
                    >
                      <Download className="h-4 w-4" />
                      {t("image.edit.downloadImage")}
                    </button>
                    <button
                      onClick={handleReset}
                      className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-card px-6 py-2.5 text-sm font-medium text-text-secondary shadow-sm transition-all hover:text-text-primary"
                    >
                      <RotateCcw className="h-4 w-4" />
                      {t("image.edit.reupload")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

