"use client";

import { useState, useRef, useEffect, useCallback, Suspense, useMemo } from "react";
import { Upload, Loader2 as Spinner, Sparkles, Eraser, Download, RotateCcw, ArrowRight, Wand2, Type, ZoomIn, ImagePlus, History, Trash2, Loader, RefreshCw, AlertCircle, Clock, Image as ImageIcon, Plus } from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useImage } from "@/hooks/useImage";
import { toast } from "sonner";
import BeforeAfterSlider from "@/components/ui/BeforeAfterSlider";
import { resolveImageUrl } from "@/lib/resolveImageUrl";

const API_BASE_URL = "";

type EditMode = "remove-bg" | "replace-bg" | "text-removal" | "upscale";

/* 示例：展示原图 vs 处理后效果 */
const MODE_CONFIG = {
  "remove-bg": {
    title: "AI Background Removal",
    subtitle: "Remove image backgrounds instantly with AI",
    tabLabel: "移除背景",
    tabIcon: Eraser,
    uploadHint: "点击或拖动图片至此处",
    exampleTitle: "效果预览",
    exampleSubtitle: "原图 → AI 移除背景",
    afterLabel: "去背后",
    buttonLabel: "移除背景",
    resultLabel: "已移除",
    toastSuccess: "背景已移除",
    category: "remove-bg",
    promptPlaceholder: "",
    promptLabel: "",
    examples: [
      { before: "/examples/remove-bg-before.png", after: "/examples/remove-bg-after.png", label: "人像" },
    ],
  },
  "replace-bg": {
    title: "AI Background Replacement",
    subtitle: "Replace image backgrounds with AI-generated scenes",
    tabLabel: "替换背景",
    tabIcon: Sparkles,
    uploadHint: "点击或拖动图片至此处",
    exampleTitle: "效果预览",
    exampleSubtitle: "原图 → AI 替换背景",
    afterLabel: "替换后",
    buttonLabel: "替换背景",
    resultLabel: "已替换",
    toastSuccess: "背景已替换",
    category: "replace-bg",
    promptPlaceholder: "例如：一个阳光明媚的海滩，有棕榈树和蓝天",
    promptLabel: "描述新背景",
    examples: [
      { before: "/examples/replace-bg-before.png", after: "/examples/replace-bg-after.png", label: "海滩" },
    ],
  },
  "text-removal": {
    title: "AI Text Removal",
    subtitle: "Remove text, watermarks, and unwanted inscriptions from images",
    tabLabel: "文字移除",
    tabIcon: Type,
    uploadHint: "点击或拖动图片至此处",
    exampleTitle: "适用场景",
    exampleSubtitle: "水印、字幕、logo、签名等文字移除",
    afterLabel: "已移除",
    buttonLabel: "移除文字",
    resultLabel: "已移除",
    toastSuccess: "文字已移除",
    category: "text-removal",
    promptPlaceholder: "例如：去除图片左上角的水印 logo",
    promptLabel: "描述要去除的文字/水印",
    examples: [
      { before: "/examples/text-removal-before.png", after: "/examples/text-removal-after.png", label: "水印" },
    ],
  },
  "upscale": {
    title: "AI Image Upscaler",
    subtitle: "Enhance and upscale images to 4x resolution with AI",
    tabLabel: "画质提升",
    tabIcon: ZoomIn,
    uploadHint: "点击或拖动图片至此处",
    exampleTitle: "效果预览",
    exampleSubtitle: "原图 → AI 提升分辨率与清晰度",
    afterLabel: "已增强",
    buttonLabel: "开始增强",
    resultLabel: "已增强",
    toastSuccess: "画质已提升",
    category: "upscale",
    promptPlaceholder: "",
    promptLabel: "",
    examples: [
      { before: "/examples/upscale-before.png", after: "/examples/upscale-after.png", label: "人像" },
    ],
  },
} as const;

