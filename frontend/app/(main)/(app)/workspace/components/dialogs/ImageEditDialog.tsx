"use client";

import { useState, useRef } from "react";
import { ImageIcon, UploadCloud, Loader2, Wand2, Eraser, Type, ImagePlus, Trash2, WandSparkles } from "lucide-react";
import DialogShell, { THEMES } from "./DialogShell";
import { resolveImageUrl } from "@/lib/resolveImageUrl";

const EDIT_MODES = [
  { key: "remove-bg", label: "移除背景", icon: Eraser, desc: "智能识别主体并去除背景" },
  { key: "replace-bg", label: "替换背景", icon: ImagePlus, desc: "保留主体，替换为新背景" },
  { key: "remove-text", label: "移除文字", icon: Type, desc: "智能检测并消除图片中的文字" },
  { key: "upscale", label: "画质提升", icon: Wand2, desc: "超分辨率增强，提升细节清晰度" },
];

export default function ImageEditDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState("remove-bg");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const theme = THEMES.purple;

  const handleFile = (f: File | null) => {
    if (!f) return;
    setFile(f);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(f);
    setResult(null);
  };

  const handleSubmit = async () => {
    if (!file) return;
    setLoading(true);
    const token = localStorage.getItem("token");

    try {
      // 把文件转 base64
      const toBase64 = (f: File): Promise<string> =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(",")[1]); // 去掉 data:image/xxx;base64, 前缀
          };
          reader.onerror = reject;
          reader.readAsDataURL(f);
        });

      const imageData = await toBase64(file);
      const body: Record<string, any> = {
        image_data: imageData,
        edit_mode: mode,
      };
      if (prompt && prompt.trim()) body.prompt = prompt.trim();

      const res = await fetch("/api/images/edit", {
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
      setResult(resolveImageUrl(data.image_url || data.url || null));
    } catch (e: any) {
      alert(e.message || "编辑失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DialogShell open={open} onClose={onClose} title="图片编辑工坊" icon={<WandSparkles className={`h-4 w-4 ${theme.primary}`} />} size="xl" theme={theme}>
      {/* 紫色工坊氛围 */}
      <div className={`mb-3 flex items-center gap-3 rounded-xl ${theme.primaryBg} ${theme.primaryBorder} border px-4 py-2.5`}>
        <Wand2 className={`h-4 w-4 ${theme.primary}`} />
        <p className="text-[11px] text-text-secondary">选择工具，上传图片，AI 工坊为你施展魔法</p>
      </div>

      {/* 编辑模式 - 紫色主题 */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {EDIT_MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-all ${
              mode === m.key ? `${theme.primaryBorder} ${theme.primaryBg} ring-1 ${theme.primaryBorder}` : "border-surface-border bg-surface-card hover:border-purple-500/20"
            }`}
          >
            <m.icon className={`h-5 w-5 ${mode === m.key ? theme.primary : "text-text-tertiary"}`} />
            <span className={`text-xs font-medium ${mode === m.key ? theme.primary : "text-text-secondary"}`}>{m.label}</span>
            <span className="text-[10px] text-text-tertiary leading-3">{m.desc}</span>
          </button>
        ))}
      </div>

      {/* 上传区 */}
      {!preview ? (
        <div
          className={`mb-4 rounded-xl border-2 border-dashed p-8 text-center transition-all cursor-pointer ${theme.primaryBorder} ${theme.primaryBg} hover:brightness-110`}
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0] || null)} />
          <div className={`mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl ${theme.primaryBg} ${theme.primaryBorder} border`}>
            <UploadCloud className={`h-7 w-7 ${theme.primary}`} />
          </div>
          <p className="text-sm font-medium text-text-primary">点击上传图片</p>
          <p className="text-[11px] text-text-tertiary">支持 JPG、PNG、WebP 格式</p>
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="relative rounded-xl border border-surface-border bg-surface-card p-2">
            <p className="mb-1 text-[10px] text-text-tertiary">原图</p>
            <img src={preview} alt="preview" className="max-h-[200px] w-full rounded-lg object-contain" />
            <button onClick={() => { setFile(null); setPreview(null); setResult(null); }} className="absolute right-2 top-5 rounded-md bg-black/50 p-1 text-white hover:bg-red-500">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          <div className="rounded-xl border border-surface-border bg-surface-card p-2">
            <p className="mb-1 text-[10px] text-text-tertiary">结果</p>
            {result ? (
              <img src={result} alt="result" className="max-h-[200px] w-full rounded-lg object-contain" />
            ) : (
              <div className={`flex h-[200px] items-center justify-center rounded-lg ${theme.primaryBg} text-xs text-text-tertiary`}>
                {loading ? <Loader2 className={`h-5 w-5 animate-spin ${theme.primary}`} /> : "等待施展魔法..."}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 提示词（替换背景需要） */}
      {mode === "replace-bg" && (
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="描述想替换的背景... 例如：绚丽的星空"
          className={`mb-3 w-full rounded-xl border ${theme.primaryBorder} bg-surface-card px-3 py-2 text-sm text-text-primary outline-none focus:border-purple-500`}
        />
      )}

      {preview && (
        <button
          onClick={handleSubmit}
          disabled={loading}
          className={`flex w-full items-center justify-center gap-2 rounded-xl ${theme.accent} py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50`}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
          {loading ? "施展魔法中..." : "开始编辑"}
        </button>
      )}
    </DialogShell>
  );
}
