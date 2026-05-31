"use client";

import { useState, useEffect } from "react";
import { ImageIcon, Wand2, Loader2, Trash2, Download, Sparkles, Palette, Images } from "lucide-react";
import DialogShell, { THEMES } from "./DialogShell";
import { useImage } from "@/hooks/useImage";
import { resolveImageUrl } from "@/lib/resolveImageUrl";
import { getErrorMessage } from "@/lib/errors";

const ASPECTS = [
  { label: "Auto", value: "auto" },
  { label: "1:1", value: "1:1" },
  { label: "16:9", value: "16:9" },
  { label: "9:16", value: "9:16" },
  { label: "4:3", value: "4:3" },
  { label: "3:4", value: "3:4" },
];

const QUALITIES = [
  { label: "标准", value: "medium" },
  { label: "高清", value: "high" },
];

export default function ImageGenDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { images, isGenerating, error, generateImage, deleteImage, fetchImages } = useImage();
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("auto");
  const [quality, setQuality] = useState("medium");
  const theme = THEMES.pink;

  useEffect(() => {
    if (open) fetchImages();
  }, [open, fetchImages]);

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;
    await generateImage(prompt.trim(), aspect, "1024x1024", quality);
    setPrompt("");
  };

  return (
    <DialogShell open={open} onClose={onClose} title="AI画图" icon={<Palette className={`h-4 w-4 ${theme.primary}`} />} size="xl" theme={theme}>
      {/* 大标题区 */}
      <div className="mb-8 mt-2 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-text-primary">AI画图</h1>
        <p className="mt-2 text-sm text-text-tertiary">输入提示词，AI 为你创作精美图片</p>
      </div>

      {/* 生成区域 - 干净 spacious 风格 */}
      <div className="mb-8 rounded-2xl border border-surface-border bg-surface-card p-6">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="描述你想生成的画面..."
          className="h-24 w-full resize-none bg-transparent text-base text-text-primary outline-none placeholder:text-text-tertiary"
        />

        {/* 示例提示词标签 */}
        {!prompt && (
          <div className="mb-4 flex flex-wrap gap-2">
            {["一只在星空下奏乐的猫，水彩风格", "赛博朋克风格的城市夜景", "可爱卡通风格的早餐插画"].map((tag) => (
              <button
                key={tag}
                onClick={() => setPrompt(tag)}
                className="rounded-full border border-surface-border bg-surface-elevated px-3 py-1 text-[11px] text-text-tertiary transition-colors hover:border-pink-500/30 hover:text-text-secondary"
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1.5">
            {ASPECTS.map((a) => (
              <button
                key={a.value}
                onClick={() => setAspect(a.value)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  aspect === a.value ? `${theme.primaryBorder} ${theme.primaryBg} ${theme.primary}` : "border-surface-border text-text-tertiary hover:text-text-secondary"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {QUALITIES.map((q) => (
              <button
                key={q.value}
                onClick={() => setQuality(q.value)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  quality === q.value ? `${theme.primaryBorder} ${theme.primaryBg} ${theme.primary}` : "border-surface-border text-text-tertiary hover:text-text-secondary"
                }`}
              >
                {q.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
            className={`ml-auto flex items-center gap-2 rounded-xl ${theme.accent} px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50`}
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isGenerating ? "生成中..." : "生成图片"}
          </button>
        </div>
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      </div>

      {/* 图片列表 */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-text-primary">
          <ImageIcon className={`h-3.5 w-3.5 ${theme.primary}`} />
          画廊 ({images.length})
        </h3>
        {images.length === 0 ? (
          <div className="rounded-xl border border-dashed border-surface-border bg-surface-card p-10 text-center">
            <Palette className="mx-auto mb-2 h-10 w-10 text-text-tertiary/40" />
            <p className="text-xs text-text-tertiary">花园空空，输入提示词种下第一朵灵感吧</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {images.map((img) => (
              <div key={img.id} className="group relative overflow-hidden rounded-xl border border-surface-border bg-surface-card">
                {img.status === "pending" ? (
                  <div className="flex aspect-square items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-text-tertiary" />
                  </div>
                ) : img.status === "failed" ? (
                  <div className="flex aspect-square flex-col items-center justify-center gap-1 px-3 text-center">
                    <p className="text-xs font-medium text-red-400">生成失败</p>
                    <p className="text-[11px] text-text-tertiary">{getErrorMessage(img.error_message || "请稍后重试", { module: "image", fallbackMessage: "图片生成失败，请稍后重试。" })}</p>
                  </div>
                ) : (
                  <img src={resolveImageUrl(img.image_url)} alt={img.prompt} className="aspect-square w-full object-cover" loading="lazy" />
                )}
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/60 p-2 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                  <p className="truncate text-[10px] text-white/90">{img.prompt}</p>
                  <div className="flex gap-1">
                    {img.image_url && (
                      <a href={resolveImageUrl(img.image_url)} target="_blank" rel="noreferrer" className="rounded-md bg-white/20 p-1 text-white hover:bg-white/30">
                        <Download className="h-3 w-3" />
                      </a>
                    )}
                    <button onClick={() => deleteImage(img.id)} className="rounded-md bg-white/20 p-1 text-white hover:bg-red-500/80">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DialogShell>
  );
}
