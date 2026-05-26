"use client";

import { useState, useRef, useEffect, useCallback, Suspense, useMemo } from "react";
import { Upload, Loader2 as Spinner, Sparkles, Eraser, Download, RotateCcw, ArrowRight, Wand2, Type, ZoomIn, ImagePlus, History, Trash2, Loader, RefreshCw, AlertCircle, Clock, Image as ImageIcon, Plus } from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useImage } from "@/hooks/useImage";
import { toast } from "sonner";
import BeforeAfterSlider from "@/components/ui/BeforeAfterSlider";
import { resolveImageUrl } from "@/lib/resolveImageUrl";
import CreationHistoryPanel, { type CreationHistoryItem } from "@/components/creative/CreationHistoryPanel";

const API_BASE_URL = "";

type EditMode = "remove-bg" | "replace-bg" | "text-removal" | "upscale";

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
    promptPlaceholderKey: "image.edit.prompt.textRemovalPlaceholder",
    promptLabelKey: "image.edit.prompt.textRemovalLabel",
    examples: [
      { before: "/examples/text-removal-before.png", after: "/examples/text-removal-after.png", labelKey: "image.edit.example.watermark" },
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

const MODE_ORDER: EditMode[] = ["remove-bg", "replace-bg", "text-removal", "upscale"];

function getUserFacingEditError(error: unknown, t: (key: string) => string) {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const message = raw.trim();
  if (!message) return t("image.edit.error.default");
  if (/上传图片失败|请选择图片文件|读取图片失败|请先上传或选择图片|请描述新背景|请描述要去除/.test(message)) {
    return message;
  }
  if (/timeout|timed?\s*out|deadline|超时/i.test(message)) {
    return t("image.edit.error.timeout");
  }
  if (/insufficient|quota|credit|balance|额度|积分|余额/i.test(message)) {
    return t("image.edit.error.quota");
  }
  if (/network|fetch|Failed to fetch|ECONN|连接|网络/i.test(message)) {
    return t("image.edit.error.network");
  }
  if (/rate.?limit|too many requests|429|频率|限流/i.test(message)) {
    return t("image.edit.error.rateLimit");
  }
  if (message.length > 80 || /^[\[{]/.test(message) || /\b(error|exception|stack|trace|provider|openai|api|json)\b/i.test(message)) {
    return t("image.edit.error.default");
  }
  return message;
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

function ImageEditContent() {
  const { t } = useI18n();
  const { images, deleteImage, upsertImage, startPolling } = useImage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editMode = useMemo(() => {
    const mode = searchParams.get("mode") as EditMode | null;
    return mode && MODE_ORDER.includes(mode) ? mode : "remove-bg";
  }, [searchParams]);
  const initialImageUrl = searchParams.get("image") || "";
  const [sourceUrl, setSourceUrl] = useState(initialImageUrl);
  const [replacePrompt, setReplacePrompt] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [hoveredMode, setHoveredMode] = useState<EditMode | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deletingIds, setDeletingIds] = useState<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const config = MODE_CONFIG[editMode];
  const isRemoveBgMode = editMode === "remove-bg";

  useEffect(() => {
    const image = searchParams.get("image") || "";
    setSourceUrl(image);
    setResult(null);
  }, [searchParams]);

  const switchMode = (mode: EditMode) => {
    setResult(null);
    setReplacePrompt("");
    const params = new URLSearchParams({ mode });
    if (sourceUrl) params.set("image", sourceUrl);
    router.replace(`/image/edit?${params.toString()}`, { scroll: false });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("image.edit.error.selectImageFile"));
      return;
    }
    try {
      const reader = new FileReader();
      reader.onload = () => {
        setSourceUrl(reader.result as string);
        setResult(null);
        toast.success(t("image.edit.toast.imageSelected"));
      };
      reader.onerror = () => toast.error(t("image.edit.error.readImageFailed"));
      reader.readAsDataURL(file);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("image.edit.error.readImageFailed"));
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

  const handleEdit = async () => {
    if (!sourceUrl) {
      toast.error(t("image.edit.error.uploadFirst"));
      return;
    }
    if ((editMode === "replace-bg" || editMode === "text-removal") && !replacePrompt.trim()) {
      toast.error(editMode === "replace-bg" ? t("image.edit.error.describeBg") : t("image.edit.error.describeText"));
      return;
    }
    setIsEditing(true);
    setResult(null);
    const token = localStorage.getItem("token");
    try {
      const base64Resp = await fetch(sourceUrl);
      const imageBlob = await base64Resp.blob();
      const formData = new FormData();
      formData.append("file", imageBlob, "edit-image.png");

      const uploadResp = await fetch(`${API_BASE_URL}/api/files/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!uploadResp.ok) {
        const uploadErr = await uploadResp.json().catch(() => ({}));
        throw new Error(uploadErr.error || t("image.edit.error.uploadFailed"));
      }
      const uploadData = await uploadResp.json();

      const body: Record<string, any> = {
        image_url: uploadData.public_id,
        edit_mode: editMode,
      };
      if (editMode === "replace-bg") body.prompt = replacePrompt.trim();
      if (editMode === "text-removal") body.prompt = replacePrompt.trim();

      const res = await fetch(`${API_BASE_URL}/api/images/edit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || t("image.edit.error.editFailed"));
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

  const handleDownload = async () => {
    if (!result) return;
    try {
      const response = await fetch(result);
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      const suffix = editMode === "upscale" ? "hd" : editMode === "text-removal" ? "clean" : "edit";
      link.download = `aispace-${suffix}-${Date.now()}.png`;
      link.click();
      toast.success(t("image.downloadStarted"));
    } catch {
      toast.error(t("image.downloadFailed"));
    }
  };

  const handleReset = () => {
    setSourceUrl("");
    setReplacePrompt("");
    setResult(null);
  };

  const useExample = (before: string) => {
    setSourceUrl(before);
    setResult(null);
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
  const needsPrompt = editMode === "replace-bg" || editMode === "text-removal";

  // 选择 TabIcon
  const TabIcon = config.tabIcon;

  return (
    <>
      {/* 顶部栏：历史按钮（对所有 editMode 共用） */}
      <header className="shrink-0 h-12 flex items-center justify-end px-4 border-b border-surface-border bg-surface relative z-10">
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
        onDelete={(id) => handleDelete(id)}
        emptyText={t("image.historyEmpty")}
      />

      {editMode === "remove-bg" ? (
        <div className="flex h-full flex-col bg-surface-elevated text-text-primary dark:bg-surface">
          <div className="flex-1 overflow-auto px-6 py-6 pb-10 md:px-10 md:py-8 md:pb-12">
            <div className="mx-auto flex h-full max-w-6xl flex-col">
              {!result ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-6">
                  {/* 上传区 - 大白框（黄框区域）内部虚线上传触发区 */}
                  {!sourceUrl ? (
                    <div className="flex flex-1 flex-col items-center justify-center w-full">
                      <div
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className="group mx-auto flex w-full h-full max-h-[70vh] min-h-[400px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition-all duration-200 hover:border-purple-300 dark:border-surface-border dark:bg-surface-card"
                      >
                        <div
                          className={cn(
                            "flex w-full flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-transparent py-20 text-center transition-all duration-200 hover:border-purple-400 hover:bg-purple-50/50 dark:border-gray-600 dark:hover:border-purple-500 dark:hover:bg-purple-500/5",
                            dragOver && "border-purple-500 bg-purple-50/50 dark:border-purple-400 dark:bg-purple-500/5"
                          )}
                        >
                          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-purple-50 dark:bg-purple-500/10">
                            <ImagePlus className="h-8 w-8 text-purple-500 dark:text-purple-400" />
                          </div>
                          <p className="text-base font-medium text-gray-800 dark:text-text-primary">
                            {t("image.edit.uploadHint")}
                          </p>
                          <p className="mt-2 text-xs text-gray-500 dark:text-text-tertiary">
                            {t("image.edit.creditCostPrefix")} <span className="text-purple-500 font-medium">3</span> {t("image.edit.creditCostSuffix")}
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
                  ) : (
                    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-8 w-full">
                      {isEditing ? (
                        <div className="flex h-full max-h-[70vh] min-h-[400px] w-full flex-col items-center justify-center gap-5 rounded-2xl border border-gray-200 bg-white px-10 py-16 dark:border-surface-border dark:bg-surface-card">
                          <Spinner className="h-12 w-12 animate-spin text-purple-500" />
                          <div className="text-center">
                            <p className="text-base font-semibold text-gray-800 dark:text-text-primary">{t("image.edit.processing")}</p>
                            <p className="mt-1 text-sm text-gray-400 dark:text-text-tertiary">{t("image.edit.processingRemoveBg")}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex min-h-[400px] w-full items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-surface-border dark:bg-surface-card">
                          <img
                            src={sourceUrl}
                            alt={t("image.edit.sourceImage")}
                            className="max-h-[50vh] rounded-xl object-contain"
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
                            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-6 py-2.5 text-sm font-medium text-gray-600 shadow-sm transition-all hover:text-gray-900 dark:border-surface-border dark:bg-surface-card dark:text-text-secondary dark:hover:text-text-primary"
                          >
                            <Upload className="h-4 w-4" />
                            {t("image.edit.reupload")}
                          </button>
                          <button
                            onClick={handleEdit}
                            className="flex items-center gap-2 rounded-lg bg-purple-500 px-8 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-purple-600 dark:bg-purple-600 dark:hover:bg-purple-500"
                          >
                            <Sparkles className="h-4 w-4" />
                            {t("common.confirm")}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 底部示例区 - 在白框外部 */}
                  {!sourceUrl && !isEditing && (
                    <div className="w-full shrink-0">
                      <div className="group/video mx-auto w-full max-w-[560px] overflow-hidden rounded-[22px] border border-gray-200 bg-white shadow-sm dark:border-surface-border dark:bg-surface-card">
                        {/* 图片区域 */}
                        <div className="relative h-[210px] overflow-hidden p-5">
                          {/* 默认：左右双图对比 */}
                          <div className="flex items-center gap-4 transition-all duration-500 ease-out group-hover/video:-translate-y-2 group-hover/video:scale-[0.94] group-hover/video:opacity-0">
                            <div className="flex-1 text-center">
                              <img
                                src={examples[0].before}
                                alt={t("image.edit.before")}
                                className="h-40 w-full rounded-2xl object-cover bg-surface-elevated"
                              />
                              <div className="mt-2 text-xs font-medium text-text-tertiary">{t("image.edit.before")}</div>
                            </div>
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-500 text-white shadow-[0_8px_18px_rgba(59,130,246,0.22)]">
                              <ArrowRight className="h-5 w-5" />
                            </div>
                            <div className="flex-1 text-center">
                              <div className="flex h-40 w-full items-center justify-center overflow-hidden rounded-2xl bg-[linear-gradient(45deg,#f0f0f0_25%,transparent_25%,transparent_75%,#f0f0f0_75%),linear-gradient(45deg,#f0f0f0_25%,transparent_25%,transparent_75%,#f0f0f0_75%)] bg-[length:16px_16px] bg-[position:0_0,8px_8px] dark:bg-surface-elevated">
                                <img
                                  src={examples[0].after}
                                  alt={t("image.edit.after")}
                                  className="h-full w-full rounded-2xl object-cover"
                                />
                              </div>
                              <div className="mt-2 text-xs font-medium text-purple-500">{t("image.edit.after.removeBg")}</div>
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
                            className="flex items-center gap-1.5 rounded-full border border-purple-500/20 bg-purple-50 px-4 py-1.5 text-xs font-medium text-purple-600 transition-all duration-200 hover:border-purple-500/30 hover:bg-purple-100 dark:border-purple-500/20 dark:bg-purple-500/10 dark:text-purple-400 dark:hover:bg-purple-500/15"
                          >
                            <Wand2 className="h-3.5 w-3.5" />
                            {t("image.edit.tryExample")}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* 结果展示 */
                <div className="mx-auto w-full max-w-5xl space-y-6 py-8">
                  <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-surface-border dark:bg-surface-card">
                    <BeforeAfterSlider
                      beforeImage={sourceUrl}
                      afterImage={result}
                      beforeLabel={t("image.edit.original")}
                      afterLabel={t(config.resultKey)}
                      className="max-h-[55vh]"
                    />
                  </div>
                  <div className="flex items-center justify-center gap-3">
                    <button
                      onClick={handleDownload}
                      className="flex items-center gap-2 rounded-lg bg-purple-500 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-purple-600 dark:bg-purple-600 dark:hover:bg-purple-500"
                    >
                      <Download className="h-4 w-4" />
                      {t("image.edit.downloadImage")}
                    </button>
                    <button
                      onClick={handleReset}
                      className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-6 py-2.5 text-sm font-medium text-gray-600 shadow-sm transition-all hover:text-gray-900 dark:border-surface-border dark:bg-surface-card dark:text-text-secondary dark:hover:text-text-primary"
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
            <div className="mx-auto flex h-full max-w-6xl flex-col">
              {!result ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-6">
                  {/* 上传区 */}
                  {!sourceUrl ? (
                    <div className="flex flex-1 flex-col items-center justify-center w-full">
                      <div
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className="group mx-auto flex w-full h-full max-h-[70vh] min-h-[400px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition-all duration-200 hover:border-purple-300 dark:border-surface-border dark:bg-surface-card"
                      >
                        <div
                          className={cn(
                            "flex w-full flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-transparent py-20 text-center transition-all duration-200 hover:border-purple-400 hover:bg-purple-50/50 dark:border-gray-600 dark:hover:border-purple-500 dark:hover:bg-purple-500/5",
                            dragOver && "border-purple-500 bg-purple-50/50 dark:border-purple-400 dark:bg-purple-500/5"
                          )}
                        >
                          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-purple-50 dark:bg-purple-500/10">
                            <TabIcon className="h-8 w-8 text-purple-500 dark:text-purple-400" />
                          </div>
                          <p className="text-base font-medium text-gray-800 dark:text-text-primary">
                            {t("image.edit.uploadHint")}
                          </p>
                          <p className="mt-2 text-xs text-gray-500 dark:text-text-tertiary">
                            {t("image.edit.supportedFormats")}
                          </p>
                          <div className="mt-4 flex items-center gap-3">
                            <span className="text-xs text-text-tertiary">{t("common.or")}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                useExample(examples[0].before);
                              }}
                              className="flex items-center gap-1.5 rounded-full border border-purple-500/20 bg-purple-50 px-4 py-1.5 text-xs font-medium text-purple-600 transition-all duration-200 hover:bg-purple-100 dark:border-purple-500/20 dark:bg-purple-500/10 dark:text-purple-400"
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
                  ) : (
                    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-8 w-full">
                      {isEditing ? (
                        <div className="flex h-full max-h-[70vh] min-h-[400px] w-full flex-col items-center justify-center gap-5 rounded-2xl border border-gray-200 bg-gradient-to-br from-purple-500/5 to-brand/5 px-10 py-16 dark:border-surface-border dark:bg-surface-card">
                          <Spinner className="h-12 w-12 animate-spin text-purple-500" />
                          <div className="text-center">
                            <p className="text-base font-semibold text-gray-800 dark:text-text-primary">{t("image.edit.processing")}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex min-h-[400px] w-full items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-surface-border dark:bg-surface-card">
                          <img src={sourceUrl} alt={t("image.edit.sourceImage")} className="max-h-[50vh] rounded-xl object-contain" />
                        </div>
                      )}

                      {/* prompt 输入框 */}
                      {needsPrompt && (
                        <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-surface-border dark:bg-surface-card">
                          <label className="mb-2 block text-xs font-medium text-text-secondary">
                            {config.promptLabelKey ? t(config.promptLabelKey) : ""}
                          </label>
                          <textarea
                            value={replacePrompt}
                            onChange={(e) => setReplacePrompt(e.target.value)}
                            placeholder={config.promptPlaceholderKey ? t(config.promptPlaceholderKey) : ""}
                            disabled={isEditing}
                            className="h-20 w-full resize-none rounded-lg border border-surface-border bg-surface-elevated p-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-purple-500/20"
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
                            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-6 py-2.5 text-sm font-medium text-gray-600 shadow-sm transition-all hover:text-gray-900 dark:border-surface-border dark:bg-surface-card dark:text-text-secondary dark:hover:text-text-primary"
                          >
                            <Upload className="h-4 w-4" />
                            {t("image.edit.reupload")}
                          </button>
                          <button
                            onClick={handleEdit}
                            disabled={needsPrompt && !replacePrompt.trim()}
                            className={cn(
                              "flex items-center gap-2 rounded-lg bg-purple-500 px-8 py-2.5 text-sm font-semibold text-white shadow-sm transition-all",
                              needsPrompt && !replacePrompt.trim()
                                ? "opacity-50 cursor-not-allowed"
                                : "hover:bg-purple-600 dark:bg-purple-600 dark:hover:bg-purple-500"
                            )}
                          >
                            <Sparkles className="h-4 w-4" />
                            {t(config.buttonKey)}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 底部示例区 */}
                  {!sourceUrl && !isEditing && (
                    <div className="w-full shrink-0">
                      {examples.map((ex) => (
                        <div
                          key={ex.labelKey}
                          className="group/video mx-auto w-full max-w-[560px] overflow-hidden rounded-[22px] border border-gray-200 bg-white shadow-sm dark:border-surface-border dark:bg-surface-card"
                        >
                          <div className="relative h-[210px] overflow-hidden p-5">
                            {/* 默认：左右双图对比 */}
                            <div className="flex items-center gap-4 transition-all duration-500 ease-out group-hover/video:-translate-y-2 group-hover/video:scale-[0.94] group-hover/video:opacity-0">
                              <div className="flex-1 text-center">
                                <img
                                  src={ex.before}
                                  alt={t("image.edit.before")}
                                  className="h-40 w-full rounded-2xl object-cover bg-surface-elevated"
                                />
                                <div className="mt-2 text-xs font-medium text-text-tertiary">{t("image.edit.before")}</div>
                              </div>
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-500 text-white shadow-[0_8px_18px_rgba(59,130,246,0.22)]">
                                <ArrowRight className="h-5 w-5" />
                              </div>
                              <div className="flex-1 text-center">
                                <div className={cn(
                                  "flex h-40 w-full items-center justify-center rounded-2xl overflow-hidden",
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
                                <div className="mt-2 text-xs font-medium text-purple-500">{t(config.afterLabelKey)}</div>
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
                              className="flex items-center gap-1.5 rounded-full border border-purple-500/20 bg-purple-50 px-4 py-1.5 text-xs font-medium text-purple-600 transition-all duration-200 hover:bg-purple-100 dark:border-purple-500/20 dark:bg-purple-500/10 dark:text-purple-400"
                            >
                              <Wand2 className="h-3.5 w-3.5" />
                              {t("image.edit.tryExample")}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* 结果展示 */
                <div className="mx-auto w-full max-w-5xl space-y-6 py-8">
                  <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-surface-border dark:bg-surface-card">
                    <BeforeAfterSlider
                      beforeImage={sourceUrl}
                      afterImage={result}
                      beforeLabel={t("image.edit.original")}
                      afterLabel={t(config.resultKey)}
                      className="max-h-[55vh]"
                    />
                  </div>
                  <div className="flex items-center justify-center gap-3">
                    <button
                      onClick={handleDownload}
                      className="flex items-center gap-2 rounded-lg bg-purple-500 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-purple-600 dark:bg-purple-600 dark:hover:bg-purple-500"
                    >
                      <Download className="h-4 w-4" />
                      {t("image.edit.downloadImage")}
                    </button>
                    <button
                      onClick={handleReset}
                      className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-6 py-2.5 text-sm font-medium text-gray-600 shadow-sm transition-all hover:text-gray-900 dark:border-surface-border dark:bg-surface-card dark:text-text-secondary dark:hover:text-text-primary"
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
