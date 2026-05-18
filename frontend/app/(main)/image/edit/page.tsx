"use client";

import { useState, useRef, useEffect } from "react";
import { Upload, Loader2, Sparkles, Eraser, Download, RotateCcw, ArrowRight, Wand2, Type, ZoomIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import BeforeAfterSlider from "@/components/ui/BeforeAfterSlider";

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
      { before: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&h=400&fit=crop", after: "/api/images/file/8a127baef775809a2aa8dd0d0b91a977.png", label: "海滩" },
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
      { before: "https://images.unsplash.com/photo-1519751138087-5bf79df7a3e0?w=600&h=400&fit=crop", after: "/api/images/file/9816e4dd351283e59eb4490e3e08a21b.png", label: "水印" },
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
      { before: "https://images.unsplash.com/photo-1519751138087-5bf79df7a3e0?w=600&h=400&fit=crop", after: "/api/images/file/939b9499731e316f501c458c0a883ca4.png", label: "人像" },
    ],
  },
} as const;

const MODE_ORDER: EditMode[] = ["remove-bg", "replace-bg", "text-removal", "upscale"];

export default function ImageEditPage() {
  const [editMode, setEditMode] = useState<EditMode>("remove-bg");
  const [sourceUrl, setSourceUrl] = useState("");
  const [replacePrompt, setReplacePrompt] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [hoveredMode, setHoveredMode] = useState<EditMode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const config = MODE_CONFIG[editMode];

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode") as EditMode | null;
    if (mode && MODE_ORDER.includes(mode)) setEditMode(mode);
    else setEditMode("remove-bg");
  }, []);

  const switchMode = (mode: EditMode) => {
    setEditMode(mode);
    setResult(null);
    setSourceUrl("");
    setReplacePrompt("");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("mode", mode);
      window.history.replaceState({}, "", url.toString());
    }
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
      // 先上传 base64 图片到文件服务器，拿到 public_id
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

      // 用 public_id 提交编辑
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
      setResult(data.image_url);
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

  const examples = config.examples;
  const needsPrompt = editMode === "replace-bg" || editMode === "text-removal";

  // 选择 TabIcon
  const TabIcon = config.tabIcon;

  return (
    <div className="flex h-full flex-col bg-[rgb(238,234,245)] text-text-primary dark:bg-surface">
      {/* 顶部模式切换 & 标题 */}
      <header className="shrink-0 border-b border-white/60 bg-[rgb(238,234,245)] px-6 py-5 dark:border-surface-border dark:bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4">
          <div className="text-center">
            <h1 className="text-[22px] font-semibold tracking-tight text-text-primary">
              {config.title}
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              {config.subtitle}
            </p>
          </div>
          <div
            className="relative flex items-center rounded-full border border-white/70 bg-white/55 p-1 shadow-[0_8px_24px_rgba(80,64,120,0.06)] backdrop-blur dark:border-surface-border dark:bg-surface-card"
            onMouseLeave={() => setHoveredMode(null)}
          >
            {MODE_ORDER.map((mode) => {
              const Icon = MODE_CONFIG[mode].tabIcon;
              const isActive = editMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => switchMode(mode)}
                  onMouseEnter={() => setHoveredMode(mode)}
                  onMouseLeave={() => setHoveredMode(null)}
                  onFocus={() => setHoveredMode(mode)}
                  onBlur={() => setHoveredMode(null)}
                  className={cn(
                    "flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-brand text-white shadow-[0_6px_16px_rgba(59,130,246,0.22)]"
                      : "text-text-secondary hover:bg-white/70 hover:text-text-primary dark:hover:bg-surface-elevated"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {MODE_CONFIG[mode].tabLabel}
                </button>
              );
            })}

            {hoveredMode === "remove-bg" && (
              <div className="pointer-events-none absolute left-0 top-[calc(100%+14px)] z-50 w-[520px] overflow-hidden rounded-[22px] border border-white/75 bg-surface-card shadow-[0_26px_70px_rgba(80,64,120,0.18),0_6px_18px_rgba(80,64,120,0.08)] backdrop-blur animate-fade-in dark:border-surface-border">
                <div className="relative h-[235px] overflow-hidden bg-surface-elevated">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(255,255,255,0.78),transparent_34%),linear-gradient(135deg,var(--surface-card),var(--surface-elevated))] dark:bg-surface-elevated" />
                  <div className="absolute left-5 top-5 text-left">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-brand/20 bg-brand-muted px-3 py-1 text-[11px] font-medium text-brand">
                      <Sparkles className="h-3 w-3" />
                      AI 背景移除
                    </div>
                    <p className="mt-3 text-sm font-semibold text-text-primary">自动识别主体，一键去除背景</p>
                    <p className="mt-1 text-xs text-text-tertiary">悬浮预览处理前后的动态效果</p>
                  </div>

                  <div className="absolute bottom-5 left-5 right-5 h-[128px] overflow-hidden rounded-2xl border border-surface-border bg-surface-card shadow-[0_16px_34px_rgba(80,64,120,0.12)]">
                    <div className="absolute inset-y-0 left-0 w-[48%] overflow-hidden">
                      <img src="/examples/remove-bg-before.png" alt="背景移除原图" className="h-full w-full object-cover" />
                      <div className="absolute bottom-2 left-2 rounded-full bg-surface-card/90 px-2 py-0.5 text-[10px] font-medium text-text-secondary shadow-sm backdrop-blur">原图</div>
                    </div>
                    <div className="absolute inset-y-0 right-0 flex w-[58%] items-center justify-center bg-[linear-gradient(45deg,hsl(var(--surface-elevated))_25%,transparent_25%,transparent_75%,hsl(var(--surface-elevated))_75%),linear-gradient(45deg,hsl(var(--surface-elevated))_25%,transparent_25%,transparent_75%,hsl(var(--surface-elevated))_75%)] bg-[length:18px_18px] bg-[position:0_0,9px_9px]">
                      <img src="/examples/remove-bg-after.png" alt="去除背景后" className="h-[118px] w-[88%] object-contain animate-[float_2.4s_ease-in-out_infinite]" />
                      <div className="absolute bottom-2 right-2 rounded-full bg-brand px-2 py-0.5 text-[10px] font-medium text-white shadow-[0_8px_18px_rgba(59,130,246,0.24)]">去背后</div>
                    </div>
                    <div className="absolute bottom-0 top-0 left-[39%] w-[2px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.04)] animate-[gradient-shift_1.6s_ease-in-out_infinite]" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 主工作区 */}
      <div className="flex-1 overflow-auto bg-[rgb(238,234,245)] px-6 py-8 md:px-10 md:py-10 dark:bg-surface">
        <div className="mx-auto max-w-6xl space-y-8">
          {!result ? (
            <div className="space-y-8">
              {/* 中央大画布上传区 */}
              {!sourceUrl ? (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "group relative mx-auto flex min-h-[560px] w-full max-w-5xl cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[28px] border border-white/75 bg-white/86 px-8 text-center shadow-[0_24px_70px_rgba(80,64,120,0.10),0_4px_14px_rgba(80,64,120,0.05)] backdrop-blur transition-all duration-300 dark:border-surface-border dark:bg-surface-card",
                    dragOver && "scale-[1.01] border-brand/40 shadow-[0_28px_80px_rgba(59,130,246,0.16)]"
                  )}
                >
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.85),rgba(255,255,255,0)_52%)] dark:hidden" />
                  <div className="relative mb-7 flex h-32 w-32 items-center justify-center rounded-[34px] border border-brand/15 bg-brand-muted shadow-[0_18px_44px_rgba(59,130,246,0.12)] transition-transform duration-300 group-hover:-translate-y-1">
                    <TabIcon className="h-12 w-12 text-brand" />
                  </div>

                  <p className="relative text-2xl font-semibold tracking-tight text-text-primary">
                    {config.uploadHint}
                  </p>
                  <p className="relative mt-3 max-w-md text-sm text-text-tertiary">
                    支持 PNG、JPG、WebP 格式，单张不超过 20MB
                  </p>

                  <div className="relative mt-9 flex items-center gap-3">
                    <span className="text-xs text-text-tertiary">或者</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        useExample(examples[0].before);
                      }}
                      className="flex items-center gap-1.5 rounded-full border border-brand/20 bg-brand-muted px-5 py-2 text-xs font-medium text-brand transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:bg-brand/15"
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
              ) : (
                <div className="mx-auto max-w-5xl space-y-5">
                  {/* 已选图片预览 / 编辑中加载动画 */}
                  {isEditing ? (
                    <div className="flex min-h-[420px] flex-col items-center justify-center gap-6 overflow-hidden rounded-[28px] border border-white/75 bg-white/88 py-20 shadow-[0_24px_70px_rgba(80,64,120,0.10),0_4px_14px_rgba(80,64,120,0.05)] backdrop-blur dark:border-surface-border dark:bg-surface-card">
                      <div className="relative h-20 w-20">
                        <Loader2 className="h-20 w-20 animate-spin text-brand" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="h-8 w-8 rounded-full bg-[rgb(238,234,245)] dark:bg-surface" />
                        </div>
                      </div>
                      <div className="text-center">
                        <p className="text-base font-semibold text-text-primary">AI 正在处理</p>
                        <p className="mt-1 text-sm text-text-tertiary">
                          {editMode === "upscale" ? "正在增强画质，可能需要 30 秒到 2 分钟..." : "正在编辑图片，请稍候..."}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-[28px] border border-white/75 bg-white/88 p-3 shadow-[0_24px_70px_rgba(80,64,120,0.10),0_4px_14px_rgba(80,64,120,0.05)] backdrop-blur dark:border-surface-border dark:bg-surface-card">
                      <img src={sourceUrl} alt="源图" className="h-auto max-h-[520px] w-full rounded-2xl object-contain bg-surface-elevated" />
                    </div>
                  )}

                  {/* 文字移除/替换背景 的 prompt 输入框 */}
                  {needsPrompt && (
                    <div className="rounded-2xl border border-white/75 bg-white/88 p-4 shadow-[0_10px_28px_rgba(80,64,120,0.06)] backdrop-blur dark:border-surface-border dark:bg-surface-card">
                      <label className="mb-2 block text-xs font-medium text-text-secondary">
                        {config.promptLabel}
                      </label>
                      <textarea
                        value={replacePrompt}
                        onChange={(e) => setReplacePrompt(e.target.value)}
                        placeholder={config.promptPlaceholder}
                        disabled={isEditing}
                        className="h-24 w-full resize-none rounded-xl border border-surface-border bg-surface-elevated p-3 text-sm leading-relaxed text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand/20"
                      />
                    </div>
                  )}

                  {/* 确认按钮 */}
                  <div className="flex justify-center">
                    <button
                      onClick={handleEdit}
                      disabled={isEditing || (needsPrompt && !replacePrompt.trim())}
                      className={cn(
                        "flex items-center justify-center gap-2 rounded-full bg-brand px-9 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(59,130,246,0.24)] transition-all duration-200",
                        isEditing || (needsPrompt && !replacePrompt.trim())
                          ? "cursor-not-allowed opacity-50"
                          : "hover:-translate-y-0.5 hover:bg-brand-hover hover:shadow-[0_12px_28px_rgba(59,130,246,0.28)]"
                      )}
                    >
                      {isEditing ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          处理中...
                        </>
                      ) : (
                        <>
                          <TabIcon className="h-4 w-4" />
                          {config.buttonLabel}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* 底部示例区域 */}
              <div className="pt-2">
                <div className="mb-5 text-center">
                  <h3 className="text-sm font-semibold text-text-primary">
                    {config.exampleTitle}
                  </h3>
                  <p className="mt-1 text-xs text-text-tertiary">
                    {config.exampleSubtitle}
                  </p>
                </div>
                <div className="flex justify-center">
                  {examples.map((ex) => (
                    <div
                      key={ex.label}
                      className="group/video w-full max-w-[520px] overflow-hidden rounded-[22px] border border-white/75 bg-white/88 shadow-[0_18px_48px_rgba(80,64,120,0.10),0_3px_10px_rgba(80,64,120,0.04)] backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-brand/30 hover:shadow-[0_26px_70px_rgba(80,64,120,0.16),0_0_0_1px_var(--brand-muted)] dark:border-surface-border dark:bg-surface-card"
                    >
                      {/* Before → After 悬浮视频式预览 */}
                      <div className="relative h-[210px] overflow-hidden p-5">
                        {/* 默认：左右双图对比 */}
                        <div className="flex items-center gap-4 transition-all duration-500 ease-out group-hover/video:-translate-y-2 group-hover/video:scale-[0.94] group-hover/video:opacity-0">
                          {/* 原图 */}
                          <div className="flex-1 text-center">
                            <img
                              src={ex.before}
                              alt="原图"
                              className="h-40 w-full rounded-2xl object-cover bg-surface-elevated"
                            />
                            <div className="mt-2 text-xs font-medium text-text-tertiary">原图</div>
                          </div>
                          {/* 箭头 */}
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-[0_8px_18px_rgba(59,130,246,0.22)]">
                            <ArrowRight className="h-5 w-5" />
                          </div>
                          {/* 处理后 */}
                          <div className="flex-1 text-center">
                            <div className="flex h-40 w-full items-center justify-center rounded-2xl bg-[linear-gradient(45deg,hsl(var(--surface-elevated))_25%,transparent_25%,transparent_75%,hsl(var(--surface-elevated))_75%),linear-gradient(45deg,hsl(var(--surface-elevated))_25%,transparent_25%,transparent_75%,hsl(var(--surface-elevated))_75%)] bg-[length:18px_18px] bg-[position:0_0,9px_9px]">
                              <img
                                src={ex.after}
                                alt="处理后"
                                className="h-full w-full rounded-2xl object-contain"
                              />
                            </div>
                            <div className="mt-2 text-xs font-medium text-brand">
                              {config.afterLabel}
                            </div>
                          </div>
                        </div>

                        {/* Hover：视频展示效果 */}
                        <div className="pointer-events-none absolute inset-5 translate-y-4 scale-[0.98] overflow-hidden rounded-2xl border border-surface-border bg-surface-card opacity-0 shadow-[0_18px_42px_rgba(80,64,120,0.16)] transition-all duration-500 ease-out group-hover/video:translate-y-0 group-hover/video:scale-100 group-hover/video:opacity-100">
                          <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent_0%,transparent_34%,rgba(255,255,255,0.58)_50%,transparent_66%,transparent_100%)] bg-[length:220%_100%] opacity-0 transition-opacity duration-200 group-hover/video:animate-[gradient-shift_1.2s_ease-in-out_infinite] group-hover/video:opacity-100 dark:opacity-0" />
                          <div className="flex h-full">
                            <div className="relative h-full w-[45%] overflow-hidden">
                              <img src={ex.before} alt="原图预览" className="h-full w-full object-cover" />
                              <div className="absolute inset-y-0 right-0 w-14 bg-gradient-to-r from-transparent to-surface-card" />
                              <div className="absolute left-3 top-3 rounded-full bg-surface-card/90 px-2.5 py-1 text-[11px] font-medium text-text-secondary shadow-sm backdrop-blur">
                                原图
                              </div>
                            </div>
                            <div className="relative flex h-full flex-1 items-center justify-center bg-[linear-gradient(45deg,hsl(var(--surface-elevated))_25%,transparent_25%,transparent_75%,hsl(var(--surface-elevated))_75%),linear-gradient(45deg,hsl(var(--surface-elevated))_25%,transparent_25%,transparent_75%,hsl(var(--surface-elevated))_75%)] bg-[length:18px_18px] bg-[position:0_0,9px_9px]">
                              <img src={ex.after} alt="去背预览" className="h-[92%] w-[92%] object-contain transition-transform duration-700 ease-out group-hover/video:scale-105" />
                              <div className="absolute right-3 top-3 rounded-full bg-brand px-2.5 py-1 text-[11px] font-medium text-white shadow-[0_8px_18px_rgba(59,130,246,0.22)]">
                                {config.afterLabel}
                              </div>
                              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-surface-border bg-surface-card/90 px-3 py-1.5 text-[11px] font-medium text-text-secondary shadow-sm backdrop-blur">
                                <Sparkles className="h-3 w-3 text-brand" />
                                悬浮预览 AI 处理效果
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      {/* 标签 + 试用按钮 */}
                      <div className="flex items-center justify-between border-t border-surface-border/70 bg-surface-card/70 px-5 py-3">
                        <span className="text-sm font-medium text-text-secondary">{ex.label}</span>
                        <button
                          onClick={() => useExample(ex.before)}
                          className="flex items-center gap-1.5 rounded-full border border-brand/20 bg-brand-muted px-4 py-1.5 text-xs font-medium text-brand transition-all duration-200 hover:border-brand/30 hover:bg-brand/15"
                        >
                          <Wand2 className="h-3.5 w-3.5" />
                          试用示例图片
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* 结果展示 */
            <div className="mx-auto max-w-5xl space-y-6">
              {/* Before/After 滑动对比 */}
              <div className="overflow-hidden rounded-[28px] border border-white/75 bg-white/88 p-3 shadow-[0_24px_70px_rgba(80,64,120,0.10),0_4px_14px_rgba(80,64,120,0.05)] backdrop-blur dark:border-surface-border dark:bg-surface-card">
                <BeforeAfterSlider
                  beforeImage={sourceUrl}
                  afterImage={result}
                  beforeLabel="原始"
                  afterLabel={config.resultLabel}
                />
              </div>

              {/* 操作按钮 */}
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-2 rounded-full bg-brand px-6 py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(59,130,246,0.24)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-hover"
                >
                  <Download className="h-4 w-4" />
                  下载图片
                </button>
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 rounded-full border border-white/75 bg-white/88 px-6 py-2.5 text-sm font-medium text-text-secondary shadow-[0_6px_18px_rgba(80,64,120,0.06)] transition-all duration-200 hover:text-text-primary dark:border-surface-border dark:bg-surface-card"
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
  );
}
