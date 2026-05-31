"use client";

import { Suspense } from "react";
import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useImageChats, useImageChatMessages, ImageChatMessage } from "@/hooks/useImageChat";
import { useImageModels } from "@/hooks/useModels";
import {
  Loader2,
  Send,
  ArrowLeft,
  ImageIcon,
  Plus,
  X,
  RefreshCw,
  Trash2,
  Copy,
  MessageSquarePlus,
  History,
  ChevronDown,
  Layers,
  Download,
  MoreHorizontal,
  Brush,
  Paintbrush,
  Eraser,
  Type,
  ZoomIn,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { emitTaskFinished, registerBackgroundTask } from "@/lib/taskNotifications";
import { normalizeError, readApiError, showUserError } from "@/lib/errors";
import { toast } from "sonner";
import ImageLightbox from "@/components/ui/ImageLightbox";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import NoticeDialog from "@/components/ui/NoticeDialog";
import CreationHistoryPanel from "@/components/creative/CreationHistoryPanel";
import DeleteSuccessNotice from "@/components/ui/DeleteSuccessNotice";

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

function cleanImageErrorMessage(raw: string | null | undefined, t: (key: string) => string): string {
  return normalizeError(raw || "", {
    module: "image",
    fallbackTitle: t("image.error.default"),
    fallbackMessage: t("image.error.default"),
  }).message;
}


function AspectIcon({ w, h, active }: { w: number; h: number; active: boolean }) {
  const isLandscape = w > h;
  const isPortrait = h > w;
  const maxDim = 28;
  let boxW = maxDim;
  let boxH = maxDim;
  if (isLandscape) {
    boxW = maxDim;
    boxH = Math.max(Math.round((maxDim * h) / w), 10);
  } else if (isPortrait) {
    boxH = maxDim;
    boxW = Math.max(Math.round((maxDim * w) / h), 10);
  }
  return (
    <div
      className={cn(
        "flex items-center justify-center w-8 h-8 rounded-md border transition-colors",
        active ? "border-surface-border bg-surface-card shadow-sm" : "border-surface-border bg-surface"
      )}
    >
      <div
        className={cn("rounded-sm border-2 transition-colors", active ? "border-text-primary bg-surface-card" : "border-text-tertiary/50")}
        style={{ width: boxW, height: boxH }}
      />
    </div>
  );
}

function ReferenceImageStack({
  images,
  onAdd,
  onRemove,
  uploading,
  onDropFile,
  t,
}: {
  images: string[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  uploading: boolean;
  onDropFile?: (file: File) => void;
  t: (key: string) => string;
}) {
  const [isHovered, setIsHovered] = useState(false);

  const resolveImageUrl = (url: string) => {
    if (url.startsWith("file_")) {
      return `/api/files/${url}/view`;
    }
    return url;
  };

  if (images.length === 0) {
    return (
      <div
        className={cn(
          "relative flex h-16 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-surface-border bg-surface-card transition-all hover:border-brand/40",
          uploading && "cursor-not-allowed opacity-60"
        )}
        onClick={onAdd}
        onDragOver={(e) => {
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
        {uploading ? <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" /> : <Plus className="h-4 w-4 text-text-tertiary" />}
      </div>
    );
  }

  if (images.length === 1) {
    return (
      <div className="group/single relative shrink-0">
        <div className="h-16 w-9 overflow-hidden rounded-xl border border-surface-border">
          <img src={resolveImageUrl(images[0])} alt={t("image.referenceAlt")} className="h-full w-full object-cover" />
        </div>
        <button
          type="button"
          onClick={() => onRemove(0)}
          className="absolute -left-1.5 -top-1.5 z-20 flex h-5 w-5 items-center justify-center rounded-full border border-surface-border bg-surface-elevated text-text-secondary opacity-0 shadow-md transition-all hover:text-red-500 group-hover/single:opacity-100"
          title={t("common.delete")}
        >
          <X className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onAdd}
          disabled={uploading}
          className="absolute -bottom-1.5 -right-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-surface-border bg-surface-elevated shadow-sm transition-all hover:border-brand/50 hover:text-brand"
          title={t("image.addReference")}
        >
          {uploading ? <Loader2 className="h-2.5 w-2.5 animate-spin text-text-tertiary" /> : <Plus className="h-3 w-3 text-text-tertiary" />}
        </button>
      </div>
    );
  }

  return (
    <div className="relative shrink-0" onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
      <div className={cn("flex items-center transition-all duration-300 ease-out", isHovered ? "gap-2 px-1" : "gap-0")}>
        {images.map((url, idx) => {
          const stackOffset = isHovered ? 0 : -idx * 14;
          const stackRotate = isHovered ? 0 : (idx % 2 === 0 ? 1 : -1) * (idx * 1.5);
          const zIndex = images.length - idx;

          return (
            <div
              key={`${url}-${idx}`}
              className={cn(
                "group/item relative overflow-hidden rounded-xl border border-surface-border shadow-sm transition-all duration-300 ease-out",
                isHovered ? "hover:z-50 hover:scale-110 hover:shadow-lg" : ""
              )}
              style={{ width: 36, height: 64, marginLeft: idx === 0 ? 0 : stackOffset, transform: `rotate(${stackRotate}deg)`, zIndex }}
            >
              <img src={resolveImageUrl(url)} alt={`${t("image.referenceAlt")} ${idx + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(idx);
                }}
                className={cn(
                  "absolute -left-1.5 -top-1.5 z-30 flex h-5 w-5 items-center justify-center rounded-full border border-surface-border bg-surface-elevated text-text-secondary shadow-md transition-all hover:text-red-500",
                  isHovered ? "opacity-100" : "opacity-0 group-hover/item:opacity-100"
                )}
                title={t("common.delete")}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {isHovered && (
        <button
          type="button"
          onClick={onAdd}
          disabled={uploading}
          className="absolute -right-6 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-surface-border bg-surface-elevated shadow-sm transition-all hover:border-brand/50 hover:text-brand"
          title={t("image.addReference")}
        >
          {uploading ? <Loader2 className="h-3 w-3 animate-spin text-text-tertiary" /> : <Plus className="h-3.5 w-3.5 text-text-tertiary" />}
        </button>
      )}
    </div>
  );
}

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "pending" | "completed" | "failed";
  imageUrl?: string;
  partialImageUrl?: string;
  errorMessage?: string;
  createdAt: Date;
}

function msgToDisplay(m: ImageChatMessage): DisplayMessage {
  return {
    id: String(m.id),
    role: m.role as "user" | "assistant",
    content: m.content,
    status: m.status as "pending" | "completed" | "failed",
    imageUrl: m.image_url,
    partialImageUrl: m.partial_image_url,
    errorMessage: m.error_message || undefined,
    createdAt: new Date(m.created_at),
  };
}

export default function ImageChatPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="w-8 h-8 rounded-full border-2 border-brand/30 border-t-brand animate-spin" /></div>}>
      <ImageChatPageInner />
    </Suspense>
  );
}

function ImageChatPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { t } = useI18n();
  const { chats, fetchChats, createChat, deleteChat, updateChatTitle } = useImageChats();
  const { messages: apiMessages, fetchMessages, sendMessage } = useImageChatMessages();
  const { models: imageModels } = useImageModels();

  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [uploadingRef, setUploadingRef] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [deleteSuccessOpen, setDeleteSuccessOpen] = useState(false);
  const [limitDialogOpen, setLimitDialogOpen] = useState(false);
  const [chatId, setChatId] = useState<number | null>(null);
  const [pollingChatId, setPollingChatId] = useState<number | null>(null);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState("auto");
  const [selectedResolution, setSelectedResolution] = useState("1K");
  const [selectedQuality, setSelectedQuality] = useState("medium");
  const [selectedModel, setSelectedModel] = useState("");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const selectedModelInfo = imageModels.find((m) => m.id === selectedModel) || imageModels[0];
  const selectedAspect = ASPECT_RATIOS.find((item) => item.value === selectedAspectRatio) || ASPECT_RATIOS[0];

  const initialPrompt = searchParams.get("prompt") || "";
  const initialAspect = searchParams.get("aspect") || "auto";
  const initialResolution = searchParams.get("resolution") || "1K";
  const initialQuality = searchParams.get("quality") || "medium";
  const initialRefs = searchParams.get("refs");
  const initialRefImages = initialRefs ? initialRefs.split(",") : [];
  const urlChatId = searchParams.get("chatId");

  useEffect(() => {
    if (!selectedModel && imageModels.length > 0) {
      setSelectedModel(imageModels[0].id);
    }
  }, [imageModels, selectedModel]);

  useEffect(() => {
    setSelectedAspectRatio(initialAspect);
    setSelectedResolution(initialResolution);
    setSelectedQuality(initialQuality);
  }, [initialAspect, initialResolution, initialQuality]);

  // 初始化
  useEffect(() => {
    if (urlChatId) {
      const id = Number(urlChatId);
      if (!isNaN(id)) {
        setChatId(id);
        fetchMessages(id);
      }
    }
    fetchChats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlChatId]);

  // 将 API 消息映射为显示消息；保留本地 optimistic pending，避免生成接口返回前页面空白
  useEffect(() => {
    if (apiMessages.length > 0) {
      setDisplayMessages((prev) => {
        const mapped = apiMessages.map(msgToDisplay);
        const optimisticPending = prev.filter(
          (m) => m.id.startsWith("optimistic-") && m.role === "assistant" && m.status === "pending"
        );
        const hasServerAssistant = mapped.some((m) => m.role === "assistant");
        return hasServerAssistant ? mapped : [...mapped, ...optimisticPending];
      });
    }
  }, [apiMessages]);

  useEffect(() => {
    if (!chatId || pollingChatId) return;
    const hasPendingAssistant = apiMessages.some((m) => m.role === "assistant" && m.status === "pending");
    if (hasPendingAssistant) {
      setPollingChatId(chatId);
      setIsGenerating(true);
    }
  }, [apiMessages, chatId, pollingChatId]);

  const addOptimisticPending = useCallback((text: string) => {
    const timestamp = Date.now();
    const userMessage: DisplayMessage = {
      id: `optimistic-user-${timestamp}`,
      role: "user",
      content: text,
      status: "completed",
      createdAt: new Date(timestamp),
    };
    const assistantMessage: DisplayMessage = {
      id: `optimistic-assistant-${timestamp}`,
      role: "assistant",
      content: text,
      status: "pending",
      createdAt: new Date(timestamp),
    };
    setDisplayMessages((prev) => [...prev, userMessage, assistantMessage]);
  }, []);

  const updateAutoScrollIntent = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceToBottom < 120;
  }, []);

  // 只在用户本来接近底部时自动跟随；用户上翻历史后，生成轮询不再强制拉到底部
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth", force = false) => {
    if (!force && !shouldAutoScrollRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    scrollToBottom("smooth");
  }, [displayMessages, scrollToBottom]);

  // 页面加载时如果有初始 prompt 且没有 chatId，自动发起生成
  useEffect(() => {
    if (initialPrompt && !urlChatId && displayMessages.length === 0) {
      handleSend(initialPrompt, initialAspect, initialResolution, initialQuality, initialRefImages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt, urlChatId]);

  const fetchImageChatMessagesDirect = useCallback(async (id: number): Promise<ImageChatMessage[]> => {
    const token = localStorage.getItem("token");
    const res = await fetch(`/api/image-chats/${id}/messages`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
    });
    if (!res.ok) throw new Error(t("image.error.loadMessages"));
    const data = await res.json().catch(() => ({}));
    return Array.isArray(data.messages) ? data.messages : [];
  }, []);

  // 轮询
  useEffect(() => {
    if (!pollingChatId) return;
    let cancelled = false;

    const syncMessages = async () => {
      try {
        const msgs = await fetchImageChatMessagesDirect(pollingChatId);
        if (cancelled) return;
        if (msgs.length > 0) {
          // 轮询结果直接强制同步到当前页面，避免本地 optimistic pending 卡住，必须刷新/切页后才看到图片。
          setDisplayMessages(msgs.map(msgToDisplay));
        }
        const pending = msgs.find((m) => m.role === "assistant" && m.status === "pending");
        if (!pending) {
          if (pollTimer.current) {
            clearInterval(pollTimer.current);
            pollTimer.current = null;
          }
          setPollingChatId(null);
          setIsGenerating(false);
          fetchChats();
          const latestAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
          const failedMsg = latestAssistant?.status === "failed" ? latestAssistant : msgs.find((m) => m.role === "assistant" && m.status === "failed");
          if (latestAssistant && ["completed", "failed"].includes(latestAssistant.status)) {
            emitTaskFinished({
              key: `image-chat:${latestAssistant.id}`,
              type: "image",
              title: latestAssistant.status === "completed" ? t("image.task.completed") : t("image.task.incomplete"),
              description: latestAssistant.content,
              href: `/image/chat?chatId=${pollingChatId}`,
              ok: latestAssistant.status === "completed" && Boolean(latestAssistant.image_url || latestAssistant.partial_image_url),
            });
          }
          if (failedMsg?.error_message) {
            toast.error(cleanImageErrorMessage(failedMsg.error_message, t));
          }
        }
      } catch {
        // ignore
      }
    };

    syncMessages();
    const timer = setInterval(syncMessages, 1000);

    pollTimer.current = timer;
    return () => {
      cancelled = true;
      clearInterval(timer);
      if (pollTimer.current === timer) pollTimer.current = null;
    };
  }, [fetchChats, fetchImageChatMessagesDirect, pollingChatId, t]);

  const handleSend = async (
    text: string,
    aspect: string = "auto",
    resolution: string = "1K",
    quality: string = "medium",
    refs: string[] = []
  ) => {
    if (!text.trim()) {
      toast.error(t("image.enterPrompt"));
      return;
    }
    setIsGenerating(true);
    shouldAutoScrollRef.current = true;
    addOptimisticPending(text.trim());

    const payload = {
      prompt: text,
      aspect_ratio: aspect,
      resolution,
      quality,
      reference_image_urls: refs.length > 0 ? refs : undefined,
    };

    try {
      if (!chatId) {
        // 创建新会话
        const newChat = await createChat(payload);
        setChatId(newChat.id);
        // 更新 URL
        router.replace(`/image/chat?chatId=${newChat.id}`);
        const initialMessages = await fetchMessages(newChat.id);
        const assistantMsg = [...initialMessages].reverse().find((m) => m.role === "assistant" && m.status === "pending");
        if (assistantMsg) {
          registerBackgroundTask({
            key: `image-chat:${assistantMsg.id}`,
            type: "image",
            id: assistantMsg.id,
            title: t("image.task.generating"),
            description: text.trim(),
            href: `/image/chat?chatId=${newChat.id}`,
            conversationId: newChat.id,
            serverMessageId: assistantMsg.id,
          });
        }
        setPollingChatId(newChat.id);
        fetchChats();
      } else {
        // 在现有会话中发送
        const sent = await sendMessage(chatId, payload);
        registerBackgroundTask({
          key: `image-chat:${sent.message_id}`,
          type: "image",
          id: sent.message_id,
          title: t("image.task.generating"),
          description: text.trim(),
          href: `/image/chat?chatId=${chatId}`,
          conversationId: chatId,
          serverMessageId: sent.message_id,
        });
        setPollingChatId(chatId);
        await fetchMessages(chatId);
        fetchChats();
      }

      setPrompt("");
      setReferenceImages([]);
    } catch (err) {
      const userError = normalizeError(err, { module: "image", fallbackMessage: t("common.sendFailed") });
      if (userError.message.includes("历史记录只能保存")) {
        setLimitDialogOpen(true);
      } else {
        toast.error(userError.message);
      }
      setIsGenerating(false);
    }
  };

  const handleSubmit = () => {
    handleSend(prompt, selectedAspectRatio, selectedResolution, selectedQuality, referenceImages);
  };

  const uploadReferenceImage = async (file: File) => {
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
        throw await readApiError(res);
      }
      const data = await res.json();
      const url = data.public_id || data.url || data.image_url;
      setReferenceImages((prev) => [...prev, url]);
    } catch (err) {
      showUserError(err, {
        module: "file",
        fallbackTitle: t("image.uploadFailed"),
        fallbackMessage: "参考图上传失败，请重新选择图片。",
      });
    } finally {
      setUploadingRef(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    uploadReferenceImage(file);
  };

  const handleAddImage = () => fileInputRef.current?.click();
  const handleRemoveImage = (index: number) => {
    setReferenceImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDownload = async (url: string, id: string) => {
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
    toast.success(t("image.referenceAdded"));
    scrollToBottom("smooth", true);
  };

  const handleOpenImageTool = (mode: "remove-bg" | "replace-bg" | "text-removal" | "upscale" | "inpaint" | "region-brush", url: string) => {
    const params = new URLSearchParams({ mode, image: url });
    router.push(`/create?${params.toString()}`);
  };

  const handleDeleteMessageImage = async (msgId: string) => {
    // 前端只是删除消息展示，后端不支持单条消息删除，跳过
    setDeleteTargetId(null);
  };

  const resolveImageUrl = (url?: string) => {
    if (!url) return "";
    if (url.startsWith("file_")) {
      return `/api/files/${url}/view`;
    }
    return url;
  };

  const hasContent = prompt.trim().length > 0;

  const handleNewChat = () => {
    setChatId(null);
    setDisplayMessages([]);
    setPrompt("");
    setReferenceImages([]);
    setShowHistory(false);
    router.replace("/image");
  };

  const handleSelectChat = async (id: number) => {
    setChatId(id);
    setShowHistory(false);
    router.replace(`/image/chat?chatId=${id}`);
    await fetchMessages(id);
  };

  const handleDeleteChat = async (id: number) => {
    try {
      await deleteChat(id);
      setDeleteSuccessOpen(false);
      window.setTimeout(() => setDeleteSuccessOpen(true), 0);
      if (chatId === id) {
        handleNewChat();
      }
    } catch {
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
      <DeleteSuccessNotice open={deleteSuccessOpen} label={t("image.defaultChatTitle")} onClose={() => setDeleteSuccessOpen(false)} />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* 顶部标题栏 */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => router.push("/image")}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-card transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center">
            <ImageIcon className="w-4 h-4 text-brand" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-text-primary">{t("image.chatTitle")}</h1>
            <p className="text-[11px] text-text-tertiary">{t("image.chatSubtitle")}</p>
          </div>
        </div>
      </div>

      {/* 聊天区域 */}
      <div
        ref={messagesScrollRef}
        onScroll={updateAutoScrollIntent}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6"
      >
        <div className="max-w-3xl mx-auto space-y-6">
          {displayMessages.length === 0 && !initialPrompt && (
            <div className="flex flex-col items-center justify-center h-full text-text-tertiary py-20">
              <div className="w-16 h-16 rounded-2xl bg-surface-card border border-surface-border flex items-center justify-center mb-4">
                <ImageIcon className="w-8 h-8 text-text-tertiary/50" />
              </div>
              <p className="text-sm">{t("image.emptyHint")}</p>
            </div>
          )}

          {displayMessages.map((msg) => {
            if (msg.role === "user") {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-brand/10 px-4 py-2.5 text-sm text-text-primary">
                    {msg.content}
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} className="flex justify-start">
                <div className="w-[min(90vw,28rem)] md:w-[28rem] max-w-[90%] space-y-2">
                  {msg.status === "pending" && (
                    <div className="w-full rounded-2xl rounded-tl-sm bg-surface-card border border-surface-border overflow-hidden">
                      {msg.partialImageUrl ? (
                        <div className="relative">
                          <img
                            src={resolveImageUrl(msg.partialImageUrl)}
                            alt={msg.content}
                            className="w-full max-h-[70vh] object-contain bg-surface"
                          />
                          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-surface-card/90 border border-surface-border px-2.5 py-1 text-[11px] text-text-secondary backdrop-blur">
                            <Loader2 className="w-3 h-3 animate-spin text-brand" />
                            <span>{t("image.generatingPartial")}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="relative aspect-video bg-surface-card">
                          <video
                            key="ai-space-loading-video"
                            src="/ai-space-loading.mp4"
                            className="absolute inset-0 h-full w-full object-cover"
                            autoPlay
                            loop
                            muted
                            playsInline
                            preload="auto"
                          />
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10 px-6 text-center">
                            <div className="flex items-center gap-1.5 rounded-full bg-black/35 px-3 py-1.5 text-xs text-white backdrop-blur-sm">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              <span>{t("image.imageGenerating")}</span>
                            </div>
                            <p className="text-[11px] text-white/50 max-w-[80%] line-clamp-2">
                              {msg.content}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {msg.status === "failed" && (
                    <div className="rounded-2xl rounded-tl-sm bg-red-500/5 border border-red-500/20 p-4">
                      <p className="text-sm text-red-400">{t("image.generationFailedRetry")}</p>
                      <p className="text-[11px] text-text-tertiary mt-1">{cleanImageErrorMessage(msg.errorMessage || msg.content, t)}</p>
                    </div>
                  )}

                  {msg.status === "completed" && msg.imageUrl && (
                    <div className="rounded-2xl rounded-tl-sm bg-surface-card border border-surface-border overflow-hidden group">
                      <div className="relative aspect-auto">
                        <img
                          src={resolveImageUrl(msg.imageUrl)}
                          alt={msg.content}
                          className="w-full max-h-[70vh] object-contain cursor-zoom-in bg-surface"
                          onClick={() => setPreviewImageUrl(resolveImageUrl(msg.imageUrl))}
                        />
                        <div className="absolute inset-0 bg-black/10 opacity-0 transition-opacity duration-200 group-hover:opacity-100 pointer-events-none" />
                        <div className="absolute right-3 top-3 z-10 flex items-center gap-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUseImageAsReference(msg.imageUrl!);
                            }}
                            className="flex h-9 w-9 items-center justify-center rounded-xl bg-text-tertiary/70 text-white backdrop-blur-md transition-colors hover:bg-text-secondary"
                            title={t("image.useAsReference")}
                          >
                            <ImageIcon className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownload(resolveImageUrl(msg.imageUrl), msg.id);
                            }}
                            className="flex h-9 w-9 items-center justify-center rounded-xl bg-text-tertiary/70 text-white backdrop-blur-md transition-colors hover:bg-text-secondary"
                            title={t("common.download")}
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <div className="group/menu relative" onClick={(e) => e.stopPropagation()}>
                            <button
                              className="flex h-9 w-9 items-center justify-center rounded-xl bg-text-tertiary/70 text-white backdrop-blur-md transition-colors hover:bg-text-secondary"
                              title={t("image.moreTools")}
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                            <div className="invisible absolute right-0 top-full z-20 mt-2 w-44 rounded-2xl border border-surface-border bg-surface-card p-2 opacity-0 shadow-xl transition-all duration-150 group-hover/menu:visible group-hover/menu:opacity-100">
                              {[
                                { labelKey: "image.edit.removeBg", icon: Eraser, mode: "remove-bg" as const },
                                { labelKey: "image.edit.textRemoval", icon: Type, mode: "text-removal" as const },
                                { labelKey: "image.edit.upscale", icon: ZoomIn, mode: "upscale" as const },
                                { labelKey: "image.edit.replaceBg", icon: ImageIcon, mode: "replace-bg" as const },
                                { labelKey: "image.edit.inpaint", icon: Brush, mode: "inpaint" as const },
                                { labelKey: "image.edit.regionBrush", icon: Paintbrush, mode: "region-brush" as const },
                              ].map((item) => (
                                <button
                                  key={item.mode}
                                  onClick={() => handleOpenImageTool(item.mode, msg.imageUrl!)}
                                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-text-primary transition-colors hover:bg-surface-elevated"
                                >
                                  <item.icon className="h-4 w-4" />
                                  <span>{t(item.labelKey)}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="px-3 py-2 border-t border-surface-border">
                        <p className="text-xs text-text-secondary line-clamp-2">{msg.content}</p>
                        <p className="text-[10px] text-text-tertiary mt-0.5">
                          {msg.createdAt.toLocaleString()}
                        </p>
                      </div>
                      {/* 图片下方工具栏 */}
                      <div className="flex items-center gap-0.5 px-3 py-2 border-t border-surface-border">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(msg.content);
                            toast.success(t("image.promptCopied"));
                          }}
                          className="p-1.5 rounded-md hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors"
                          title={t("image.copyPrompt")}
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            setPrompt(msg.content);
                            scrollToBottom("smooth", true);
                          }}
                          className="p-1.5 rounded-md hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors"
                          title={t("image.usePrompt")}
                        >
                          <Send className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() =>
                            handleSend(
                              msg.content,
                              initialAspect,
                              initialResolution,
                              initialQuality
                            )
                          }
                          className="p-1.5 rounded-md hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors"
                          title={t("image.regenerate")}
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteTargetId(msg.id)}
                          className="p-1.5 rounded-md hover:bg-red-500/10 text-text-tertiary hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                          title={t("common.delete")}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 历史记录面板 */}
      <CreationHistoryPanel
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        title={t("image.historyTitle")}
        items={chats.map((c) => ({
          id: c.id,
          title: c.title,
          active: chatId === c.id,
          updated_at: c.updated_at,
          cover_image: c.cover_image,
          status: c.status,
        }))}
        onSelect={handleSelectChat}
        onNew={handleNewChat}
        onRename={handleRenameChat}
        onDelete={handleDeleteChat}
        loading={false}
      />

      {/* 底部输入框 */}
      <div className="shrink-0 border-t border-surface-border px-4 md:px-6 py-3">
        <div className="max-w-3xl mx-auto">
          <div
            className={cn(
              "relative flex flex-col rounded-2xl border transition-all duration-300",
              "bg-surface-card",
              referenceImages.length > 0
                ? "border-brand/20 focus-within:border-brand/40"
                : "border-surface-border focus-within:border-brand/30"
            )}
          >
            {/* 右上角按钮：历史记录 + 新建会话 */}
            <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
              <button
                onClick={() => {
                  setShowHistory(!showHistory);
                  if (!showHistory) fetchChats();
                }}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors"
                title={t("common.history")}
              >
                <History className="w-4 h-4" />
              </button>
              <button
                onClick={handleNewChat}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-brand hover:text-brand-hover hover:bg-brand/10 transition-colors"
                title={t("common.newChat")}
              >
                <MessageSquarePlus className="w-4 h-4" />
              </button>
            </div>

            {/* 输入区 */}
            <div className="flex items-start gap-3 px-4 pt-3 pb-2">
              <div className="mt-1 flex gap-2">
                <ReferenceImageStack
                  images={referenceImages}
                  onAdd={handleAddImage}
                  onRemove={handleRemoveImage}
                  uploading={uploadingRef}
                  onDropFile={uploadReferenceImage}
                  t={t}
                />
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t("image.prompt.image")}
                disabled={isGenerating}
                className={cn(
                  "flex-1 min-h-[60px] max-h-[160px] bg-transparent text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none text-[15px] leading-relaxed py-2 pr-16",
                  isGenerating && "opacity-60 cursor-not-allowed"
                )}
                onKeyDown={(e) => {
                  // macOS/中文输入法确认候选词时也会触发 Enter，不能当作发送
                  if (e.nativeEvent.isComposing || e.keyCode === 229) {
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
              />
            </div>

            {/* 底部工具栏 */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                {/* 模型选择 */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setModelMenuOpen((open) => !open)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] text-text-secondary border-surface-border hover:border-brand/30 hover:text-text-primary transition-colors"
                  >
                    <Layers className="w-3 h-3" />
                    <span>{selectedModelInfo?.name || "GPT Image 2"}</span>
                    <ChevronDown className={cn("w-3 h-3 transition-transform", modelMenuOpen && "rotate-180")} />
                  </button>
                  {modelMenuOpen && (
                    <div className="absolute left-0 bottom-full mb-2 w-56 rounded-xl border border-surface-border bg-surface-elevated p-1 shadow-xl z-30">
                      {imageModels.map((model) => (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => {
                            setSelectedModel(model.id);
                            setModelMenuOpen(false);
                          }}
                          className={cn(
                            "w-full rounded-lg px-3 py-2 text-left text-xs transition-colors",
                            selectedModel === model.id
                              ? "bg-surface-card text-text-primary font-medium shadow-sm"
                              : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                          )}
                        >
                          <div className="font-medium">{model.name}</div>
                          <div className="mt-0.5 text-[10px] text-text-tertiary">{model.provider}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 尺寸比例 */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setAspectMenuOpen((open) => !open)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] text-text-secondary border-surface-border hover:border-brand/30 hover:text-text-primary transition-colors"
                  >
                    <span>{selectedAspect.label}</span>
                    <ChevronDown className={cn("w-3 h-3 transition-transform", aspectMenuOpen && "rotate-180")} />
                  </button>
                  {aspectMenuOpen && (
                    <div className="absolute left-0 bottom-full mb-2 w-72 rounded-xl border border-surface-border bg-surface-elevated p-3 shadow-xl z-30">
                      <div className="mb-2 text-xs font-medium text-text-primary">{t("image.aspectRatio")}</div>
                      <div className="grid grid-cols-4 gap-2">
                        {ASPECT_RATIOS.map((ratio) => (
                          <button
                            key={ratio.value}
                            type="button"
                            onClick={() => {
                              setSelectedAspectRatio(ratio.value);
                              setAspectMenuOpen(false);
                            }}
                            className={cn(
                              "flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[11px] transition-colors",
                              selectedAspectRatio === ratio.value
                                ? "border-surface-border bg-surface-card text-text-primary font-medium shadow-sm"
                                : "border-surface-border text-text-secondary hover:border-text-tertiary/40 hover:text-text-primary"
                            )}
                          >
                            <AspectIcon w={ratio.w} h={ratio.h} active={selectedAspectRatio === ratio.value} />
                            <span>{ratio.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 分辨率 */}
                <div className="flex items-center rounded-full border border-surface-border p-0.5">
                  {RESOLUTIONS.map((resolution) => (
                    <button
                      key={resolution.value}
                      type="button"
                      onClick={() => setSelectedResolution(resolution.value)}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] transition-colors",
                        selectedResolution === resolution.value
                          ? "bg-surface-card text-text-primary font-medium shadow-sm"
                          : "text-text-tertiary hover:text-text-primary"
                      )}
                    >
                      {resolution.label}
                    </button>
                  ))}
                </div>

                {/* 质量 */}
                <div className="flex items-center rounded-full border border-surface-border p-0.5">
                  {QUALITIES.map((quality) => (
                    <button
                      key={quality.value}
                      type="button"
                      onClick={() => setSelectedQuality(quality.value)}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] transition-colors",
                        selectedQuality === quality.value
                          ? "bg-surface-card text-text-primary font-medium shadow-sm"
                          : "text-text-tertiary hover:text-text-primary"
                      )}
                    >
                      {quality.label}
                    </button>
                  ))}
                </div>
              </div>

              {isGenerating ? (
                <button
                  disabled
                  className="flex items-center justify-center w-9 h-9 rounded-full bg-text-tertiary/30 text-white cursor-not-allowed"
                >
                  <Loader2 className="w-4 h-4 animate-spin" />
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={!hasContent}
                  className={cn(
                    "flex items-center justify-center w-9 h-9 rounded-full transition-all duration-200",
                    hasContent
                      ? "bg-brand text-white hover:bg-brand-hover"
                      : "bg-text-tertiary/20 text-text-tertiary cursor-not-allowed"
                  )}
                >
                  <Send className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <ImageLightbox
        isOpen={!!previewImageUrl}
        imageUrl={previewImageUrl || ""}
        alt=""
        onClose={() => setPreviewImageUrl(null)}
        onDownload={
          previewImageUrl
            ? () => handleDownload(previewImageUrl, "preview")
            : undefined
        }
      />

      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        title={t("image.deleteImageTitle")}
        description={t("image.deleteImageDesc")}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        onConfirm={() => {
          if (deleteTargetId) handleDeleteMessageImage(deleteTargetId);
          setDeleteTargetId(null);
        }}
        onCancel={() => setDeleteTargetId(null)}
        variant="danger"
      />

      <NoticeDialog
        isOpen={limitDialogOpen}
        title={t("image.limitTitle")}
        description={t("image.limitDescription")}
        confirmText={t("common.gotIt")}
        onConfirm={() => setLimitDialogOpen(false)}
      />
    </div>
  );
}
