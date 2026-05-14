"use client";

import { useState, useEffect } from "react";
import { useImage } from "@/hooks/useImage";
import { useImageModels, ChatModel } from "@/hooks/useModels";
import { GeneratedImage } from "@/hooks/useImage";
import ImageLightbox from "@/components/ui/ImageLightbox";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import {
  ImageIcon,
  Loader2,
  Trash2,
  Download,
  RefreshCw,
  ChevronDown,
  Wand2,
  Clock,
  AlertCircle,
  Send,
  Layers,
  ZoomIn,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const ASPECT_RATIOS = [
  { value: "auto", label: "Auto", w: 1, h: 1 },
  { value: "1:1", label: "1:1", w: 1, h: 1 },
  { value: "2:3", label: "2:3", w: 2, h: 3 },
  { value: "3:2", label: "3:2", w: 3, h: 2 },
  { value: "3:4", label: "3:4", w: 3, h: 4 },
  { value: "4:3", label: "4:3", w: 4, h: 3 },
  { value: "4:5", label: "4:5", w: 4, h: 5 },
  { value: "5:4", label: "5:4", w: 5, h: 4 },
  { value: "9:16", label: "9:16", w: 9, h: 16 },
  { value: "16:9", label: "16:9", w: 16, h: 9 },
  { value: "21:9", label: "21:9", w: 21, h: 9 },
];

const RESOLUTIONS = [
  { value: "1K", label: "1K", desc: "1024px" },
  { value: "2K", label: "2K", desc: "2048px" },
  { value: "4K", label: "4K", desc: "3840px" },
];

const QUALITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Med" },
  { value: "high", label: "High" },
  { value: "auto", label: "Auto" },
];

// 纵横比小图标
function AspectIcon({ w, h, active }: { w: number; h: number; active: boolean }) {
  const isLandscape = w > h;
  const isPortrait = h > w;
  const maxDim = 28;
  let boxW = maxDim;
  let boxH = maxDim;
  if (isLandscape) {
    boxW = maxDim;
    boxH = Math.round((maxDim * h) / w);
    boxH = Math.max(boxH, 10);
  } else if (isPortrait) {
    boxH = maxDim;
    boxW = Math.round((maxDim * w) / h);
    boxW = Math.max(boxW, 10);
  }
  return (
    <div
      className={cn(
        "rounded-[3px] border transition-colors",
        active ? "border-brand/70 bg-brand/10" : "border-text-tertiary/30"
      )}
      style={{ width: boxW, height: boxH }}
    />
  );
}

