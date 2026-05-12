"use client";

import { useState, useEffect } from "react";
import { useImage } from "@/hooks/useImage";
import { useImageModels, ChatModel } from "@/hooks/useModels";
import { ImageIcon, Loader2, Trash2, Download, RefreshCw, ChevronDown } from "lucide-react";
import { toast } from "sonner";

const IMAGE_SIZES = [
  { value: "1024x1024", label: "正方形 1:1", icon: "□" },
  { value: "1024x1792", label: "竖屏 9:16", icon: "■" },
  { value: "1792x1024", label: "横屏 16:9", icon: "■" },
];

export default function ImagePage() {
  const { images, isGenerating, generateImage, fetchImages, deleteImage } = useImage();
  const { models: imageModels } = useImageModels();
  const [prompt, setPrompt] = useState("");
  const [selectedSize, setSelectedSize] = useState("1024x1024");
  const [selectedModel, setSelectedModel] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  // 默认选第一个画图模型
  useEffect(() => {
    if (imageModels.length > 0 && !selectedModel) {
      setSelectedModel(imageModels[0].id);
    }
  }, [imageModels, selectedModel]);

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  const currentModel = imageModels.find((m) => m.id === selectedModel) || imageModels[0];

  const handleGenerate = async () => {
    if (!prompt.trim()) { toast.error("请输入描述"); return; }
    setIsLoading(true);
    try {
      await generateImage(prompt, selectedSize);
      toast.success("图片生成成功");
      setPrompt("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定删除这张图片吗？")) return;
    try { await deleteImage(id); toast.success("删除成功"); } catch { toast.error("删除失败"); }
  };

  const handleDownload = async (url: string, id: number) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `aispace-image-${id}.png`;
      link.click();
    } catch { toast.error("下载失败"); }
  };

  return (
    <div className="flex flex-col h-full bg-surface">
      <header className="shrink-0 h-12 flex items-center justify-between px-4 border-b border-surface-border">
        <div className="flex items-center gap-2">
          <ImageIcon className="w-5 h-5 text-text-primary" />
          <span className="text-sm font-semibold text-text-primary">图片生成</span>
        </div>
        {/* 模型选择器 */}
        {imageModels.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setModelMenuOpen(!modelMenuOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-surface-border text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors"
            >
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: currentModel?.color || "#999" }} />
              <span>{currentModel?.name || "选择模型"}</span>
              <ChevronDown className="w-3 h-3" />
            </button>
            {modelMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setModelMenuOpen(false)} />
                <div className="absolute top-full right-0 mt-2 w-56 z-50 rounded-xl border border-surface-border bg-surface-elevated shadow-xl py-1">
                  {imageModels.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => { setSelectedModel(model.id); setModelMenuOpen(false); }}
                      className={`flex items-center gap-3 w-full px-3 py-2.5 text-sm transition-colors text-left ${
                        selectedModel === model.id ? "bg-surface-card text-text-primary" : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                      }`}
                    >
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: model.color }} />
                      <div className="flex-1">
                        <div className="font-medium">{model.name}</div>
                        <div className="text-[11px] text-text-tertiary">{model.description}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="bg-surface-card rounded-lg border border-surface-border p-6">
            <h2 className="text-lg font-medium text-text-primary mb-4">创建新图片</h2>
            
            <div className="flex gap-3 mb-4">
              {IMAGE_SIZES.map((size) => (
                <button
                  key={size.value}
                  onClick={() => setSelectedSize(size.value)}
                  className={`px-4 py-2 rounded-lg border text-sm transition-colors ${
                    selectedSize === size.value
                      ? "bg-brand text-white border-brand"
                      : "bg-surface border-surface-border text-text-secondary hover:border-brand/50"
                  }`}
                >
                  <span className="mr-2">{size.icon}</span>
                  {size.label}
                </button>
              ))}
            </div>

            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想生成的图片，例如：一只在星空下奔跑的狼..."
              className="w-full h-24 p-3 bg-surface border border-surface-border rounded-lg text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none focus:border-brand mb-4"
            />

            <button
              onClick={handleGenerate}
              disabled={isLoading || isGenerating || !prompt.trim()}
              className="w-full py-3 bg-brand text-white rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-brand/90 transition-colors"
            >
              {(isLoading || isGenerating) ? (
                <><Loader2 className="w-4 h-4 animate-spin" />生成中...</>
              ) : (
                <><ImageIcon className="w-4 h-4" />生成图片</>
              )}
            </button>
          </div>

          {images.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-text-secondary mb-4">历史记录 ({images.length})</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {images.map((image) => (
                  <div key={image.id} className="group bg-surface-card rounded-lg border border-surface-border overflow-hidden hover:border-brand/50 transition-colors">
                    <div className="aspect-square bg-surface relative">
                      <img src={image.image_url} alt={image.prompt} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button onClick={() => handleDownload(image.image_url, image.id)} className="p-2 bg-white rounded-full hover:bg-gray-100" title="下载"><Download className="w-4 h-4 text-gray-800" /></button>
                        <button onClick={() => { setPrompt(image.prompt); setSelectedSize(image.size || "1024x1024"); }} className="p-2 bg-white rounded-full hover:bg-gray-100" title="重新生成"><RefreshCw className="w-4 h-4 text-gray-800" /></button>
                        <button onClick={() => handleDelete(image.id)} className="p-2 bg-red-500 rounded-full hover:bg-red-600" title="删除"><Trash2 className="w-4 h-4 text-white" /></button>
                      </div>
                    </div>
                    <div className="p-3">
                      <p className="text-sm text-text-primary line-clamp-2">{image.prompt}</p>
                      <p className="text-xs text-text-tertiary mt-1">{new Date(image.created_at).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {images.length === 0 && !isLoading && (
            <div className="text-center py-12 text-text-tertiary">
              <ImageIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>还没有生成过图片</p>
              <p className="text-sm mt-1">在上方输入描述开始创作吧</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
