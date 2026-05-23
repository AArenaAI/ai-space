"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useImage } from "@/hooks/useImage";
import { useImageChats } from "@/hooks/useImageChat";
import { useImageModels, useVideoModels, ChatModel } from "@/hooks/useModels";
import { useVideo, VideoGeneration } from "@/hooks/useVideo";
import { GeneratedImage } from "@/hooks/useImage";
import ImageLightbox from "@/components/ui/ImageLightbox";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import HistoryDrawer from "@/components/ui/HistoryDrawer";
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
  Plus,
  History,
  Sparkles,
  Eraser,
  Type,
  Video,
  Music,
  Zap,
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

// 参考图堆叠组件
function ReferenceImageStack({
  images,
  onAdd,
  onRemove,
  uploading,
  onDropFile,
  model,
}: {
  images: string[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  uploading: boolean;
  onDropFile?: (file: File) => void;
  model?: ChatModel;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // 将 public_id 转为可预览的图片 URL
  const resolveImageUrl = (url: string) => {
    if (url.startsWith("file_")) {
      return `/api/files/${url}/view`;
    }
    return url;
  };

  // 无图：显示方形上传按钮
  if (images.length === 0) {
    return (
      <div
        className={cn(
          "relative shrink-0 w-9 h-16 rounded-xl bg-surface-card border border-surface-border flex items-center justify-center transition-all cursor-pointer hover:border-brand/40",
          uploading && "cursor-not-allowed opacity-60"
        )}
        onClick={onAdd}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const file = e.dataTransfer.files?.[0];
          if (file && onDropFile) onDropFile(file);
        }}
        title="上传参考图"
      >
        {uploading ? (
          <Loader2 className="w-4 h-4 text-gray-500 dark:text-text-tertiary animate-spin" />
        ) : (
          <Plus className="w-4 h-4 text-gray-500 dark:text-text-tertiary" />
        )}
      </div>
    );
  }

  // 单图：显示图片 + 左下角加号
  if (images.length === 1) {
    return (
      <div className="relative shrink-0 group/single">
        <div className="w-9 h-16 rounded-xl overflow-hidden border border-surface-border">
          <img src={resolveImageUrl(images[0])} alt="参考图" className="w-full h-full object-cover" />
        </div>
        {/* 删除按钮 - 悬浮时显示 */}
        <button
          type="button"
          onClick={() => onRemove(0)}
          className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-surface-elevated border border-surface-border shadow-md text-gray-500 dark:text-text-secondary hover:text-red-500 hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-950 flex items-center justify-center transition-all opacity-0 group-hover/single:opacity-100 z-20"
          title="删除"
        >
          <X className="w-3 h-3" />
        </button>
        {/* 加号按钮 */}
        <button
          type="button"
          onClick={onAdd}
          disabled={uploading}
          className="absolute -bottom-1.5 -right-1.5 w-5 h-5 rounded-full bg-surface-elevated border border-surface-border shadow-sm flex items-center justify-center hover:border-brand/50 hover:text-brand transition-all z-10"
        >
          {uploading ? (
            <Loader2 className="w-2.5 h-2.5 text-text-tertiary animate-spin" />
          ) : (
            <Plus className="w-3 h-3 text-text-tertiary" />
          )}
        </button>
      </div>
    );
  }

  // 多图：堆叠效果，悬浮展开
  return (
    <div
      className="relative shrink-0"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={cn(
          "flex items-center transition-all duration-300 ease-out",
          isHovered ? "gap-2 px-1" : "gap-0"
        )}
      >
        {images.map((url, idx) => {
          const isLast = idx === images.length - 1;
          // 堆叠时，后面的图向左偏移，形成堆叠
          const stackOffset = isHovered ? 0 : -idx * 14;
          const stackRotate = isHovered ? 0 : (idx % 2 === 0 ? 1 : -1) * (idx * 1.5);
          const zIndex = images.length - idx;

          return (
            <div
              key={`${url}-${idx}`}
              className={cn(
                "relative rounded-xl overflow-hidden border border-surface-border shadow-sm transition-all duration-300 ease-out group/item",
                isHovered ? "hover:scale-110 hover:shadow-lg hover:z-50" : ""
              )}
              style={{
                width: 36,
                height: 64,
                marginLeft: idx === 0 ? 0 : stackOffset,
                transform: `rotate(${stackRotate}deg)`,
                zIndex,
              }}
            >
              <img src={resolveImageUrl(url)} alt={`参考图 ${idx + 1}`} className="w-full h-full object-cover" />
              {/* 删除按钮 - 悬浮时显示 */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(idx);
                }}
                className={cn(
                  "absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-surface-elevated border border-surface-border shadow-md text-gray-500 dark:text-text-secondary hover:text-red-500 hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-950 flex items-center justify-center transition-all z-30",
                  isHovered ? "opacity-100" : "opacity-0 group-hover/item:opacity-100"
                )}
                title="删除"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* 悬浮展开后，最后加一个加号 */}
      {isHovered && (
        <button
          type="button"
          onClick={onAdd}
          disabled={uploading}
          className="absolute -right-6 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-surface-elevated border border-surface-border shadow-sm flex items-center justify-center hover:border-brand/50 hover:text-brand transition-all z-10"
          style={{ marginLeft: 8 }}
        >
          {uploading ? (
            <Loader2 className="w-3 h-3 text-text-tertiary animate-spin" />
          ) : (
            <Plus className="w-3.5 h-3.5 text-text-tertiary" />
          )}
        </button>
      )}
    </div>
  );
}

export default function ImagePage() {
  const router = useRouter();
  const { images, isGenerating, generateImage, deleteImage } = useImage();
  const { chats, loading: chatsLoading, fetchChats, deleteChat, updateChatTitle } = useImageChats();
  const { models: imageModels } = useImageModels();
  const { models: videoModels } = useVideoModels();
  const { videos, generating: videoGenerating, generateVideo, currentVideo, deleteVideo } = useVideo();
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
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [uploadingRef, setUploadingRef] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [mode, setMode] = useState<"image" | "video">("image");
  const [selectedDuration, setSelectedDuration] = useState("4s");
  const [durationMenuOpen, setDurationMenuOpen] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(false);
  const [videoModelMenuOpen, setVideoModelMenuOpen] = useState(false);
  const [selectedVideoModel, setSelectedVideoModel] = useState(videoModels[0]?.id || "doubao-seedance-2-0-fast-260128");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentVideoModel = videoModels.find((m) => m.id === selectedVideoModel) || videoModels[0];

  // 默认选第一个画图模型
  useEffect(() => {
    if (imageModels.length > 0 && !selectedModel) {
      setSelectedModel(imageModels[0].id);
    }
  }, [imageModels, selectedModel]);

  // 历史记录使用图像会话，而不是旧的单图生成记录
  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  const currentModel = imageModels.find((m) => m.id === selectedModel) || imageModels[0];
  const currentAspect = ASPECT_RATIOS.find((a) => a.value === selectedAspectRatio) || ASPECT_RATIOS[1];

  const hasContent = prompt.trim().length > 0;

  const uploadReferenceImage = useCallback(async (file: File) => {
    setUploadingRef(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const token = localStorage.getItem("token");
      const res = await fetch("/api/files/upload", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "上传失败");
      }
      const data = await res.json();
      // 使用 public_id 作为参考图标识（后端通过 file_ 前缀解析）
      const url = data.public_id || data.url || data.image_url;
      setReferenceImages((prev) => [...prev, url]);
    } catch (err: any) {
      toast.error(`上传失败: ${err.message}`);
    } finally {
      setUploadingRef(false);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    uploadReferenceImage(file);
  };

  const handleAddImage = () => {
    fileInputRef.current?.click();
  };

  const handleRemoveImage = (index: number) => {
    setReferenceImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error("请输入描述");
      return;
    }
    const params = new URLSearchParams();
    params.set("prompt", prompt.trim());
    params.set("aspect", selectedAspectRatio);
    if (referenceImages.length > 0) {
      params.set("refs", referenceImages.join(","));
    }

    if (mode === "video") {
      if (currentVideoModel?.id) params.set("model", currentVideoModel.id);
      params.set("duration", selectedDuration);
      if (musicEnabled) params.set("audio", "1");
      router.push(`/video/chat?${params.toString()}`);
      return;
    }

    params.set("resolution", selectedResolution);
    params.set("quality", selectedQuality);
    router.push(`/image/chat?${params.toString()}`);
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

  const historyItems = [
    ...chats.map((chat) => ({
      id: chat.id,
      title: chat.title || "AI画图会话",
      updated_at: chat.updated_at,
      icon: "image" as const,
      source: "image" as const,
      cover_image: chat.cover_image,
    })),
    ...videos
      .filter((video: VideoGeneration) => video.status !== "pending" && video.status !== "running")
      .map((video: VideoGeneration) => ({
        id: video.id,
        title: video.prompt || "AI视频任务",
        updated_at: video.updated_at || video.created_at,
        icon: "image" as const,
        source: "video" as const,
        status: video.status,
        cover_image: video.video_url,
      })),
  ].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  const handleOpenHistory = () => {
    const nextOpen = !showHistory;
    setShowHistory(nextOpen);
    if (nextOpen) fetchChats();
  };

  const handleSelectHistory = (id: number, item: { source?: "image" | "video" }) => {
    setShowHistory(false);
    if (item.source === "video") {
      router.push(`/video/chat?videoId=${id}`);
      return;
    }
    router.push(`/image/chat?chatId=${id}`);
  };

  const handleDeleteHistory = async (id: number, item: { source?: "image" | "video" }) => {
    try {
      if (item.source === "video") {
        await deleteVideo(id);
      } else {
        await deleteChat(id);
      }
      toast.success("删除成功");
    } catch {
      toast.error("删除失败");
    }
  };

  const handleRenameChat = async (id: number, title: string) => {
    try {
      await updateChatTitle(id, title);
      toast.success("重命名成功");
    } catch {
      toast.error("重命名失败");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* 顶部区域 */}
      <div className="shrink-0 flex flex-col items-center pt-8 pb-4 px-4">
        <div className="w-full max-w-3xl flex items-center justify-between">
          <div />
          <button
            onClick={handleOpenHistory}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-card transition-colors"
          >
            <History className="w-4 h-4" />
            <span>历史</span>
          </button>
        </div>

        <h1 className="text-3xl font-bold text-text-primary mt-8 mb-4">AI灵感创作器</h1>
        <div className="flex items-center justify-center mb-6">
          <div className="inline-flex items-center bg-surface-card rounded-full p-1 border border-surface-border">
            <button
              onClick={() => setMode("image")}
              className={cn(
                "flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium transition-all",
                mode === "image"
                  ? "bg-white text-text-primary shadow-sm dark:bg-surface-elevated"
                  : "text-text-tertiary hover:text-text-secondary"
              )}
            >
              <ImageIcon className="w-4 h-4" />
              图像
            </button>
            <button
              onClick={() => setMode("video")}
              className={cn(
                "flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium transition-all",
                mode === "video"
                  ? "bg-white text-text-primary shadow-sm dark:bg-surface-elevated"
                  : "text-text-tertiary hover:text-text-secondary"
              )}
            >
              <Video className="w-4 h-4" />
              视频
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 md:px-6 pb-8">
        <div className="max-w-3xl mx-auto space-y-10">
          {/* 输入卡片 */}
          <div
            className={cn(
              "relative flex flex-col rounded-2xl border transition-all duration-300",
              "bg-surface-card",
              referenceImages.length > 0
                ? "border-brand/20 focus-within:border-brand/40 focus-within:shadow-[0_0_0_1px_rgba(59,130,246,0.08)]"
                : "border-surface-border focus-within:border-brand/30 focus-within:shadow-[0_0_0_1px_rgba(59,130,246,0.06)]"
            )}
          >
            {/* 输入区：参考图 + textarea */}
            <div className="flex items-start gap-3 px-4 pt-3 pb-2">
              <div className="mt-1">
                <ReferenceImageStack
                  images={referenceImages}
                  onAdd={handleAddImage}
                  onRemove={handleRemoveImage}
                  uploading={uploadingRef}
                  onDropFile={uploadReferenceImage}
                  model={currentModel}
                />
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  mode === "video"
                    ? "尝试描述您想要创建的视频..."
                    : referenceImages.length > 0
                    ? "描述您想要对参考图进行的修改..."
                    : "尝试描述您想要创建的图像..."
                }
                disabled={isLoading || isGenerating || videoGenerating}
                className={cn(
                  "flex-1 min-h-[84px] max-h-[200px] bg-transparent text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none text-[15px] leading-relaxed py-2",
                  (isLoading || isGenerating || videoGenerating) && "opacity-60 cursor-not-allowed"
                )}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleGenerate();
                  }
                }}
              />
            </div>

            {/* 底部工具栏 */}
            <div className="flex items-center justify-between px-4 pb-3 pt-2">
              <div className="flex items-center gap-2 flex-wrap">
                {mode === "image" ? (
                  <>
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

                    {/* 质量选择 */}
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
                  </>
                ) : (
                  <>
                    {/* 视频模型选择 */}
                    <div className="relative">
                      <button
                        onClick={() => setVideoModelMenuOpen(!videoModelMenuOpen)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[13px] font-medium transition-all duration-200 border-surface-border text-text-secondary hover:text-text-primary hover:border-text-tertiary/50 bg-transparent"
                      >
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: currentVideoModel?.color || "#999" }}
                        />
                        <span>{currentVideoModel?.name || "选择模型"}</span>
                        <ChevronDown className="w-3 h-3" />
                      </button>
                      {videoModelMenuOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setVideoModelMenuOpen(false)} />
                          <div className="absolute top-full left-0 mt-1.5 w-56 z-50 rounded-xl border border-surface-border bg-surface-elevated shadow-xl py-1 animate-fade-in">
                            {videoModels.map((model: ChatModel) => (
                              <button
                                key={model.id}
                                onClick={() => {
                                  setSelectedVideoModel(model.id);
                                  setVideoModelMenuOpen(false);
                                }}
                                className={cn(
                                  "flex items-center gap-3 w-full px-3 py-2.5 text-sm transition-colors text-left",
                                  selectedVideoModel === model.id
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
                                </div>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    {/* 参考图像 */}
                    <button
                      onClick={handleAddImage}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[13px] font-medium transition-all duration-200 border-surface-border text-text-secondary hover:text-text-primary hover:border-text-tertiary/50 bg-transparent"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      <span>参考图像</span>
                    </button>

                    {/* 画幅|分辨率 */}
                    <div className="relative">
                      <button
                        onClick={() => setAspectMenuOpen(!aspectMenuOpen)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[13px] font-medium transition-all duration-200 border-surface-border text-text-secondary hover:text-text-primary hover:border-text-tertiary/50 bg-transparent"
                      >
                        <Layers className="w-3.5 h-3.5" />
                        <span>
                          {currentAspect.label} | {selectedResolution}
                        </span>
                        <ChevronDown className="w-3 h-3" />
                      </button>
                      {aspectMenuOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setAspectMenuOpen(false)} />
                          <div className="absolute top-full left-0 mt-1.5 w-[340px] z-50 rounded-xl border border-surface-border bg-surface-elevated shadow-xl p-4 animate-fade-in">
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

                    {/* 时长选择 */}
                    <div className="relative">
                      <button
                        onClick={() => setDurationMenuOpen(!durationMenuOpen)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[13px] font-medium transition-all duration-200 border-surface-border text-text-secondary hover:text-text-primary hover:border-text-tertiary/50 bg-transparent"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <span>{selectedDuration}</span>
                        <ChevronDown className="w-3 h-3" />
                      </button>
                      {durationMenuOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setDurationMenuOpen(false)} />
                          <div className="absolute top-full left-0 mt-1.5 w-28 z-50 rounded-xl border border-surface-border bg-surface-elevated shadow-xl py-1 animate-fade-in">
                            {["4s", "6s", "8s", "10s", "12s"].map((d) => (
                              <button
                                key={d}
                                onClick={() => {
                                  setSelectedDuration(d);
                                  setDurationMenuOpen(false);
                                }}
                                className={cn(
                                  "flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors text-left",
                                  selectedDuration === d
                                    ? "bg-brand/10 text-brand"
                                    : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                                )}
                              >
                                <span className="font-medium">{d}</span>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    {/* 音乐 */}
                    <button
                      onClick={() => setMusicEnabled(!musicEnabled)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[13px] font-medium transition-all duration-200",
                        musicEnabled
                          ? "border-purple-400/50 text-purple-500 bg-purple-500/10"
                          : "border-surface-border text-text-secondary hover:text-text-primary hover:border-text-tertiary/50 bg-transparent"
                      )}
                    >
                      <Music className="w-3.5 h-3.5" />
                      <span>音乐</span>
                    </button>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* 积分 */}
                <div className="flex items-center gap-1 text-[13px] text-text-secondary">
                  <Zap className="w-3.5 h-3.5 text-amber-500" />
                  <span>{mode === "video" ? "70" : "5"}</span>
                </div>

                {/* 发送按钮 */}
                {isLoading || isGenerating || (mode === "video" && videoGenerating) ? (
                  <button
                    disabled
                    className="flex items-center justify-center w-9 h-9 rounded-full bg-text-tertiary/30 text-white cursor-not-allowed"
                    title="生成中..."
                  >
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </button>
                ) : (
                  <button
                    onClick={handleGenerate}
                    disabled={!hasContent}
                    className={cn(
                      "flex items-center justify-center w-9 h-9 rounded-full transition-all duration-200",
                      hasContent
                        ? referenceImages.length > 0
                          ? "bg-brand text-white hover:bg-brand-hover shadow-[0_0_8px_rgba(59,130,246,0.25)]"
                          : "bg-brand text-white hover:bg-brand-hover"
                        : "bg-text-tertiary/20 text-text-tertiary cursor-not-allowed"
                    )}
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 视频结果展示 */}
          {mode === "video" && (
            <div className="space-y-4">
              {/* 当前正在生成的视频 */}
              {currentVideo && (currentVideo.status === "pending" || currentVideo.status === "running") && (
                <div className="bg-surface-card rounded-xl border border-surface-border p-6 flex flex-col items-center gap-3">
                  <Loader2 className="w-8 h-8 text-brand animate-spin" />
                  <p className="text-sm text-text-secondary">视频生成中... 请耐心等待</p>
                  <p className="text-xs text-text-tertiary line-clamp-1">{currentVideo.prompt}</p>
                </div>
              )}
            </div>
          )}

          {/* 图编工具入口 - 与AI画图摆在一起 */}
          <div className="mt-6 mb-2">
            <h3 className="text-base font-semibold text-text-primary mb-4">图像编辑</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { icon: Eraser, label: "背景移除", desc: "一键去除图片背景", mode: "remove-bg", color: "text-green-500", bg: "bg-green-500/10", border: "border-green-500/20" },
                { icon: Sparkles, label: "背景替换", desc: "AI生成新背景", mode: "replace-bg", color: "text-purple-500", bg: "bg-purple-500/10", border: "border-purple-500/20" },
                { icon: Type, label: "文字移除", desc: "去除水印和文字", mode: "text-removal", color: "text-orange-500", bg: "bg-orange-500/10", border: "border-orange-500/20" },
                { icon: ZoomIn, label: "画质提升", desc: "AI增强分辨率", mode: "upscale", color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20" },
              ].map((tool) => (
                <a
                  key={tool.mode}
                  href={`/image/edit?mode=${tool.mode}`}
                  className={cn(
                    "group flex flex-col items-start gap-2 p-4 rounded-2xl border transition-all duration-200 hover:shadow-md",
                    "bg-surface-card border-surface-border hover:border-brand/30"
                  )}
                >
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", tool.bg)}>
                    <tool.icon className={cn("w-5 h-5", tool.color)} />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-text-primary">{tool.label}</div>
                    <div className="text-xs text-text-tertiary mt-0.5">{tool.desc}</div>
                  </div>
                </a>
              ))}
            </div>
          </div>

          {/* 示例图库 - 总是显示，放在输入框下方 */}
          <ExampleGallery onUsePrompt={(p: string) => { setPrompt(p); }} />

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

          {/* 历史记录右侧抽屉：合并展示图像会话与视频任务 */}
          <HistoryDrawer
            isOpen={showHistory}
            onClose={() => setShowHistory(false)}
            title="历史记录"
            type="image"
            loading={chatsLoading}
            items={historyItems}
            onSelect={handleSelectHistory}
            onNew={() => {
              setShowHistory(false);
              router.push(mode === "video" ? "/video/chat" : "/image/chat");
            }}
            onRename={handleRenameChat}
            onDelete={handleDeleteHistory}
          />
        </div>
      </div>
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
  onReuse: (prompt: string, size: string, referenceImageUrls?: string[]) => void;
}) {
  const isPending = image.status === "pending";
  const isFailed = image.status === "failed";

  return (
    <div
      className={cn(
        "group bg-surface-card rounded-xl border border-surface-border overflow-hidden hover:border-brand/30 transition-all duration-300",
        isDeleting && "opacity-0 scale-95 pointer-events-none"
      )}
    >
      <div className="aspect-square bg-surface relative">
        {isPending ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-text-tertiary">
            <div className="relative w-16 h-16 flex items-center justify-center">
              {/* 扩散环 */}
              <div className="absolute inset-0 rounded-full border-2 border-brand/30 animate-logo-ring" />
              <div className="absolute inset-0 rounded-full border-2 border-brand/20 animate-logo-ring" style={{ animationDelay: "0.9s" }} />
              {/* Logo */}
              <img
                src="/brand-dark-logo.png"
                alt="AI Space"
                className="relative w-10 h-10 object-contain animate-logo-breathe"
              />
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
                  onReuse(image.prompt, image.size, []);
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
                  onReuse(image.prompt, image.size, []);
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

// ───────────────────────── 示例画廊组件 ─────────────────────────
interface GalleryItem {
  prompt: string;
  imageUrl: string;
}

const GALLERY_ITEMS: GalleryItem[] = [
  {
    prompt: "nostalgic backrooms aesthetic",
    imageUrl: "/examples/discover/nostalgic-backrooms-aesthetic.png",
  },
  {
    prompt: "holy cathedral of light",
    imageUrl: "/examples/discover/holy-cathedral-of-light.png",
  },
  {
    prompt: "early 2000s mall photography",
    imageUrl: "/examples/discover/early-2000s-mall-photography.png",
  },
  {
    prompt: "2003 internet aesthetic",
    imageUrl: "/examples/discover/2003-internet-aesthetic.png",
  },
  {
    prompt: "luxury lifestyle photography",
    imageUrl: "/examples/discover/luxury-lifestyle-photography.png",
  },
  {
    prompt: "cinematic lighting",
    imageUrl: "/examples/discover/cinematic-lighting.png",
  },
  {
    prompt: "japanese street fashion editorial",
    imageUrl: "/examples/discover/japanese-street-fashion-editorial.png",
  },
  {
    prompt: "xianxia fantasy world",
    imageUrl: "/examples/discover/xianxia-fantasy-world.png",
  },
  {
    prompt: "dreamy pastel world",
    imageUrl: "/examples/discover/dreamy-pastel-world.png",
  },
  {
    prompt: "abstract liquid metal art",
    imageUrl: "/examples/discover/abstract-liquid-metal-art.png",
  },
  {
    prompt: "boss fight cinematic screenshot",
    imageUrl: "/examples/discover/boss-fight-cinematic-screenshot.png",
  },
  {
    prompt: "minimalist movie poster",
    imageUrl: "/examples/discover/minimalist-movie-poster.png",
  },
  {
    prompt: "procedural low poly sandbox world editor, floating islands connected by bridges, modular buildings, stylized terrain blocks, colorful biomes, tiny civilization, cute fantasy structures, cinematic lighting, world-building showcase, voxel-inspired low poly aesthetic, clean geometry, miniature simulation world, god game perspective",
    imageUrl: "/examples/discover/low-poly-sandbox-world-editor.png",
  },
  {
    prompt: "moody black and white photography",
    imageUrl: "/examples/discover/moody-black-and-white-photography.png",
  },
  {
    prompt: "cute anime cafe aesthetic",
    imageUrl: "/examples/discover/cute-anime-cafe-aesthetic.png",
  },
  {
    prompt: "Japan Travel Route Map",
    imageUrl: "/examples/discover/japan-travel-route-map.png",
  },
  {
    prompt: "Create a one-page action comic story.",
    imageUrl: "/examples/discover/one-page-action-comic-story.png",
  },
  {
    prompt: "Help me design an anime character.",
    imageUrl: "/examples/discover/anime-character-design.png",
  },
  {
    prompt: "Douyin app live streaming interface",
    imageUrl: "/examples/discover/douyin-live-streaming-interface.png",
  },
  {
    prompt: "Music app user interface",
    imageUrl: "/examples/discover/music-app-user-interface.png",
  },
  {
    prompt: "A well-dressed businessman in suit sitting at cozy coffee shop, working on laptop, sunlight streaming through window, warm tones, 4k photorealistic",
    imageUrl: "https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=600&h=400&fit=crop&crop=face",
  },
  {
    prompt: "Mountain landscape at sunset, dramatic sky, clouds painted in orange and pink, pine trees silhouette, cinematic, National Geographic style",
    imageUrl: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&h=300&fit=crop&crop=entropy",
  },
  {
    prompt: "Fluffy white cat sitting on a wooden table, green eyes, soft natural lighting, shallow depth of field, ultra realistic",
    imageUrl: "https://images.unsplash.com/photo-1513360371669-4adf3dd7dff8?w=600&h=700&fit=crop&crop=face",
  },
  {
    prompt: "Delicious gourmet burger with fresh ingredients, sesame bun, melted cheese, crispy bacon, food photography, mouth-watering detail",
    imageUrl: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&h=400&fit=crop&crop=entropy",
  },
  {
    prompt: "Abstract geometric shapes with vibrant neon colors, 3D rendered art, smooth gradients on dark background, modern aesthetic",
    imageUrl: "https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=600&h=600&fit=crop&crop=entropy",
  },
  {
    prompt: "Ethereal fantasy forest with glowing mushrooms, ancient trees wrapped in vines, magical blue particles floating in mist, moonlight beams",
    imageUrl: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&h=750&fit=crop&crop=entropy",
  },
  {
    prompt: "Modern minimalist interior design, open concept living room with large windows, neutral colors, warm wood accents, architectural digest style",
    imageUrl: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=600&h=350&fit=crop&crop=entropy",
  },
  // ── 新增模板 8-20 ──
  {
    prompt: "Japanese cherry blossom trees along a riverside path at spring, petals falling in wind, soft pink tones, anime style, Studio Ghibli aesthetic",
    imageUrl: "https://images.unsplash.com/photo-1522383225653-ed111181a951?w=600&h=450&fit=crop&crop=entropy",
  },
  {
    prompt: "Majestic wolf standing on a rocky cliff under full moon, howling at the night sky, dramatic lighting, dark fantasy, ultra detailed",
    imageUrl: "https://images.unsplash.com/photo-1568572933382-74d440642117?w=600&h=480&fit=crop&crop=entropy",
  },
  {
    prompt: "Vibrant underwater coral reef with tropical fish swimming through sun rays, crystal clear water, ocean photography, National Geographic",
    imageUrl: "https://images.unsplash.com/photo-1546026423-cc4642628d2b?w=600&h=400&fit=crop&crop=entropy",
  },
  {
    prompt: "A cup of matcha latte with beautiful latte art on a wooden table, morning sunlight, cozy cafe atmosphere, food photography, macro detail",
    imageUrl: "https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=600&h=450&fit=crop&crop=entropy",
  },
  {
    prompt: "Neon-lit Tokyo street at night, rain reflecting colorful signs, crowded crosswalk, cyberpunk aesthetic, vaporwave tones, cinematic shot",
    imageUrl: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=600&h=400&fit=crop&crop=entropy",
  },
  {
    prompt: "Elegant glass skyscraper architecture against blue sky, modern cityscape, geometric patterns, corporate photography, sharp details",
    imageUrl: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=600&h=500&fit=crop&crop=entropy",
  },
  {
    prompt: "Vintage motorcycle parked on a desert road at sunset, long shadows, warm golden tones, retro aesthetic, adventure vibe, cinematic wide shot",
    imageUrl: "https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=600&h=380&fit=crop&crop=entropy",
  },
  {
    prompt: "Close-up of a hummingbird hovering near a pink flower, wings frozen in motion, green bokeh background, macro wildlife photography, high speed",
    imageUrl: "https://images.unsplash.com/photo-1552728089-57bdde30beb3?w=600&h=600&fit=crop&crop=face",
  },
  {
    prompt: "Luxury bedroom interior with large windows overlooking ocean, white curtains flowing in breeze, king size bed, resort style, serene atmosphere",
    imageUrl: "https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=600&h=420&fit=crop&crop=entropy",
  },
  {
    prompt: "Crystal clear mountain lake reflecting snowy peaks at dawn, calm water mirror image, pine forest shoreline, peaceful nature landscape, wide angle",
    imageUrl: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=600&h=400&fit=crop&crop=entropy",
  },
];

function ExampleGallery({ onUsePrompt }: { onUsePrompt: (prompt: string) => void }) {
  return (
    <div className="mt-6 mb-4">
      <h3 className="text-base font-semibold text-text-primary mb-4">发现</h3>
      <div className="columns-2 md:columns-4 gap-4 space-y-4">
        {GALLERY_ITEMS.map((item, i) => (
          <div
            key={i}
            className="group cursor-pointer rounded-2xl overflow-hidden bg-surface-card border border-surface-border hover:border-brand/40 transition-all duration-200 break-inside-avoid"
            onClick={() => onUsePrompt(item.prompt)}
          >
            <div className="relative overflow-hidden bg-surface-secondary/50">
              <img
                src={item.imageUrl}
                alt={item.prompt}
                className="w-full h-auto block transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                <span className="flex items-center gap-1.5 bg-white text-gray-900 px-4 py-2 rounded-xl text-sm font-medium">
                  <Sparkles className="w-4 h-4" />
                  使用模板
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