export default function ImagePage() {
  const { images, isGenerating, generateImage, deleteImage } = useImage();
  const { models: imageModels } = useImageModels();
  const [prompt, setPrompt] = useState("");
  const [selectedAspectRatio, setSelectedAspectRatio] = useState("1:1");
  const [selectedResolution, setSelectedResolution] = useState("1K");
  const [selectedModel, setSelectedModel] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);
  const [selectedQuality, setSelectedQuality] = useState("medium");
  const [previewImage, setPreviewImage] = useState<GeneratedImage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [deletingIds, setDeletingIds] = useState<number[]>([]);
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);

  // 默认选第一个画图模型
  useEffect(() => {
    if (imageModels.length > 0 && !selectedModel) {
      setSelectedModel(imageModels[0].id);
    }
  }, [imageModels, selectedModel]);

  const currentModel = imageModels.find((m) => m.id === selectedModel) || imageModels[0];
  const currentAspect = ASPECT_RATIOS.find((a) => a.value === selectedAspectRatio) || ASPECT_RATIOS[1];

  const hasContent = prompt.trim().length > 0;

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error("请输入描述");
      return;
    }
    setIsLoading(true);
    try {
      await generateImage(prompt, selectedAspectRatio, selectedResolution, selectedQuality, referenceImageUrl || undefined);
      toast.success(referenceImageUrl ? "已提交基于原图的编辑请求" : "已提交生成请求");
      setPrompt("");
      setReferenceImageUrl(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = (id: number) => {
    setDeleteTarget(id);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletingIds((prev) => [...prev, deleteTarget]);
    setDeleteTarget(null);
    await new Promise((r) => setTimeout(r, 300));
    try {
      await deleteImage(deleteTarget);
      toast.success("删除成功");
    } catch {
      toast.error("删除失败");
    } finally {
      setDeletingIds((prev) => prev.filter((i) => i !== deleteTarget));
    }
  };

  const handleDownload = async (url: string, id: number) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `aispace-image-${id}.png`;
      link.click();
      toast.success("下载已开始");
    } catch {
      toast.error("下载失败");
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface">
      <header className="shrink-0 h-12 flex items-center justify-between px-4 border-b border-surface-border">
        <div className="flex items-center gap-2">
          <ImageIcon className="w-5 h-5 text-brand" />
          <span className="text-sm font-semibold text-text-primary">图片生成</span>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* 输入区域 - 对齐聊天页 MessageInput 风格 */}
          <div
            className={cn(
              "relative flex flex-col rounded-2xl border transition-all duration-300",
              "bg-surface-card",
              referenceImageUrl
                ? "border-brand/30 focus-within:border-brand/60 focus-within:shadow-[0_0_0_1px_rgba(59,130,246,0.15),0_0_20px_rgba(59,130,246,0.08)]"
                : "border-surface-border focus-within:border-brand/50 focus-within:shadow-[0_0_0_1px_rgba(59,130,246,0.1)]"
            )}
          >
            {/* 参考图标示条 */}
            {referenceImageUrl && (
              <div className="flex items-center gap-2 px-3 pt-2.5 pb-0">
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-brand/10 border border-brand/30 text-brand text-xs shadow-[0_0_8px_rgba(59,130,246,0.12)]">
                  <div className="relative">
                    <img
                      src={referenceImageUrl}
                      alt="参考图"
                      className="w-6 h-6 rounded object-cover border border-brand/20"
                    />
                    <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-brand border border-surface-card" />
                  </div>
                  <span className="font-medium">基于原图编辑</span>
                  <button
                    type="button"
                    onClick={() => setReferenceImageUrl(null)}
                    className="ml-1 p-0.5 rounded hover:bg-brand/20 transition-colors"
                    title="取消参考"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={referenceImageUrl ? "描述您想要对原图进行的修改..." : "尝试描述您想要创建的图像..."}
              disabled={isLoading || isGenerating}
              className={cn(
                "w-full h-28 p-4 bg-transparent text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none text-sm leading-relaxed",
                (isLoading || isGenerating) && "opacity-60 cursor-not-allowed"
              )}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
            />
            <div className="flex items-center justify-between px-3 pb-3 pt-1">
              <div className="flex items-center gap-2 flex-wrap">
                {/* 模型选择 */}
                {imageModels.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => setModelMenuOpen(!modelMenuOpen)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[13px] font-medium transition-all duration-200 border-surface-border text-text-secondary hover:text-text-primary hover:border-text-tertiary/50 bg-transparent"
                    >
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: currentModel?.color || "#999" }}
                      />
                      <span>{currentModel?.name || "选择模型"}</span>
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    {modelMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setModelMenuOpen(false)} />
                        <div className="absolute top-full left-0 mt-1.5 w-56 z-50 rounded-xl border border-surface-border bg-surface-elevated shadow-xl py-1 animate-fade-in">
                          {imageModels.map((model) => (
                            <button
                              key={model.id}
                              onClick={() => {
                                setSelectedModel(model.id);
                                setModelMenuOpen(false);
                              }}
                              className={cn(
                                "flex items-center gap-3 w-full px-3 py-2.5 text-sm transition-colors text-left",
                                selectedModel === model.id
                                  ? "bg-brand/10 text-brand"
                                  : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                              )}
                            >
                              <div
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: model.color }}
                              />
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

                {/* 纵横比+分辨率选择 */}
                <div className="relative">
                  <button
                    onClick={() => setAspectMenuOpen(!aspectMenuOpen)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[13px] font-medium transition-all duration-200 border-surface-border text-text-secondary hover:text-text-primary hover:border-text-tertiary/50 bg-transparent"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>
                      {currentAspect.label} · {selectedResolution}
                    </span>
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  {aspectMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setAspectMenuOpen(false)} />
                      <div className="absolute top-full left-0 mt-1.5 w-[340px] z-50 rounded-xl border border-surface-border bg-surface-elevated shadow-xl p-4 animate-fade-in">
                        {/* 纵横比 */}
                        <div className="text-xs font-medium text-text-secondary mb-3">纵横比</div>
                        <div className="grid grid-cols-5 gap-2">
                          {ASPECT_RATIOS.map((ar) => {
                            const active = selectedAspectRatio === ar.value;
                            return (
                              <button
                                key={ar.value}
                                onClick={() => setSelectedAspectRatio(ar.value)}
                                className={cn(
                                  "flex flex-col items-center gap-1 px-1 py-2 rounded-lg border text-[10px] transition-all duration-200",
                                  active
                                    ? "bg-brand/10 border-brand/40 text-brand"
                                    : "bg-surface border-surface-border text-text-secondary hover:border-text-tertiary/50"
                                )}
                              >
                                <AspectIcon w={ar.w} h={ar.h} active={active} />
                                <span>{ar.label}</span>
                              </button>
                            );
                          })}
                        </div>

                        {/* 分辨率 */}
                        <div className="text-xs font-medium text-text-secondary mt-4 mb-2">分辨率</div>
                        <div className="flex gap-2">
                          {RESOLUTIONS.map((res) => (
                            <button
                              key={res.value}
                              onClick={() => setSelectedResolution(res.value)}
                              className={cn(
                                "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-xs transition-all duration-200",
                                selectedResolution === res.value
                                  ? "bg-brand/10 border-brand/40 text-brand"
                                  : "bg-surface border-surface-border text-text-secondary hover:border-text-tertiary/50"
                              )}
                            >
                              <span className="font-semibold">{res.label}</span>
                              <span className="text-[10px] opacity-70">{res.desc}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* 质量选择 - pill 风格 */}
                <div className="flex items-center rounded-full border border-surface-border overflow-hidden bg-transparent">
                  {QUALITIES.map((q) => (
                    <button
                      key={q.value}
                      onClick={() => setSelectedQuality(q.value)}
                      className={cn(
                        "px-2.5 py-1 text-[11px] font-medium transition-all duration-200",
                        selectedQuality === q.value
                          ? "bg-brand/10 text-brand"
                          : "text-text-tertiary hover:text-text-secondary"
                      )}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 发送/停止按钮 - 对齐聊天页 */}
              {isLoading || isGenerating ? (
                <button
                  onClick={() => { /* 图片生成一般不支持中途停止，保持禁用态 */ }}
                  disabled
                  className="flex items-center justify-center w-8 h-8 rounded-lg bg-red-500/80 text-white cursor-not-allowed"
                  title="生成中..."
                >
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                </button>
              ) : (
                <button
                  onClick={handleGenerate}
                  disabled={!hasContent}
                  className={cn(
                    "flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200",
                    hasContent
                      ? referenceImageUrl
                        ? "bg-brand text-white hover:bg-brand-hover shadow-[0_0_8px_rgba(59,130,246,0.25)]"
                        : "bg-brand text-white hover:bg-brand-hover"
                      : "bg-surface-elevated text-text-tertiary cursor-not-allowed"
                  )}
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* 历史记录 */}
          {images.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-text-secondary mb-3 px-1">
                历史记录 ({images.length})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {images.map((image) => (
                  <ImageCard
                    key={image.id}
                    image={image}
                    isDeleting={deletingIds.includes(image.id)}
                    onDelete={handleDelete}
                    onDownload={handleDownload}
                    onPreview={() => setPreviewImage(image)}
                    onReuse={(p, size, refUrl) => {
                      setPrompt("");
                      setReferenceImageUrl(refUrl || null);
                      if (size) {
                        const parts = size.split("x");
                        if (parts.length === 2) {
                          const w = parseInt(parts[0]);
                          const h = parseInt(parts[1]);
                          const minDim = Math.min(w, h);
                          setSelectedResolution(minDim >= 1400 ? "2K" : "1K");
                        }
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <ImageLightbox
            isOpen={!!previewImage}
            imageUrl={previewImage?.image_url || ""}
            alt={previewImage?.prompt || ""}
            onClose={() => setPreviewImage(null)}
            onDownload={
              previewImage
                ? () => handleDownload(previewImage.image_url, previewImage.id)
                : undefined
            }
          />

          {images.length === 0 && !isLoading && (
            <div className="text-center py-12 text-text-tertiary">
              <ImageIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>还没有生成过图片</p>
              <p className="text-sm mt-1">在上方输入描述开始创作吧</p>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="删除图片"
        description="确定要删除这张图片吗？此操作不可撤销。"
        confirmText="删除"
        cancelText="取消"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
        variant="danger"
      />
    </div>
  );
}

// 单个图片卡片组件
function ImageCard({
  image,
  isDeleting,
  onDelete,
  onDownload,
  onPreview,
  onReuse,
}: {
  image: GeneratedImage & { status?: string };
  isDeleting: boolean;
  onDelete: (id: number) => void;
  onDownload: (url: string, id: number) => void;
  onPreview: () => void;
  onReuse: (prompt: string, size: string, referenceImageUrl?: string) => void;
}) {
  const isPending = image.status === "pending";
  const isFailed = image.status === "failed";

  return (
    <div className={cn(
      "group bg-surface-card rounded-xl border border-surface-border overflow-hidden hover:border-brand/30 transition-all duration-300",
      isDeleting && "opacity-0 scale-95 pointer-events-none"
    )}>
      <div className="aspect-square bg-surface relative">
        {isPending ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-text-tertiary">
            <div className="relative">
              <Loader2 className="w-8 h-8 animate-spin text-brand/40" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Wand2 className="w-3.5 h-3.5 text-brand" />
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <Clock className="w-3 h-3" />
              <span>图片生成中...</span>
            </div>
            <p className="text-[11px] text-text-tertiary/60 max-w-[80%] text-center line-clamp-2 px-2">
              {image.prompt}
            </p>
          </div>
        ) : isFailed ? (
          <>
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-text-tertiary">
              <AlertCircle className="w-8 h-8 text-red-400/50" />
              <span className="text-xs text-red-400/70">生成失败</span>
              <p className="text-[11px] text-text-tertiary/60 max-w-[80%] text-center line-clamp-2 px-2">
                {image.prompt}
              </p>
            </div>
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onReuse(image.prompt, image.size, image.image_url);
                }}
                className="p-2 rounded-lg bg-surface-elevated/90 text-text-primary hover:bg-surface-card transition-colors"
                title="重新生成"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(image.id);
                }}
                className="p-2 rounded-lg bg-red-500/90 text-white hover:bg-red-500 transition-colors"
                title="删除"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </>
        ) : (
          <>
            <img
              src={image.image_url}
              alt={image.prompt}
              className="w-full h-full object-cover cursor-zoom-in"
              onClick={onPreview}
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onPreview();
                }}
                className="p-2 rounded-lg bg-surface-elevated/90 text-text-primary hover:bg-surface-card transition-colors"
                title="放大查看"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload(image.image_url, image.id);
                }}
                className="p-2 rounded-lg bg-surface-elevated/90 text-text-primary hover:bg-surface-card transition-colors"
                title="下载"
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onReuse(image.prompt, image.size, image.image_url);
                }}
                className="p-2 rounded-lg bg-surface-elevated/90 text-text-primary hover:bg-surface-card transition-colors"
                title="重新生成"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(image.id);
                }}
                className="p-2 rounded-lg bg-red-500/90 text-white hover:bg-red-500 transition-colors"
                title="删除"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </div>
      <div className="p-3">
        <p className="text-sm text-text-primary line-clamp-2">{image.prompt}</p>
        <div className="flex items-center justify-between mt-1">
          <p className="text-[11px] text-text-tertiary">
            {new Date(image.created_at).toLocaleString()}
          </p>
          {image.size && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-surface border border-surface-border text-text-tertiary">
                {image.size}
              </span>
              {(image as any).quality && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-surface border border-surface-border text-text-tertiary">
                  {(image as any).quality}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