const MODE_ORDER: EditMode[] = ["remove-bg", "replace-bg", "text-removal", "upscale"];

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
  const { images, deleteImage } = useImage();
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
  const [previewImage, setPreviewImage] = useState<any>(null);
  const [deletingIds, setDeletingIds] = useState<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
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
      toast.error("请选择图片文件");
      return;
    }
    try {
      const reader = new FileReader();
      reader.onload = () => {
        setSourceUrl(reader.result as string);
        setResult(null);
        toast.success("图片已选择");
      };
      reader.onerror = () => toast.error("读取图片失败");
      reader.readAsDataURL(file);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "读取图片失败");
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
      toast.error("请先上传或选择图片");
      return;
    }
    if ((editMode === "replace-bg" || editMode === "text-removal") && !replacePrompt.trim()) {
      toast.error(editMode === "replace-bg" ? "请描述新背景" : "请描述要去除的文字/水印");
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
        throw new Error(uploadErr.error || "上传图片失败");
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
        throw new Error(err.error || "编辑失败");
      }
      const data = await res.json();
      if (data.status === "pending" && data.id) {
        toast.info("已开始处理，请稍候");
        for (let i = 0; i < 120; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          const statusResp = await fetch(`${API_BASE_URL}/api/images/${data.id}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!statusResp.ok) continue;
          const statusData = await statusResp.json();
          if (statusData.status === "completed" && statusData.image_url) {
            setResult(resolveImageUrl(statusData.image_url));
            toast.success(config.toastSuccess);
            return;
          }
          if (statusData.status === "failed") {
            throw new Error(statusData.error_message || "编辑失败");
          }
        }
        throw new Error("处理超时，请稍后到历史记录查看结果");
      }
      setResult(resolveImageUrl(data.image_url));
      toast.success(config.toastSuccess);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "编辑失败");
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
      toast.success("下载已开始");
    } catch {
      toast.error("下载失败");
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
    toast.success("已选择示例图片");
  };

  // 点击外部关闭历史面板
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    }
    if (historyOpen) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [historyOpen]);

  const handleDelete = async (id: number) => {
    setDeletingIds((prev) => [...prev, id]);
    try {
      await deleteImage(id);
      toast.success("删除成功");
    } catch {
      toast.error("删除失败");
    } finally {
      setDeletingIds((prev) => prev.filter((i) => i !== id));
    }
  };

  const examples = config.examples;
  const needsPrompt = editMode === "replace-bg" || editMode === "text-removal";

  // 选择 TabIcon
  const TabIcon = config.tabIcon;

  return (
    <>
      {/* 顶部栏：历史按钮（对所有 editMode 共用） */}
      <header className="shrink-0 h-12 flex items-center justify-end px-4 border-b border-surface-border bg-surface relative z-10">
        <div className="relative" ref={historyRef}>
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200",
              historyOpen
                ? "bg-brand/10 text-brand"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-card"
            )}
          >
            <History className="w-4 h-4" />
            <span>历史</span>
            {images.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-elevated text-text-tertiary">
                {images.length}
              </span>
            )}
          </button>

          {historyOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setHistoryOpen(false)} />
              <div className="absolute top-full right-0 mt-2 w-[360px] max-h-[70vh] overflow-auto z-50 rounded-xl border border-surface-border bg-surface-elevated shadow-2xl py-3 animate-fade-in">
                <div className="flex items-center justify-between px-4 pb-2 border-b border-surface-border">
                  <h3 className="text-sm font-semibold text-text-primary">生成历史</h3>
                  <span className="text-xs text-text-tertiary">{images.length} 张</span>
                </div>
                {images.length === 0 ? (
                  <div className="px-4 py-8 text-center text-text-tertiary text-sm">
                    还没有生成过图片
                  </div>
                ) : (
                  <div className="py-1">
                    {(() => {
                      const groups: Record<string, any[]> = {};
                      images.forEach((img: any) => {
                        const date = new Date(img.created_at).toLocaleDateString("zh-CN");
                        if (!groups[date]) groups[date] = [];
                        groups[date].push(img);
                      });
                      const sortedDates = Object.keys(groups).sort(
                        (a, b) => new Date(b).getTime() - new Date(a).getTime()
                      );
                      return sortedDates.map((date) => (
                        <div key={date}>
                          <div className="px-4 py-1.5 text-[11px] font-medium text-text-tertiary sticky top-0 bg-surface-elevated">
                            {date}
                          </div>
                          {groups[date].map((img: any) => (
                            <button
                              key={img.id}
                              onClick={() => {
                                setPreviewImage(img);
                                setHistoryOpen(false);
                              }}
                              className="w-full flex items-center gap-3 px-4 py-2 hover:bg-surface-card transition-colors text-left group"
                            >
                              <div className="w-10 h-10 rounded-lg bg-surface overflow-hidden shrink-0 border border-surface-border">
                                {img.status === "pending" ? (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Spinner className="w-4 h-4 animate-spin text-brand/40" />
                                  </div>
                                ) : img.status === "failed" ? (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <AlertCircle className="w-4 h-4 text-yellow-500/50" />
                                  </div>
                                ) : (
                                  <img
                                    src={resolveImageUrl(img.image_url)}
                                    alt=""
                                    className="w-full h-full object-cover"
                                  />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-text-primary truncate">{img.prompt}</p>
                                <p className="text-[11px] text-text-tertiary">
                                  {new Date(img.created_at).toLocaleTimeString("zh-CN", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                  {img.size && ` · ${img.size}`}
                                </p>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(img.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-red-500/10 text-text-tertiary hover:text-red-500 transition-all"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </button>
                          ))}
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {editMode === "remove-bg" ? (
        <div className="flex h-full flex-col bg-surface-elevated text-text-primary dark:bg-surface">
          <div className="flex-1 overflow-auto px-6 py-6 md:px-10 md:py-8">
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
                            单击或拖动图片至此处
                          </p>
                          <p className="mt-2 text-xs text-gray-500 dark:text-text-tertiary">
                            每次使用扣除 <span className="text-purple-500 font-medium">3</span> 高级积分
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
                            <p className="text-base font-semibold text-gray-800 dark:text-text-primary">AI 正在处理</p>
                            <p className="mt-1 text-sm text-gray-400 dark:text-text-tertiary">正在移除背景，请稍候...</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex min-h-[400px] w-full items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-surface-border dark:bg-surface-card">
                          <img
                            src={sourceUrl}
                            alt="源图"
                            className="max-h-[60vh] rounded-xl object-contain"
                          />
                        </div>
                      )}
                      {!isEditing && (
                        <button
                          onClick={handleEdit}
                          className="flex items-center gap-2 rounded-lg bg-purple-500 px-8 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-purple-600 dark:bg-purple-600 dark:hover:bg-purple-500"
                        >
                          <Sparkles className="h-4 w-4" />
                          确认
                        </button>
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
                                alt="原图"
                                className="h-40 w-full rounded-2xl object-cover bg-surface-elevated"
                              />
                              <div className="mt-2 text-xs font-medium text-text-tertiary">原图</div>
                            </div>
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-500 text-white shadow-[0_8px_18px_rgba(59,130,246,0.22)]">
                              <ArrowRight className="h-5 w-5" />
                            </div>
                            <div className="flex-1 text-center">
                              <div className="flex h-40 w-full items-center justify-center overflow-hidden rounded-2xl bg-[linear-gradient(45deg,#f0f0f0_25%,transparent_25%,transparent_75%,#f0f0f0_75%),linear-gradient(45deg,#f0f0f0_25%,transparent_25%,transparent_75%,#f0f0f0_75%)] bg-[length:16px_16px] bg-[position:0_0,8px_8px] dark:bg-surface-elevated">
                                <img
                                  src={examples[0].after}
                                  alt="处理后"
                                  className="h-full w-full rounded-2xl object-cover"
                                />
                              </div>
                              <div className="mt-2 text-xs font-medium text-purple-500">去背后</div>
                            </div>
                          </div>
                          {/* 悬浮：BeforeAfterSlider */}
                          <div className="pointer-events-none absolute inset-5 translate-y-4 scale-[0.98] overflow-hidden rounded-2xl border border-surface-border bg-surface-card opacity-0 shadow-[0_18px_42px_rgba(80,64,120,0.16)] transition-all duration-500 ease-out group-hover/video:translate-y-0 group-hover/video:scale-100 group-hover/video:opacity-100 group-hover/video:pointer-events-auto">
                            <BeforeAfterSlider
                              beforeImage={examples[0].before}
                              afterImage={examples[0].after}
                              beforeLabel="原图"
                              afterLabel="去背后"
                              className="h-full [&>*:first-child]:!aspect-auto [&>*:first-child]:!h-full border-0 rounded-none"
                            />
                          </div>
                        </div>
                        {/* 标签 + 按钮 */}
                        <div className="flex items-center justify-between border-t border-surface-border/70 bg-surface-card/70 px-5 py-3">
                          <span className="text-sm font-medium text-text-secondary">{examples[0].label}</span>
                          <button
                            onClick={() => useExample(examples[0].before)}
                            className="flex items-center gap-1.5 rounded-full border border-purple-500/20 bg-purple-50 px-4 py-1.5 text-xs font-medium text-purple-600 transition-all duration-200 hover:border-purple-500/30 hover:bg-purple-100 dark:border-purple-500/20 dark:bg-purple-500/10 dark:text-purple-400 dark:hover:bg-purple-500/15"
                          >
                            <Wand2 className="h-3.5 w-3.5" />
                            试用示例图片
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
                      beforeLabel="原始"
                      afterLabel={config.resultLabel}
                    />
                  </div>
                  <div className="flex items-center justify-center gap-3">
                    <button
                      onClick={handleDownload}
                      className="flex items-center gap-2 rounded-lg bg-purple-500 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-purple-600 dark:bg-purple-600 dark:hover:bg-purple-500"
                    >
                      <Download className="h-4 w-4" />
                      下载图片
                    </button>
                    <button
                      onClick={handleReset}
                      className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-6 py-2.5 text-sm font-medium text-gray-600 shadow-sm transition-all hover:text-gray-900 dark:border-surface-border dark:bg-surface-card dark:text-text-secondary dark:hover:text-text-primary"
                    >
                      <RotateCcw className="h-4 w-4" />
                      重新上传
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col bg-surface-elevated text-text-primary dark:bg-surface">
          <div className="flex-1 overflow-auto px-6 py-6 md:px-10 md:py-8">
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
                            单击或拖动图片至此处
                          </p>
                          <p className="mt-2 text-xs text-gray-500 dark:text-text-tertiary">
                            支持 PNG、JPG、WebP 格式，单张不超过 20MB
                          </p>
                          <div className="mt-4 flex items-center gap-3">
                            <span className="text-xs text-text-tertiary">或者</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                useExample(examples[0].before);
                              }}
                              className="flex items-center gap-1.5 rounded-full border border-purple-500/20 bg-purple-50 px-4 py-1.5 text-xs font-medium text-purple-600 transition-all duration-200 hover:bg-purple-100 dark:border-purple-500/20 dark:bg-purple-500/10 dark:text-purple-400"
                            >
                              <Wand2 className="h-3.5 w-3.5" />
                              试用示例图片
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
                            <p className="text-base font-semibold text-gray-800 dark:text-text-primary">AI 正在处理</p>
                            <p className="mt-1 text-sm text-gray-400 dark:text-text-tertiary">
                              {editMode === "upscale"
                                ? "预计用时 15～45 秒"
                                : "预计用时 5～15 秒"}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex min-h-[400px] w-full items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-surface-border dark:bg-surface-card">
                          <img src={sourceUrl} alt="源图" className="max-h-[60vh] rounded-xl object-contain" />
                        </div>
                      )}

                      {/* prompt 输入框 */}
                      {needsPrompt && (
                        <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-surface-border dark:bg-surface-card">
                          <label className="mb-2 block text-xs font-medium text-text-secondary">
                            {config.promptLabel}
                          </label>
                          <textarea
                            value={replacePrompt}
                            onChange={(e) => setReplacePrompt(e.target.value)}
                            placeholder={config.promptPlaceholder}
                            disabled={isEditing}
                            className="h-20 w-full resize-none rounded-lg border border-surface-border bg-surface-elevated p-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                          />
                        </div>
                      )}

                      {!isEditing && (
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
                          {config.buttonLabel}
                        </button>
                      )}
                    </div>
                  )}

                  {/* 底部示例区 */}
                  {!sourceUrl && !isEditing && (
                    <div className="w-full shrink-0">
                      {examples.map((ex) => (
                        <div
                          key={ex.label}
                          className="group/video mx-auto w-full max-w-[560px] overflow-hidden rounded-[22px] border border-gray-200 bg-white shadow-sm dark:border-surface-border dark:bg-surface-card"
                        >
                          <div className="relative h-[210px] overflow-hidden p-5">
                            {/* 默认：左右双图对比 */}
                            <div className="flex items-center gap-4 transition-all duration-500 ease-out group-hover/video:-translate-y-2 group-hover/video:scale-[0.94] group-hover/video:opacity-0">
                              <div className="flex-1 text-center">
                                <img
                                  src={ex.before}
                                  alt="原图"
                                  className="h-40 w-full rounded-2xl object-cover bg-surface-elevated"
                                />
                                <div className="mt-2 text-xs font-medium text-text-tertiary">原图</div>
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
                                    alt="处理后"
                                    className="h-full w-full rounded-2xl object-cover"
                                  />
                                </div>
                                <div className="mt-2 text-xs font-medium text-purple-500">{config.afterLabel}</div>
                              </div>
                            </div>
                            {/* 悬浮：BeforeAfterSlider */}
                            <div className="pointer-events-none absolute inset-5 translate-y-4 scale-[0.98] overflow-hidden rounded-2xl border border-surface-border bg-surface-card opacity-0 shadow-[0_18px_42px_rgba(80,64,120,0.16)] transition-all duration-500 ease-out group-hover/video:translate-y-0 group-hover/video:scale-100 group-hover/video:opacity-100 group-hover/video:pointer-events-auto">
                              <BeforeAfterSlider
                                beforeImage={ex.before}
                                afterImage={ex.after}
                                beforeLabel="原图"
                                afterLabel={config.afterLabel}
                                className="h-full [&>*:first-child]:!aspect-auto [&>*:first-child]:!h-full border-0 rounded-none"
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-between border-t border-surface-border/70 bg-surface-card/70 px-5 py-3">
                            <span className="text-sm font-medium text-text-secondary">{ex.label}</span>
                            <button
                              onClick={() => useExample(ex.before)}
                              className="flex items-center gap-1.5 rounded-full border border-purple-500/20 bg-purple-50 px-4 py-1.5 text-xs font-medium text-purple-600 transition-all duration-200 hover:bg-purple-100 dark:border-purple-500/20 dark:bg-purple-500/10 dark:text-purple-400"
                            >
                              <Wand2 className="h-3.5 w-3.5" />
                              试用示例图片
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
                      beforeLabel="原始"
                      afterLabel={config.resultLabel}
                    />
                  </div>
                  <div className="flex items-center justify-center gap-3">
                    <button
                      onClick={handleDownload}
                      className="flex items-center gap-2 rounded-lg bg-purple-500 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-purple-600 dark:bg-purple-600 dark:hover:bg-purple-500"
                    >
                      <Download className="h-4 w-4" />
                      下载图片
                    </button>
                    <button
                      onClick={handleReset}
                      className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-6 py-2.5 text-sm font-medium text-gray-600 shadow-sm transition-all hover:text-gray-900 dark:border-surface-border dark:bg-surface-card dark:text-text-secondary dark:hover:text-text-primary"
                    >
                      <RotateCcw className="h-4 w-4" />
                      重新上传
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
