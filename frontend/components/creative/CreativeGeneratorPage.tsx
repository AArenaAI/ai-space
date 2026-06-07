"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useImage } from "@/hooks/useImage";
import { useImageChats } from "@/hooks/useImageChat";
import { useImageModels, useVideoModels, ChatModel } from "@/hooks/useModels";
import { useVideo } from "@/hooks/useVideo";
import { useVideoChats } from "@/hooks/useVideoChat";
import { GeneratedImage } from "@/hooks/useImage";
import ImageLightbox from "@/components/ui/ImageLightbox";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import CreationHistoryPanel from "@/components/creative/CreationHistoryPanel";
import {
  ImageIcon,
  Loader2,
  Trash2,
  Download,
  RefreshCw,
  ChevronDown,
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
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { getErrorMessage, readApiError, showUserError } from "@/lib/errors";
import { getClipboardFiles } from "@/lib/clipboardFiles";

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

const VIDEO_ASPECT_RATIOS = [
  { value: "16:9", label: "16:9", w: 16, h: 9 },
  { value: "4:3", label: "4:3", w: 4, h: 3 },
  { value: "1:1", label: "1:1", w: 1, h: 1 },
  { value: "3:4", label: "3:4", w: 3, h: 4 },
  { value: "9:16", label: "9:16", w: 9, h: 16 },
  { value: "21:9", label: "21:9", w: 21, h: 9 },
  { value: "adaptive", label: "adaptive", w: 1, h: 1 },
];

const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"];
const VIDEO_DURATIONS = ["4s", "5s", "6s", "7s", "9s", "10s", "11s", "13s", "14s", "15s"];
const MAX_REFERENCE_VIDEO_SIZE = 200 * 1024 * 1024;


const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"];
const VIDEO_EXTENSIONS = [".mp4", ".mov"];
const VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime"];

function fileExtension(file: File) {
  const dot = file.name.lastIndexOf(".");
  return dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
}

function isImageFile(file: File) {
  return file.type.startsWith("image/") || IMAGE_EXTENSIONS.includes(fileExtension(file));
}

function isVideoFile(file: File) {
  const ext = fileExtension(file);
  return file.type.startsWith("video/") || VIDEO_EXTENSIONS.includes(ext);
}

function isSupportedReferenceFile(file: File, mode: "image" | "video") {
  if (isImageFile(file)) return true;
  if (mode === "video" && isVideoFile(file)) return true;
  return false;
}

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
        active ? "border-text-primary bg-surface-card shadow-sm" : "border-text-tertiary/30"
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
  uploadTip,
}: {
  images: string[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  uploading: boolean;
  onDropFile?: (file: File) => void;
  model?: ChatModel;
  uploadTip?: string;
}) {
  const { t } = useI18n();
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
          "relative shrink-0 w-11 h-20 rounded-xl bg-surface-card border border-surface-border flex items-center justify-center transition-all cursor-pointer hover:border-brand/40",
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
        title={t("image.uploadReference")}
      >
        {uploading ? (
          <Loader2 className="w-4 h-4 text-gray-500 dark:text-text-tertiary animate-spin" />
        ) : (
          <Plus className="w-4 h-4 text-gray-500 dark:text-text-tertiary" />
        )}
        {uploadTip && (
          <div
            className="absolute -right-1 -top-1 z-20 flex h-4 w-4 items-center justify-center rounded-full border border-surface-border bg-surface-elevated text-[9px] font-medium leading-none text-text-tertiary/70 group/upload-tip"
            onClick={(e) => e.stopPropagation()}
          >
            !
            <div className="pointer-events-none absolute left-full top-0 z-30 ml-2 hidden w-64 whitespace-pre-line rounded-xl border border-surface-border bg-surface-elevated px-3 py-2 text-[11px] leading-5 text-text-secondary shadow-lg group-hover/upload-tip:block">
              {uploadTip}
            </div>
          </div>
        )}
      </div>
    );
  }

  // 单图：显示图片 + 左下角加号
  if (images.length === 1) {
    return (
      <div className="relative shrink-0 group/single">
        <div className="w-11 h-20 rounded-xl overflow-hidden border border-surface-border">
          <img src={resolveImageUrl(images[0])} alt={t("image.referenceAlt")} className="w-full h-full object-cover" />
        </div>
        {/* 删除按钮 - 悬浮时显示 */}
        <button
          type="button"
          onClick={() => onRemove(0)}
          className="absolute -right-2 -top-2 z-30 flex h-5 w-5 items-center justify-center rounded-full border border-surface-border bg-surface-elevated text-gray-500 shadow-md transition-all opacity-0 group-hover/single:opacity-100 hover:border-red-400 hover:bg-red-50 hover:text-red-500 dark:text-text-secondary dark:hover:bg-red-950"
          title={t("common.delete")}
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
                "relative overflow-visible rounded-xl transition-all duration-300 ease-out group/item",
                isHovered ? "hover:scale-110 hover:z-50" : ""
              )}
              style={{
                width: 44,
                height: 80,
                marginLeft: idx === 0 ? 0 : stackOffset,
                transform: `rotate(${stackRotate}deg)`,
                zIndex,
              }}
            >
              <div className="h-full w-full overflow-hidden rounded-xl border border-surface-border shadow-sm transition-shadow group-hover/item:shadow-lg">
                <img src={resolveImageUrl(url)} alt={`${t("image.referenceAlt")} ${idx + 1}`} className="w-full h-full object-cover" />
              </div>
              {/* 删除按钮 - 悬浮时显示 */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(idx);
                }}
                className={cn(
                  "absolute -right-2 -top-2 z-[60] flex h-5 w-5 items-center justify-center rounded-full border border-surface-border bg-surface-elevated text-gray-500 shadow-md transition-all hover:border-red-400 hover:bg-red-50 hover:text-red-500 dark:text-text-secondary dark:hover:bg-red-950",
                  isHovered ? "opacity-100" : "opacity-0 group-hover/item:opacity-100"
                )}
                title={t("common.delete")}
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

