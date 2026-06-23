"use client";

import { useState } from "react";
import { Sparkles, Wand2, Image, Video, AtSign, Palette, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShotGenerationInputProps {
  shotTitle: string;
  onGenerateImage?: (prompt: string) => void;
  onGenerateVideo?: (prompt: string) => void;
  generating?: boolean;
}

export default function ShotGenerationInput({
  shotTitle,
  onGenerateImage,
  onGenerateVideo,
  generating,
}: ShotGenerationInputProps) {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"image" | "video">("image");

  const handleSubmit = () => {
    if (!prompt.trim() || generating) return;
    if (mode === "image") {
      onGenerateImage?.(prompt);
    } else {
      onGenerateVideo?.(prompt);
    }
    setPrompt("");
  };

  return (
    <div className="rounded-xl border border-surface-border bg-surface-elevated p-3 shadow-sm">
      {/* 模式切换 */}
      <div className="mb-2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setMode("image")}
          className={cn(
            "flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-medium transition-colors",
            mode === "image"
              ? "bg-brand/10 text-brand"
              : "text-text-tertiary hover:text-text-secondary"
          )}
        >
          <Image className="h-3 w-3" />
          分镜图
        </button>
        <button
          type="button"
          onClick={() => setMode("video")}
          className={cn(
            "flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-medium transition-colors",
            mode === "video"
              ? "bg-rose-500/10 text-rose-500"
              : "text-text-tertiary hover:text-text-secondary"
          )}
        >
          <Video className="h-3 w-3" />
          视频
        </button>
      </div>

      {/* 输入框 */}
      <div className="relative">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={`描述你想要生成的${mode === "image" ? "分镜图" : "视频"}内容，@引用素材`}
          className="h-16 w-full resize-none rounded-lg border border-surface-border bg-surface-base px-3 py-2 text-xs text-text-primary outline-none focus:border-brand"
        />
        {/* 底部工具栏 */}
        <div className="mt-1.5 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button type="button" className="rounded p-1 text-text-tertiary hover:bg-surface-card hover:text-text-secondary" title="添加">
              <Sparkles className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="rounded p-1 text-text-tertiary hover:bg-surface-card hover:text-text-secondary" title="引用素材">
              <AtSign className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="rounded p-1 text-text-tertiary hover:bg-surface-card hover:text-text-secondary" title="风格">
              <Palette className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="rounded p-1 text-text-tertiary hover:bg-surface-card hover:text-text-secondary" title="画幅">
              <Monitor className="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!prompt.trim() || generating}
            className={cn(
              "flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-medium text-white transition-colors",
              mode === "image"
                ? "bg-brand hover:bg-brand/90 disabled:opacity-50"
                : "bg-rose-500 hover:bg-rose-600 disabled:opacity-50"
            )}
          >
            {generating ? (
              <>
                <Wand2 className="h-3 w-3 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3" />
                生成
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