export default function CreativeGeneratorPage({ defaultMode = "image" }: { defaultMode?: "image" | "video" }) {
  const router = useRouter();
  const { t } = useI18n();
  const { images, isGenerating, generateImage, deleteImage } = useImage();
  const { chats, loading: chatsLoading, fetchChats, deleteChat, updateChatTitle } = useImageChats();
  const {
    chats: videoChats,
    fetchChats: fetchVideoChats,
    deleteChat: deleteVideoChat,
  } = useVideoChats();
  const { models: imageModels } = useImageModels();
  const { models: videoModels } = useVideoModels();
  const { generating: videoGenerating, currentVideo } = useVideo();
  const [prompt, setPrompt] = useState("");
  const [selectedAspectRatio, setSelectedAspectRatio] = useState("auto");
  const [selectedResolution, setSelectedResolution] = useState("1K");
  const [selectedVideoAspectRatio, setSelectedVideoAspectRatio] = useState("adaptive");
  const [selectedVideoResolution, setSelectedVideoResolution] = useState("720p");
  const [selectedModel, setSelectedModel] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);
  const [selectedQuality, setSelectedQuality] = useState("medium");
  const [previewImage, setPreviewImage] = useState<GeneratedImage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [deletingIds, setDeletingIds] = useState<number[]>([]);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [referenceVideos, setReferenceVideos] = useState<string[]>([]);
  const [uploadingRef, setUploadingRef] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const uploadInFlightRef = useRef(false);
  const [showHistory, setShowHistory] = useState(false);
  const [mode, setMode] = useState<"image" | "video">(defaultMode);
  const [selectedDuration, setSelectedDuration] = useState("5s");
  const [durationMenuOpen, setDurationMenuOpen] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(false);
  const [videoModelMenuOpen, setVideoModelMenuOpen] = useState(false);
  const [selectedVideoModel, setSelectedVideoModel] = useState(videoModels[0]?.id || "doubao-seedance-2-0-fast-260128");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentVideoModel = videoModels.find((m) => m.id === selectedVideoModel) || videoModels[0];
  const isFastVideoModel = (currentVideoModel?.id || selectedVideoModel).includes("seedance-2-0-fast");
  const availableVideoResolutions = isFastVideoModel ? VIDEO_RESOLUTIONS.filter((res) => res !== "1080p") : VIDEO_RESOLUTIONS;

  // 默认选第一个画图模型
  useEffect(() => {
    if (imageModels.length > 0 && !selectedModel) {
      setSelectedModel(imageModels[0].id);
    }
  }, [imageModels, selectedModel]);

  // 历史记录使用图像会话 + 视频会话，而不是旧的单次生成任务
  useEffect(() => {
    fetchChats();
    fetchVideoChats();
  }, [fetchChats, fetchVideoChats]);

  const currentModel = imageModels.find((m) => m.id === selectedModel) || imageModels[0];
  const currentAspect = ASPECT_RATIOS.find((a) => a.value === selectedAspectRatio) || ASPECT_RATIOS[0];
  const currentVideoAspect = VIDEO_ASPECT_RATIOS.find((a) => a.value === selectedVideoAspectRatio) || VIDEO_ASPECT_RATIOS[VIDEO_ASPECT_RATIOS.length - 1];

  const hasContent = prompt.trim().length > 0;
  const uploadLimitTip = mode === "video"
    ? t("video.uploadLimitTip")
    : t("image.uploadLimitTip");

  useEffect(() => {
    if (isFastVideoModel && selectedVideoResolution === "1080p") {
      setSelectedVideoResolution("720p");
    }
  }, [isFastVideoModel, selectedVideoResolution]);

  const resetDragState = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDragActive(false);
  }, []);

  useEffect(() => {
    const handleGlobalDragEnd = () => resetDragState();
    const handleGlobalDrop = () => resetDragState();
    window.addEventListener("dragend", handleGlobalDragEnd);
    window.addEventListener("drop", handleGlobalDrop);
    return () => {
      window.removeEventListener("dragend", handleGlobalDragEnd);
      window.removeEventListener("drop", handleGlobalDrop);
    };
  }, [resetDragState]);

  const uploadReferenceMedia = useCallback(async (input: File | File[]) => {
    const files = (Array.isArray(input) ? input : [input]).filter(Boolean);
    if (files.length === 0) return;
    if (uploadInFlightRef.current) {
      toast.info(t("image.uploadInProgress"));
      return;
    }

    const validFiles: File[] = [];
    for (const file of files) {
      const isImage = isImageFile(file);
      const isVideo = isVideoFile(file);

      if (!isSupportedReferenceFile(file, mode)) {
        toast.error(mode === "video" ? t("video.referenceMediaFormat") : t("image.referenceImageFormat"));
        continue;
      }

      if (isImage && file.size > 20 * 1024 * 1024) {
        toast.error(t("image.referenceImageSize"));
        continue;
      }

      if (mode === "video" && isVideo) {
        const ext = fileExtension(file);
        if (!(VIDEO_MIME_TYPES.includes(file.type) || VIDEO_EXTENSIONS.includes(ext))) {
          toast.error(t("video.referenceVideoFormat"));
          continue;
        }
        if (file.size > MAX_REFERENCE_VIDEO_SIZE) {
          toast.error(t("video.referenceVideoSize"));
          continue;
        }
      }

      validFiles.push(file);
    }

    if (validFiles.length === 0) return;

    uploadInFlightRef.current = true;
    setUploadingRef(true);
    try {
      const uploadedImages: string[] = [];
      const uploadedVideos: string[] = [];

      for (const file of validFiles) {
        const formData = new FormData();
        formData.append("file", file);
        const token = localStorage.getItem("token");
        const res = await fetch("/api/files/upload", {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        });
        if (!res.ok) {
          throw await readApiError(res);
        }
        const data = await res.json();
        const url = data.public_id || data.url || data.image_url;
        if (!url) {
          throw new Error(t("image.uploadInvalidResponse"));
        }

        if (mode === "video" && isVideoFile(file) && !isImageFile(file)) {
          uploadedVideos.push(url);
        } else {
          uploadedImages.push(url);
        }
      }

      if (uploadedImages.length > 0) {
        setReferenceImages((prev) => [...prev, ...uploadedImages]);
      }
      if (uploadedVideos.length > 0) {
        setReferenceVideos((prev) => [...prev, ...uploadedVideos]);
      }
      toast.success(validFiles.length > 1 ? t("image.uploadMultipleSuccess") : t("image.uploadSuccess"));
    } catch (err) {
      showUserError(err, {
        module: "file",
        fallbackTitle: t("image.uploadFailed"),
        fallbackMessage: mode === "video" ? "参考素材上传失败，请重新上传。" : "参考图上传失败，请重新选择图片。",
      });
    } finally {
      uploadInFlightRef.current = false;
      setUploadingRef(false);
      resetDragState();
    }
  }, [mode, resetDragState, t]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    uploadReferenceMedia(files);
  };

  const handleReferenceDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    resetDragState();
    const files = Array.from(e.dataTransfer.files || []).filter((file) => isSupportedReferenceFile(file, mode));
    if (files.length === 0) {
      toast.error(mode === "video" ? t("video.referenceMediaFormat") : t("image.referenceImageFormat"));
      return;
    }
    uploadReferenceMedia(files);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = getClipboardFiles(e);
    if (files.length === 0) return;
    e.preventDefault();
    uploadReferenceMedia(files);
  };

  const handleAddImage = () => {
    fileInputRef.current?.click();
  };

  const handleRemoveImage = (index: number) => {
    setReferenceImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRemoveVideo = (index: number) => {
    setReferenceVideos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error(t("image.enterPrompt"));
      return;
    }
    const params = new URLSearchParams();
    params.set("prompt", prompt.trim());
    if (referenceImages.length > 0) {
      params.set("refs", referenceImages.join(","));
    }

    if (mode === "video") {
      if (currentVideoModel?.id) params.set("model", currentVideoModel.id);
      params.set("aspect", selectedVideoAspectRatio);
      params.set("resolution", selectedVideoResolution);
      params.set("duration", selectedDuration);
      if (musicEnabled) params.set("audio", "1");
      if (referenceVideos.length > 0) {
        params.set("videoRefs", referenceVideos.join(","));
      }
      router.push(`/video/chat?${params.toString()}`);
      return;
    }

    params.set("aspect", selectedAspectRatio);
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
      toast.success(t("image.deleteSuccess"));
    } catch {
      toast.error(t("image.deleteFailed"));
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
      toast.success(t("image.downloadStarted"));
    } catch {
      toast.error(t("image.downloadFailed"));
    }
  };

  const handleUseImageAsReference = (url: string) => {
    setReferenceImages((prev) => (prev.includes(url) ? prev : [...prev, url]));
    setMode("image");
    toast.success(t("image.referenceInserted"));
  };

  const handleOpenImageTool = (mode: "remove-bg" | "replace-bg" | "text-removal" | "upscale" | "inpaint" | "region-brush", url: string) => {
    const params = new URLSearchParams({ mode, image: url });
    router.push(`/create?${params.toString()}`);
  };

  const historyItems = [
    ...chats.map((chat) => ({
      id: chat.id,
      title: chat.title || t("image.defaultChatTitle"),
      updated_at: chat.updated_at,
      icon: "image" as const,
      source: "image" as const,
      cover_image: chat.cover_image,
    })),
    ...videoChats.map((chat) => ({
      id: chat.id,
      title: chat.title || t("video.defaultChatTitle"),
      updated_at: chat.updated_at,
      icon: "image" as const,
      source: "video" as const,
      cover_image: chat.cover_video,
    })),
  ].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  const handleOpenHistory = () => {
    const nextOpen = !showHistory;
    setShowHistory(nextOpen);
    if (nextOpen) {
      fetchChats();
      fetchVideoChats();
    }
  };

  const handleSelectHistory = (id: number, item: { source?: "image" | "video" }) => {
    setShowHistory(false);
    if (item.source === "video") {
      router.push(`/video/chat?chatId=${id}`);
      return;
    }
    router.push(`/image/chat?chatId=${id}`);
  };

  const handleDeleteHistory = async (id: number, item: { source?: "image" | "video" }) => {
    try {
      if (item.source === "video") {
        await deleteVideoChat(id);
        await fetchVideoChats();
      } else {
        await deleteChat(id);
        await fetchChats();
      }
      toast.success(t("image.deleteSuccess"));
    } catch {
      await Promise.all([fetchChats(), fetchVideoChats()]);
      toast.error(t("image.deleteFailed"));
    }
  };

  const handleRenameChat = async (id: number, title: string) => {
    try {
      await updateChatTitle(id, title);
      toast.success(t("image.renameSuccess"));
    } catch {
      toast.error(t("image.renameFailed"));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept={mode === "video" ? "image/*,video/mp4,video/quicktime,.mp4,.mov" : "image/*,.jpg,.jpeg,.png,.webp,.gif,.bmp"}
        className="hidden"
        multiple
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
            <span>{t("common.history")}</span>
          </button>
        </div>

        <h1 className="text-3xl font-bold text-text-primary mt-8 mb-6">
          {mode === "video" ? t("video.title") : t("image.generateImage")}
        </h1>
      </div>

      <div className="flex-1 overflow-auto px-4 md:px-6 pb-8">
        <div className="max-w-3xl mx-auto space-y-10">
          {/* 输入卡片 */}
          <div
            className={cn(
              "relative flex flex-col rounded-2xl border transition-all duration-300",
              "bg-surface-card",
              isDragActive
                ? "border-brand/60 bg-brand/5 shadow-[0_0_0_1px_rgba(59,130,246,0.16)]"
                : referenceImages.length > 0 || referenceVideos.length > 0
                ? "border-brand/20 focus-within:border-brand/40 focus-within:shadow-[0_0_0_1px_rgba(59,130,246,0.08)]"
                : "border-surface-border focus-within:border-brand/30 focus-within:shadow-[0_0_0_1px_rgba(59,130,246,0.06)]"
            )}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (uploadingRef) return;
              dragDepthRef.current += 1;
              setIsDragActive(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer) e.dataTransfer.dropEffect = uploadingRef ? "none" : "copy";
              if (!uploadingRef && Array.from(e.dataTransfer?.types || []).includes("Files")) {
                setIsDragActive(true);
              }
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
              if (dragDepthRef.current === 0 || !e.currentTarget.contains(e.relatedTarget as Node | null)) {
                resetDragState();
              }
            }}
            onDrop={handleReferenceDrop}
          >
            {isDragActive && (
              <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border border-dashed border-brand/60 bg-surface-card/85 text-sm font-medium text-brand shadow-sm backdrop-blur-sm">
                {mode === "video" ? t("video.dropReferenceMedia") : t("image.dropReferenceImage")}
              </div>
            )}
            {/* 输入区：参考图 + textarea */}
            <div className="flex items-start gap-3 px-4 pt-3 pb-2">
              <div className="mt-1 flex gap-2">
                <ReferenceImageStack
                  images={referenceImages}
                  onAdd={handleAddImage}
                  onRemove={handleRemoveImage}
                  uploading={uploadingRef}
                  onDropFile={uploadReferenceMedia}
                  model={currentModel}
                  uploadTip={uploadLimitTip}
                />
                {mode === "video" && referenceVideos.map((url, idx) => (
                  <div key={`${url}-${idx}`} className="relative shrink-0 group/single">
                    <div className="w-11 h-20 rounded-xl overflow-hidden border border-surface-border bg-surface-elevated relative">
                      <video
                        src={url.startsWith("file_") ? `/api/files/${url}/view` : url}
                        className="w-full h-full object-cover"
                        muted
                        playsInline
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                        <Video className="w-4 h-4 text-white" />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveVideo(idx)}
                      className="absolute -right-2 -top-2 z-30 flex h-5 w-5 items-center justify-center rounded-full border border-surface-border bg-surface-elevated text-gray-500 shadow-md transition-all opacity-0 group-hover/single:opacity-100 hover:border-red-400 hover:bg-red-50 hover:text-red-500 dark:text-text-secondary dark:hover:bg-red-950"
                      title={t("common.delete")}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onPaste={handlePaste}
                placeholder={
                  mode === "video"
                    ? t("image.prompt.video")
                    : referenceImages.length > 0
                    ? t("image.prompt.edit")
                    : t("image.prompt.image")
                }
                disabled={isLoading || isGenerating || videoGenerating}
                className={cn(
                  "flex-1 min-h-[84px] max-h-[200px] bg-transparent text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none text-[15px] leading-relaxed py-2",
                  (isLoading || isGenerating || videoGenerating) && "opacity-60 cursor-not-allowed"
                )}
                onKeyDown={(e) => {
                  const nativeEvent = e.nativeEvent as KeyboardEvent;
                  if (nativeEvent.isComposing || nativeEvent.keyCode === 229) {
                    return;
                  }
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
                          <span>{currentModel?.name || t("image.selectModel")}</span>
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
                                      ? "bg-surface-card text-text-primary font-medium shadow-sm"
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
                            <div className="text-xs font-medium text-text-secondary mb-3">{t("image.aspectRatio")}</div>
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
                                        ? "bg-surface-card border-surface-border text-text-primary font-medium shadow-sm"
                                        : "bg-surface border-surface-border text-text-secondary hover:border-text-tertiary/50"
                                    )}
                                  >
                                    <AspectIcon w={ar.w} h={ar.h} active={active} />
                                    <span>{ar.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                            <div className="text-xs font-medium text-text-secondary mt-4 mb-2">{t("image.resolution")}</div>
                            <div className="flex gap-2">
                              {RESOLUTIONS.map((res) => (
                                <button
                                  key={res.value}
                                  onClick={() => setSelectedResolution(res.value)}
                                  className={cn(
                                    "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-xs transition-all duration-200",
                                    selectedResolution === res.value
                                      ? "bg-surface-card border-surface-border text-text-primary font-medium shadow-sm"
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
                              ? "bg-surface-card text-text-primary font-medium shadow-sm"
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
                        <span>{currentVideoModel?.name || t("image.selectModel")}</span>
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
                                    ? "bg-surface-card text-text-primary font-medium shadow-sm"
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
                      <span>{t("image.referenceImage")}</span>
                    </button>
                    {/* 画幅|清晰度 */}
                    <div className="relative">
                      <button
                        onClick={() => setAspectMenuOpen(!aspectMenuOpen)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[13px] font-medium transition-all duration-200 border-surface-border text-text-secondary hover:text-text-primary hover:border-text-tertiary/50 bg-transparent"
                      >
                        <Layers className="w-3.5 h-3.5" />
                        <span>
                          {currentVideoAspect.label} | {selectedVideoResolution}
                        </span>
                        <ChevronDown className="w-3 h-3" />
                      </button>
                      {aspectMenuOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setAspectMenuOpen(false)} />
                          <div className="absolute top-full left-0 mt-1.5 w-[340px] z-50 rounded-xl border border-surface-border bg-surface-elevated shadow-xl p-4 animate-fade-in">
                            <div className="text-xs font-medium text-text-secondary mb-3">{t("image.aspectRatio")}</div>
                            <div className="grid grid-cols-5 gap-2">
                              {VIDEO_ASPECT_RATIOS.map((ar) => {
                                const active = selectedVideoAspectRatio === ar.value;
                                return (
                                  <button
                                    key={ar.value}
                                    onClick={() => setSelectedVideoAspectRatio(ar.value)}
                                    className={cn(
                                      "flex flex-col items-center gap-1 px-1 py-2 rounded-lg border text-[10px] transition-all duration-200",
                                      active
                                        ? "bg-surface-card border-surface-border text-text-primary font-medium shadow-sm"
                                        : "bg-surface border-surface-border text-text-secondary hover:border-text-tertiary/50"
                                    )}
                                  >
                                    <AspectIcon w={ar.w} h={ar.h} active={active} />
                                    <span>{ar.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                            <div className="text-xs font-medium text-text-secondary mt-4 mb-2">{t("video.resolution")}</div>
                            <div className="flex gap-2">
                              {availableVideoResolutions.map((res) => (
                                <button
                                  key={res}
                                  onClick={() => setSelectedVideoResolution(res)}
                                  className={cn(
                                    "flex-1 flex items-center justify-center px-3 py-2 rounded-lg border text-xs font-semibold transition-all duration-200",
                                    selectedVideoResolution === res
                                      ? "bg-surface-card border-surface-border text-text-primary font-medium shadow-sm"
                                      : "bg-surface border-surface-border text-text-secondary hover:border-text-tertiary/50"
                                  )}
                                >
                                  {res}
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
                            {VIDEO_DURATIONS.map((d) => (
                              <button
                                key={d}
                                onClick={() => {
                                  setSelectedDuration(d);
                                  setDurationMenuOpen(false);
                                }}
                                className={cn(
                                  "flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors text-left",
                                  selectedDuration === d
                                    ? "bg-surface-card text-text-primary font-medium shadow-sm"
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
                      <span>{t("image.music")}</span>
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
                    title={t("image.generating")}
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

          {mode === "video" && (
            <div className="rounded-2xl border border-surface-border bg-surface-card/70 px-4 py-3 text-xs text-text-secondary">
              <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-text-primary">
                <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-brand/10 text-brand">
                  <AlertCircle className="h-3.5 w-3.5" />
                </div>
                <span>{t("video.notice.title")}</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {[
                  {
                    title: t("video.notice.safety.title"),
                    desc: t("video.notice.safety.desc"),
                  },
                  {
                    title: t("video.notice.reference.title"),
                    desc: t("video.notice.reference.desc"),
                  },
                  {
                    title: t("video.notice.video.title"),
                    desc: t("video.notice.video.desc"),
                  },
                  {
                    title: t("video.notice.params.title"),
                    desc: t("video.notice.params.desc"),
                  },
                ].map((item) => (
                  <div key={item.title} className="rounded-xl border border-surface-border/70 bg-surface-elevated/50 px-3 py-2.5">
                    <div className="mb-1 text-[12px] font-medium text-text-primary">{item.title}</div>
                    <p className="leading-relaxed text-text-tertiary">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 视频结果展示 */}
          {mode === "video" && (
            <div className="space-y-4">
              {/* 当前正在生成的视频 */}
              {currentVideo && (currentVideo.status === "pending" || currentVideo.status === "running") && (
                <div className="bg-surface-card rounded-xl border border-surface-border p-6 flex flex-col items-center gap-3">
                  <Loader2 className="w-8 h-8 text-brand animate-spin" />
                  <p className="text-sm text-text-secondary">{t("image.videoGenerating")}</p>
                  <p className="text-xs text-text-tertiary line-clamp-1">{currentVideo.prompt}</p>
                </div>
              )}
              {currentVideo && currentVideo.status === "failed" && (
                <div className="bg-surface-card rounded-xl border border-red-500/20 p-6 flex flex-col items-center gap-2 text-center">
                  <AlertCircle className="w-8 h-8 text-red-400/60" />
                  <p className="text-sm font-medium text-red-400">{t("video.generationFailed")}</p>
                  <p className="max-w-xl text-xs text-text-tertiary">
                    {getErrorMessage(currentVideo.error_message || t("video.failedTryLater"), { module: "video", fallbackMessage: t("video.failedTryLater") })}
                  </p>
                </div>
              )}
            </div>
          )}


          {/* 示例图库 - 仅图片生成页显示 */}
          {mode !== "video" && <ExampleGallery onUsePrompt={(p: string) => { setPrompt(p); }} t={t} />}

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
            title={t("image.deleteImageTitle")}
            description={t("image.deleteImageDesc")}
            confirmText={t("common.delete")}
            cancelText={t("common.cancel")}
            onConfirm={handleConfirmDelete}
            onCancel={() => setDeleteTarget(null)}
            variant="danger"
          />

          {/* 历史记录右侧抽屉：合并展示图像会话与视频任务 */}
          <CreationHistoryPanel
            isOpen={showHistory}
            onClose={() => setShowHistory(false)}
            title={t("common.history")}
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
  onUseImage,
  onEditImage,
}: {
  image: GeneratedImage & { status?: string };
  isDeleting: boolean;
  onDelete: (id: number) => void;
  onDownload: (url: string, id: number) => void;
  onPreview: () => void;
  onReuse: (prompt: string, size: string, referenceImageUrls?: string[]) => void;
  onUseImage: (url: string) => void;
  onEditImage: (mode: "remove-bg" | "replace-bg" | "text-removal" | "upscale" | "inpaint" | "region-brush", url: string) => void;
}) {
  const { t } = useI18n();
  const isPending = image.status === "pending";
  const isFailed = image.status === "failed";

  return (
    <div
      className={cn(
        "group bg-surface-card rounded-xl border border-surface-border overflow-hidden hover:border-brand/30 transition-all duration-300",
        isDeleting && "opacity-0 scale-95 pointer-events-none"
      )}
    >
      <div className="aspect-square bg-surface relative overflow-hidden">
        {isPending ? (
          <>
            <video
              src="/ai-space-loading.mp4"
              className="absolute inset-0 h-full w-full object-cover"
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
            />
            <div className="absolute inset-0 bg-black/25" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 px-4 text-center">
              <div className="flex items-center gap-1.5 rounded-full bg-black/35 px-3 py-1.5 text-xs text-white backdrop-blur-sm">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>{t("image.imageGenerating")}</span>
              </div>
              <p className="text-[11px] text-white/75 max-w-[80%] line-clamp-2">
                {image.prompt}
              </p>
            </div>
          </>
        ) : isFailed ? (
          <>
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-text-tertiary">
              <AlertCircle className="w-8 h-8 text-red-400/50" />
              <span className="text-xs text-red-400/70">{t("image.generationFailed")}</span>
              <p className="text-[11px] text-text-tertiary/60 max-w-[80%] text-center line-clamp-2 px-2">
                {getErrorMessage(image.error_message || t("video.failedTryLater"), { module: "image", fallbackMessage: t("video.failedTryLater") })}
              </p>
            </div>
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onReuse(image.prompt, image.size, []);
                }}
                className="p-2 rounded-lg bg-surface-elevated/90 text-text-primary hover:bg-surface-card transition-colors"
                title={t("common.regenerate")}
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(image.id);
                }}
                className="p-2 rounded-lg bg-red-500/90 text-white hover:bg-red-500 transition-colors"
                title={t("common.delete")}
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
            <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" />
            <div className="absolute right-3 top-3 z-10 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUseImage(image.image_url);
                }}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-text-tertiary/70 text-white backdrop-blur-md transition-colors hover:bg-text-secondary"
                title={t("image.useThisImage")}
              >
                <ImageIcon className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload(image.image_url, image.id);
                }}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-text-tertiary/70 text-white backdrop-blur-md transition-colors hover:bg-text-secondary"
                title={t("common.download")}
              >
                <Download className="w-4 h-4" />
              </button>
              <div className="group/menu relative" onClick={(e) => e.stopPropagation()}>
                <button
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-text-tertiary/70 text-white backdrop-blur-md transition-colors hover:bg-text-secondary"
                  title={t("common.moreActions")}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
                <div className="invisible absolute right-0 top-full z-20 mt-2 w-44 rounded-2xl border border-surface-border bg-surface-card p-2 opacity-0 shadow-xl transition-all duration-150 group-hover/menu:visible group-hover/menu:opacity-100">
                  {[
                    { label: t("image.edit.removeBg"), icon: Eraser, mode: "remove-bg" as const },
                    { label: t("image.edit.textRemoval"), icon: Type, mode: "text-removal" as const },
                    { label: t("image.edit.upscale"), icon: ZoomIn, mode: "upscale" as const },
                    { label: t("image.edit.replaceBg"), icon: ImageIcon, mode: "replace-bg" as const },
                  ].map((item) => (
                    <button
                      key={item.label}
                      onClick={() => onEditImage(item.mode, image.image_url)}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-text-primary transition-colors hover:bg-surface-elevated"
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
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
  fullImageUrl: string;
  width: number;
  height: number;
}

const GALLERY_ITEMS: GalleryItem[] = [
  {
    prompt: "nostalgic backrooms aesthetic",
    imageUrl: "/examples/discover/thumbs/nostalgic-backrooms-aesthetic.webp",
    fullImageUrl: "/examples/discover/full/nostalgic-backrooms-aesthetic.webp",
    width: 640,
    height: 427,
  },
  {
    prompt: "holy cathedral of light",
    imageUrl: "/examples/discover/thumbs/holy-cathedral-of-light.webp",
    fullImageUrl: "/examples/discover/full/holy-cathedral-of-light.webp",
    width: 640,
    height: 960,
  },
  {
    prompt: "early 2000s mall photography",
    imageUrl: "/examples/discover/thumbs/early-2000s-mall-photography.webp",
    fullImageUrl: "/examples/discover/full/early-2000s-mall-photography.webp",
    width: 640,
    height: 480,
  },
  {
    prompt: "2003 internet aesthetic",
    imageUrl: "/examples/discover/thumbs/2003-internet-aesthetic.webp",
    fullImageUrl: "/examples/discover/full/2003-internet-aesthetic.webp",
    width: 640,
    height: 640,
  },
  {
    prompt: "luxury lifestyle photography",
    imageUrl: "/examples/discover/thumbs/luxury-lifestyle-photography.webp",
    fullImageUrl: "/examples/discover/full/luxury-lifestyle-photography.webp",
    width: 640,
    height: 640,
  },
  {
    prompt: "cinematic lighting",
    imageUrl: "/examples/discover/thumbs/cinematic-lighting.webp",
    fullImageUrl: "/examples/discover/full/cinematic-lighting.webp",
    width: 640,
    height: 640,
  },
  {
    prompt: "japanese street fashion editorial",
    imageUrl: "/examples/discover/thumbs/japanese-street-fashion-editorial.webp",
    fullImageUrl: "/examples/discover/full/japanese-street-fashion-editorial.webp",
    width: 640,
    height: 960,
  },
  {
    prompt: "xianxia fantasy world",
    imageUrl: "/examples/discover/thumbs/xianxia-fantasy-world.webp",
    fullImageUrl: "/examples/discover/full/xianxia-fantasy-world.webp",
    width: 640,
    height: 960,
  },
  {
    prompt: "dreamy pastel world",
    imageUrl: "/examples/discover/thumbs/dreamy-pastel-world.webp",
    fullImageUrl: "/examples/discover/full/dreamy-pastel-world.webp",
    width: 640,
    height: 427,
  },
  {
    prompt: "abstract liquid metal art",
    imageUrl: "/examples/discover/thumbs/abstract-liquid-metal-art.webp",
    fullImageUrl: "/examples/discover/full/abstract-liquid-metal-art.webp",
    width: 640,
    height: 960,
  },
  {
    prompt: "boss fight cinematic screenshot",
    imageUrl: "/examples/discover/thumbs/boss-fight-cinematic-screenshot.webp",
    fullImageUrl: "/examples/discover/full/boss-fight-cinematic-screenshot.webp",
    width: 640,
    height: 640,
  },
  {
    prompt: "minimalist movie poster",
    imageUrl: "/examples/discover/thumbs/minimalist-movie-poster.webp",
    fullImageUrl: "/examples/discover/full/minimalist-movie-poster.webp",
    width: 640,
    height: 427,
  },
  {
    prompt: "procedural low poly sandbox world editor, floating islands connected by bridges, modular buildings, stylized terrain blocks, colorful biomes, tiny civilization, cute fantasy structures, cinematic lighting, world-building showcase, voxel-inspired low poly aesthetic, clean geometry, miniature simulation world, god game perspective",
    imageUrl: "/examples/discover/thumbs/low-poly-sandbox-world-editor.webp",
    fullImageUrl: "/examples/discover/full/low-poly-sandbox-world-editor.webp",
    width: 640,
    height: 640,
  },
  {
    prompt: "moody black and white photography",
    imageUrl: "/examples/discover/thumbs/moody-black-and-white-photography.webp",
    fullImageUrl: "/examples/discover/full/moody-black-and-white-photography.webp",
    width: 640,
    height: 640,
  },
  {
    prompt: "cute anime cafe aesthetic",
    imageUrl: "/examples/discover/thumbs/cute-anime-cafe-aesthetic.webp",
    fullImageUrl: "/examples/discover/full/cute-anime-cafe-aesthetic.webp",
    width: 640,
    height: 640,
  },
  {
    prompt: "Japan Travel Route Map",
    imageUrl: "/examples/discover/thumbs/japan-travel-route-map.webp",
    fullImageUrl: "/examples/discover/full/japan-travel-route-map.webp",
    width: 640,
    height: 640,
  },
  {
    prompt: "Create a one-page action comic story.",
    imageUrl: "/examples/discover/thumbs/one-page-action-comic-story.webp",
    fullImageUrl: "/examples/discover/full/one-page-action-comic-story.webp",
    width: 640,
    height: 640,
  },
  {
    prompt: "Help me design an anime character.",
    imageUrl: "/examples/discover/thumbs/anime-character-design.webp",
    fullImageUrl: "/examples/discover/full/anime-character-design.webp",
    width: 640,
    height: 640,
  },
  {
    prompt: "Douyin app live streaming interface",
    imageUrl: "/examples/discover/thumbs/douyin-live-streaming-interface.webp",
    fullImageUrl: "/examples/discover/full/douyin-live-streaming-interface.webp",
    width: 640,
    height: 640,
  },
  {
    prompt: "Music app user interface",
    imageUrl: "/examples/discover/thumbs/music-app-user-interface.webp",
    fullImageUrl: "/examples/discover/full/music-app-user-interface.webp",
    width: 640,
    height: 640,
  },
  {
    prompt: "A well-dressed businessman in suit sitting at cozy coffee shop, working on laptop, sunlight streaming through window, warm tones, 4k photorealistic",
    imageUrl: "/examples/discover/thumbs/a-well-dressed-businessman-in-suit-sitting-at-cozy-coffee-shop-w.webp",
    fullImageUrl: "/examples/discover/full/a-well-dressed-businessman-in-suit-sitting-at-cozy-coffee-shop-w.webp",
    width: 600,
    height: 400,
  },
  {
    prompt: "Mountain landscape at sunset, dramatic sky, clouds painted in orange and pink, pine trees silhouette, cinematic, National Geographic style",
    imageUrl: "/examples/discover/thumbs/mountain-landscape-at-sunset-dramatic-sky-clouds-painted-in-oran.webp",
    fullImageUrl: "/examples/discover/full/mountain-landscape-at-sunset-dramatic-sky-clouds-painted-in-oran.webp",
    width: 600,
    height: 300,
  },
  {
    prompt: "Fluffy white cat sitting on a wooden table, green eyes, soft natural lighting, shallow depth of field, ultra realistic",
    imageUrl: "/examples/discover/thumbs/fluffy-white-cat-sitting-on-a-wooden-table-green-eyes-soft-natur.webp",
    fullImageUrl: "/examples/discover/full/fluffy-white-cat-sitting-on-a-wooden-table-green-eyes-soft-natur.webp",
    width: 600,
    height: 700,
  },
  {
    prompt: "Delicious gourmet burger with fresh ingredients, sesame bun, melted cheese, crispy bacon, food photography, mouth-watering detail",
    imageUrl: "/examples/discover/thumbs/delicious-gourmet-burger-with-fresh-ingredients-sesame-bun-melte.webp",
    fullImageUrl: "/examples/discover/full/delicious-gourmet-burger-with-fresh-ingredients-sesame-bun-melte.webp",
    width: 600,
    height: 400,
  },
  {
    prompt: "Abstract geometric shapes with vibrant neon colors, 3D rendered art, smooth gradients on dark background, modern aesthetic",
    imageUrl: "/examples/discover/thumbs/abstract-geometric-shapes-with-vibrant-neon-colors-3d-rendered-a.webp",
    fullImageUrl: "/examples/discover/full/abstract-geometric-shapes-with-vibrant-neon-colors-3d-rendered-a.webp",
    width: 600,
    height: 600,
  },
  {
    prompt: "Ethereal fantasy forest with glowing mushrooms, ancient trees wrapped in vines, magical blue particles floating in mist, moonlight beams",
    imageUrl: "/examples/discover/thumbs/ethereal-fantasy-forest-with-glowing-mushrooms-ancient-trees-wra.webp",
    fullImageUrl: "/examples/discover/full/ethereal-fantasy-forest-with-glowing-mushrooms-ancient-trees-wra.webp",
    width: 600,
    height: 750,
  },
  {
    prompt: "Modern minimalist interior design, open concept living room with large windows, neutral colors, warm wood accents, architectural digest style",
    imageUrl: "/examples/discover/thumbs/modern-minimalist-interior-design-open-concept-living-room-with.webp",
    fullImageUrl: "/examples/discover/full/modern-minimalist-interior-design-open-concept-living-room-with.webp",
    width: 600,
    height: 350,
  },
  {
    prompt: "Japanese cherry blossom trees along a riverside path at spring, petals falling in wind, soft pink tones, anime style, Studio Ghibli aesthetic",
    imageUrl: "/examples/discover/thumbs/japanese-cherry-blossom-trees-along-a-riverside-path-at-spring-p.webp",
    fullImageUrl: "/examples/discover/full/japanese-cherry-blossom-trees-along-a-riverside-path-at-spring-p.webp",
    width: 600,
    height: 450,
  },
  {
    prompt: "Majestic wolf standing on a rocky cliff under full moon, howling at the night sky, dramatic lighting, dark fantasy, ultra detailed",
    imageUrl: "/examples/discover/thumbs/majestic-wolf-standing-on-a-rocky-cliff-under-full-moon-howling.webp",
    fullImageUrl: "/examples/discover/full/majestic-wolf-standing-on-a-rocky-cliff-under-full-moon-howling.webp",
    width: 600,
    height: 480,
  },
  {
    prompt: "Vibrant underwater coral reef with tropical fish swimming through sun rays, crystal clear water, ocean photography, National Geographic",
    imageUrl: "/examples/discover/thumbs/vibrant-underwater-coral-reef-with-tropical-fish-swimming-throug.webp",
    fullImageUrl: "/examples/discover/full/vibrant-underwater-coral-reef-with-tropical-fish-swimming-throug.webp",
    width: 600,
    height: 400,
  },
  {
    prompt: "A cup of matcha latte with beautiful latte art on a wooden table, morning sunlight, cozy cafe atmosphere, food photography, macro detail",
    imageUrl: "/examples/discover/thumbs/a-cup-of-matcha-latte-with-beautiful-latte-art-on-a-wooden-table.webp",
    fullImageUrl: "/examples/discover/full/a-cup-of-matcha-latte-with-beautiful-latte-art-on-a-wooden-table.webp",
    width: 600,
    height: 450,
  },
  {
    prompt: "Neon-lit Tokyo street at night, rain reflecting colorful signs, crowded crosswalk, cyberpunk aesthetic, vaporwave tones, cinematic shot",
    imageUrl: "/examples/discover/thumbs/neon-lit-tokyo-street-at-night-rain-reflecting-colorful-signs-cr.webp",
    fullImageUrl: "/examples/discover/full/neon-lit-tokyo-street-at-night-rain-reflecting-colorful-signs-cr.webp",
    width: 600,
    height: 400,
  },
  {
    prompt: "Elegant glass skyscraper architecture against blue sky, modern cityscape, geometric patterns, corporate photography, sharp details",
    imageUrl: "/examples/discover/thumbs/elegant-glass-skyscraper-architecture-against-blue-sky-modern-ci.webp",
    fullImageUrl: "/examples/discover/full/elegant-glass-skyscraper-architecture-against-blue-sky-modern-ci.webp",
    width: 600,
    height: 500,
  },
  {
    prompt: "Vintage motorcycle parked on a desert road at sunset, long shadows, warm golden tones, retro aesthetic, adventure vibe, cinematic wide shot",
    imageUrl: "/examples/discover/thumbs/vintage-motorcycle-parked-on-a-desert-road-at-sunset-long-shadow.webp",
    fullImageUrl: "/examples/discover/full/vintage-motorcycle-parked-on-a-desert-road-at-sunset-long-shadow.webp",
    width: 600,
    height: 380,
  },
  {
    prompt: "Close-up of a hummingbird hovering near a pink flower, wings frozen in motion, green bokeh background, macro wildlife photography, high speed",
    imageUrl: "/examples/discover/thumbs/close-up-of-a-hummingbird-hovering-near-a-pink-flower-wings-froz.webp",
    fullImageUrl: "/examples/discover/full/close-up-of-a-hummingbird-hovering-near-a-pink-flower-wings-froz.webp",
    width: 600,
    height: 600,
  },
  {
    prompt: "Luxury bedroom interior with large windows overlooking ocean, white curtains flowing in breeze, king size bed, resort style, serene atmosphere",
    imageUrl: "/examples/discover/thumbs/luxury-bedroom-interior-with-large-windows-overlooking-ocean-whi.webp",
    fullImageUrl: "/examples/discover/full/luxury-bedroom-interior-with-large-windows-overlooking-ocean-whi.webp",
    width: 600,
    height: 420,
  },
  {
    prompt: "Crystal clear mountain lake reflecting snowy peaks at dawn, calm water mirror image, pine forest shoreline, peaceful nature landscape, wide angle",
    imageUrl: "/examples/discover/thumbs/crystal-clear-mountain-lake-reflecting-snowy-peaks-at-dawn-calm.webp",
    fullImageUrl: "/examples/discover/full/crystal-clear-mountain-lake-reflecting-snowy-peaks-at-dawn-calm.webp",
    width: 600,
    height: 400,
  },
];

function ExampleGallery({ onUsePrompt, t }: { onUsePrompt: (prompt: string) => void; t: (key: string) => string }) {
  return (
    <div className="mt-6 mb-4">
      <h3 className="text-base font-semibold text-text-primary mb-4">{t("image.discover")}</h3>
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
                width={item.width}
                height={item.height}
                className="w-full h-auto block transition-transform duration-300 group-hover:scale-105"
                loading={i < 8 ? "eager" : "lazy"}
                fetchPriority={i < 8 ? "high" : "auto"}
                decoding="async"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                <span className="flex items-center gap-1.5 bg-white text-gray-900 px-4 py-2 rounded-xl text-sm font-medium">
                  <Sparkles className="w-4 h-4" />
                  {t("image.useTemplate")}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
