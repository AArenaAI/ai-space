"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  Download,
  History,
  Layers,
  Loader2,
  MessageSquarePlus,
  Music,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { VideoChatMessage, useVideoChatMessages, useVideoChats } from "@/hooks/useVideoChat";
import { useVideoModels } from "@/hooks/useModels";
import ImageLightbox from "@/components/ui/ImageLightbox";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import NoticeDialog from "@/components/ui/NoticeDialog";
import CreationHistoryPanel from "@/components/creative/CreationHistoryPanel";
import DeleteSuccessNotice from "@/components/ui/DeleteSuccessNotice";
import { useI18n } from "@/lib/i18n";
import { emitTaskFinished, registerBackgroundTask } from "@/lib/taskNotifications";
import { normalizeError, readApiError, showUserError } from "@/lib/errors";

const ASPECT_RATIOS = [
  { value: "16:9", label: "16:9", w: 16, h: 9 },
  { value: "4:3", label: "4:3", w: 4, h: 3 },
  { value: "1:1", label: "1:1", w: 1, h: 1 },
  { value: "3:4", label: "3:4", w: 3, h: 4 },
  { value: "9:16", label: "9:16", w: 9, h: 16 },
  { value: "21:9", label: "21:9", w: 21, h: 9 },
  { value: "adaptive", label: "adaptive", w: 1, h: 1 },
];

const DURATIONS = ["4s", "5s", "6s", "7s", "9s", "10s", "11s", "13s", "14s", "15s"];
const RESOLUTIONS = ["480p", "720p", "1080p"];
const MAX_REFERENCE_IMAGES = 9;
const MAX_REFERENCE_VIDEOS = 3;
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
  return file.type.startsWith("video/") || VIDEO_EXTENSIONS.includes(fileExtension(file));
}

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: string;
  videoUrl?: string;
  errorMessage?: string;
  createdAt: Date;
  generationId?: number;
}

function AspectIcon({ w, h, active }: { w: number; h: number; active: boolean }) {
  const maxDim = 28;
  let boxW = maxDim;
  let boxH = maxDim;
  if (w > h) {
    boxW = maxDim;
    boxH = Math.max(Math.round((maxDim * h) / w), 10);
  } else if (h > w) {
    boxH = maxDim;
    boxW = Math.max(Math.round((maxDim * w) / h), 10);
  }
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-md border border-surface-border bg-surface">
      <div
        className={cn("rounded-sm border-2 transition-colors", active ? "border-text-primary bg-surface-card" : "border-text-tertiary/50")}
        style={{ width: boxW, height: boxH }}
      />
    </div>
  );
}

function resolveMediaUrl(url?: string) {
  if (!url) return "";
  if (url.startsWith("file_")) return `/api/files/${url}/view`;
  return url;
}

type VideoErrorMessages = {
  default: string;
  privacy: string;
  sensitive: string;
  invalidParams: string;
  timeout: string;
  rateLimit: string;
  quota: string;
  serviceBusy: string;
};

function getVideoErrorMessages(t: (key: string) => string): VideoErrorMessages {
  return {
    default: t("video.error.default"),
    privacy: t("video.error.privacy"),
    sensitive: t("video.error.sensitive"),
    invalidParams: t("video.error.invalidParams"),
    timeout: t("video.error.timeout"),
    rateLimit: t("video.error.rateLimit"),
    quota: t("video.error.quota"),
    serviceBusy: t("video.error.serviceBusy"),
  };
}

function cleanVideoErrorMessage(raw: string | undefined, messages: VideoErrorMessages) {
  const text = (raw || "").trim();
  if (!text) return messages.default;
  const lower = text.toLowerCase();

  if (
    lower.includes("inputimagesensitivecontentdetected") ||
    lower.includes("privacyinformation") ||
    lower.includes("real person") ||
    text.includes("真实人物") ||
    text.includes("隐私")
  ) {
    return messages.privacy;
  }

  if (
    lower.includes("sensitive") ||
    lower.includes("content_filter") ||
    lower.includes("contentpolicy") ||
    lower.includes("risk") ||
    text.includes("敏感") ||
    text.includes("安全") ||
    text.includes("违规") ||
    text.includes("审核")
  ) {
    return messages.sensitive;
  }

  if (
    lower.includes("invalid") ||
    lower.includes("badrequest") ||
    lower.includes("unsupported") ||
    lower.includes("parameter") ||
    lower.includes("param") ||
    text.includes("参数") ||
    text.includes("不支持")
  ) {
    return messages.invalidParams;
  }

  if (lower.includes("timeout") || lower.includes("deadline exceeded") || text.includes("超时")) {
    return messages.timeout;
  }

  if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("429") || text.includes("频率") || text.includes("限流")) {
    return messages.rateLimit;
  }

  if (lower.includes("quota") || lower.includes("insufficient") || lower.includes("balance") || text.includes("额度") || text.includes("余额")) {
    return messages.quota;
  }

  if (lower.includes("unavailable") || lower.includes("service") || lower.includes("503") || text.includes("繁忙")) {
    return messages.serviceBusy;
  }

  const looksLikeRawProviderError =
    text.includes("{") ||
    text.includes("}") ||
    lower.includes("request id") ||
    lower.includes("request_id") ||
    lower.includes("error code:") ||
    lower.includes("badrequest") ||
    lower.includes("create video task failed") ||
    lower.includes("failed to create task") ||
    lower.includes("get video task failed");

  return looksLikeRawProviderError ? messages.default : text;
}

function messageToDisplayMessage(message: VideoChatMessage, errorMessages: VideoErrorMessages): DisplayMessage {
  const errorMessage = message.error_message
    ? normalizeError(cleanVideoErrorMessage(message.error_message, errorMessages), { module: "video", fallbackMessage: errorMessages.default }).message
    : undefined;
  return {
    id: `${message.role}-${message.id}`,
    role: message.role === "user" ? "user" : "assistant",
    content: message.content,
    status: message.status,
    videoUrl: message.video_url,
    errorMessage,
    createdAt: new Date(message.created_at || Date.now()),
    generationId: message.generation_id,
  };
}

function messagesToDisplayMessages(messages: VideoChatMessage[], errorMessages: VideoErrorMessages): DisplayMessage[] {
  return messages.map((message) => messageToDisplayMessage(message, errorMessages));
}

export default function VideoChatPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-brand/30 border-t-brand" /></div>}>
      <VideoChatPageInner />
    </Suspense>
  );
}

function VideoChatPageInner() {
  const router = useRouter();
  const { t } = useI18n();
  const videoErrorMessages = getVideoErrorMessages(t);
  const searchParams = useSearchParams();
  const { models: videoModels } = useVideoModels();
  const { chats, loading: chatsLoading, fetchChats, createChat, deleteChat } = useVideoChats();
  const { messages, fetchMessages, sendMessage } = useVideoChatMessages();

  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([]);
  const [currentChatId, setCurrentChatId] = useState<number | null>(() => {
    const chatId = searchParams.get("chatId");
    return chatId ? Number(chatId) : null;
  });
  const [generating, setGenerating] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [referenceImages, setReferenceImages] = useState<string[]>(() => {
    const refs = searchParams.get("refs");
    return refs ? refs.split(",").filter(Boolean) : [];
  });
  const [referenceVideos, setReferenceVideos] = useState<string[]>(() => {
    const refs = searchParams.get("videoRefs");
    return refs ? refs.split(",").filter(Boolean) : [];
  });
  const [uploadingRef, setUploadingRef] = useState(false);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState(searchParams.get("aspect") || "adaptive");
  const [selectedDuration, setSelectedDuration] = useState(searchParams.get("duration") || "5s");
  const [musicEnabled, setMusicEnabled] = useState(searchParams.get("audio") === "1");
  const [selectedModel, setSelectedModel] = useState(searchParams.get("model") || "");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);
  const [durationMenuOpen, setDurationMenuOpen] = useState(false);
  const [selectedResolution, setSelectedResolution] = useState(searchParams.get("resolution") || "720p");
  const [resolutionMenuOpen, setResolutionMenuOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [deleteSuccessOpen, setDeleteSuccessOpen] = useState(false);
  const [limitDialogOpen, setLimitDialogOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const autoSubmittedRef = useRef(false);
  const shouldAutoScrollRef = useRef(true);

  const selectedModelInfo = videoModels.find((m) => m.id === selectedModel) || videoModels[0];
  const selectedAspect = ASPECT_RATIOS.find((item) => item.value === selectedAspectRatio) || ASPECT_RATIOS[0];
  const isFastModel = (selectedModelInfo?.id || selectedModel).includes("seedance-2-0-fast");
  const availableResolutions = isFastModel ? RESOLUTIONS.filter((item) => item !== "1080p") : RESOLUTIONS;
  const hasContent = prompt.trim().length > 0;
  const hasReferenceMedia = referenceImages.length > 0 || referenceVideos.length > 0;
  useEffect(() => {
    if (!selectedModel && videoModels.length > 0) {
      setSelectedModel(videoModels[0].id);
    }
  }, [videoModels, selectedModel]);

  useEffect(() => {
    if (isFastModel && selectedResolution === "1080p") {
      setSelectedResolution("720p");
    }
  }, [isFastModel, selectedResolution]);

  useEffect(() => {
    const refs = searchParams.get("refs");
    if (refs) setReferenceImages(refs.split(",").filter(Boolean));
    const videoRefs = searchParams.get("videoRefs");
    if (videoRefs) setReferenceVideos(videoRefs.split(",").filter(Boolean));
  }, [searchParams]);

  const updateAutoScrollIntent = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceToBottom < 120;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth", force = false) => {
    if (!force && !shouldAutoScrollRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    scrollToBottom("smooth");
  }, [displayMessages, scrollToBottom]);

  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  useEffect(() => {
    setDisplayMessages(messagesToDisplayMessages(messages, videoErrorMessages));
  }, [messages]);

  useEffect(() => {
    const chatId = searchParams.get("chatId");
    if (!chatId) return;
    const numericChatId = Number(chatId);
    if (!numericChatId) return;
    setCurrentChatId(numericChatId);
    fetchMessages(numericChatId);
  }, [fetchMessages, searchParams]);

  useEffect(() => {
    if (!currentChatId) return;
    const pendingMessages = displayMessages.filter((msg) => msg.role === "assistant" && !msg.videoUrl && ["pending", "running"].includes(msg.status || ""));
    if (pendingMessages.length === 0) return;
    const timer = window.setInterval(async () => {
      const msgs = await fetchMessages(currentChatId);
      // 轮询结果直接同步到当前页面，避免生成完成后必须刷新/切页才显示视频。
      if (msgs.length > 0) {
        setDisplayMessages(messagesToDisplayMessages(msgs, videoErrorMessages));
      }
      for (const msg of msgs) {
        if (msg.role !== "assistant") continue;
        if (!["succeeded", "completed", "failed"].includes(msg.status || "")) continue;
        emitTaskFinished({
          key: `video-chat:${msg.id}`,
          type: "video",
          title: ["succeeded", "completed"].includes(msg.status || "") ? t("video.task.completed") : t("video.task.incomplete"),
          description: msg.content,
          href: `/video/chat?chatId=${currentChatId}`,
          ok: ["succeeded", "completed"].includes(msg.status || "") && Boolean(msg.video_url),
        });
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [currentChatId, displayMessages, fetchMessages]);

  const handleSend = useCallback(async (text: string) => {
    const cleanPrompt = text.trim();
    if (!cleanPrompt) {
      toast.error(t("image.enterPrompt"));
      return;
    }
    const model = selectedModelInfo?.id || selectedModel;
    if (!model) {
      toast.error(t("video.noAvailableModel"));
      return;
    }

    shouldAutoScrollRef.current = true;
    const now = Date.now();
    const localUserMessage: DisplayMessage = {
      id: `local-user-${now}`,
      role: "user",
      content: cleanPrompt,
      createdAt: new Date(),
    };
    const localAssistantMessage: DisplayMessage = {
      id: `local-assistant-${now}`,
      role: "assistant",
      content: cleanPrompt,
      status: "pending",
      createdAt: new Date(),
    };
    setDisplayMessages((prev) => [...prev, localUserMessage, localAssistantMessage]);
    setGenerating(true);

    try {
      const durationSec = parseInt(selectedDuration.replace("s", ""), 10) || 5;
      const payload = {
        prompt: cleanPrompt,
        model,
        ratio: selectedAspectRatio,
        resolution: selectedResolution,
        duration: durationSec,
        generate_audio: musicEnabled,
        watermark: false,
        reference_image_urls: referenceImages.length > 0 ? referenceImages : undefined,
        reference_video_urls: referenceVideos.length > 0 ? referenceVideos : undefined,
      };

      let chatId = currentChatId;
      let messageId: number | undefined;
      if (chatId) {
        const sent = await sendMessage(chatId, payload);
        messageId = sent.message_id;
      } else {
        const created = await createChat(payload);
        chatId = created.chat_id || created.chat?.id;
        messageId = created.message_id;
        if (!chatId) throw new Error(t("video.createChatFailed"));
        setCurrentChatId(chatId);
        router.replace(`/video/chat?chatId=${chatId}`);
      }

      if (chatId && messageId) {
        registerBackgroundTask({
          key: `video-chat:${messageId}`,
          type: "video",
          id: messageId,
          title: t("video.task.generating"),
          description: cleanPrompt,
          href: `/video/chat?chatId=${chatId}`,
          conversationId: chatId,
          serverMessageId: messageId,
        });
      }

      setPrompt("");
      setReferenceImages([]);
      setReferenceVideos([]);
      await fetchMessages(chatId);
      fetchChats();
    } catch (err: any) {
      const rawMsg = err.message || t("video.submitFailed");
      if (rawMsg.includes("历史记录只能保存")) {
        setLimitDialogOpen(true);
        // 移除刚才添加的临时消息
        setDisplayMessages((prev) =>
          prev.filter((m) => m.id !== localAssistantMessage.id && m.id !== localUserMessage.id)
        );
      } else {
        const userError = normalizeError(rawMsg, { module: "video", fallbackMessage: t("video.submitFailed") });
        const msg = cleanVideoErrorMessage(userError.message, videoErrorMessages);
        setDisplayMessages((prev) =>
          prev.map((msgItem) =>
            msgItem.id === localAssistantMessage.id
              ? { ...msgItem, status: "failed", errorMessage: msg }
              : msgItem
          )
        );
        toast.error(msg);
      }
    } finally {
      setGenerating(false);
    }
  }, [createChat, currentChatId, fetchChats, fetchMessages, musicEnabled, referenceImages, referenceVideos, router, selectedAspectRatio, selectedDuration, selectedModel, selectedModelInfo, selectedResolution, sendMessage, t, videoErrorMessages]);

  useEffect(() => {
    const initialPrompt = searchParams.get("prompt") || "";
    if (!initialPrompt || autoSubmittedRef.current) return;
    if (!selectedModelInfo && videoModels.length === 0) return;
    autoSubmittedRef.current = true;
    handleSend(initialPrompt);
  }, [handleSend, searchParams, selectedModelInfo, videoModels.length]);

  const uploadReferenceMedia = async (file: File) => {
    const isVideo = isVideoFile(file);
    const isImage = isImageFile(file);
    if (!isImage && !isVideo) {
      toast.error(t("video.uploadUnsupported"));
      return;
    }
    if (isImage && referenceImages.length >= MAX_REFERENCE_IMAGES) {
      toast.error(t("video.maxReferenceImages").replace("{max}", String(MAX_REFERENCE_IMAGES)));
      return;
    }
    if (isVideo && referenceVideos.length >= MAX_REFERENCE_VIDEOS) {
      toast.error(t("video.maxReferenceVideos").replace("{max}", String(MAX_REFERENCE_VIDEOS)));
      return;
    }
    if (isVideo) {
      const ext = fileExtension(file);
      if (!(VIDEO_MIME_TYPES.includes(file.type) || VIDEO_EXTENSIONS.includes(ext))) {
        toast.error(t("video.referenceVideoFormat"));
        return;
      }
      if (file.size > MAX_REFERENCE_VIDEO_SIZE) {
        toast.error(t("video.referenceVideoSize"));
        return;
      }
    }
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
      if (isVideo) {
        setReferenceVideos((prev) => [...prev, url].slice(0, MAX_REFERENCE_VIDEOS));
      } else {
        setReferenceImages((prev) => [...prev, url].slice(0, MAX_REFERENCE_IMAGES));
      }
    } catch (err) {
      showUserError(err, {
        module: "file",
        fallbackTitle: t("image.uploadFailed"),
        fallbackMessage: "参考素材上传失败，请重新上传。",
      });
    } finally {
      setUploadingRef(false);
    }
  };

  const handleSubmit = () => handleSend(prompt);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    uploadReferenceMedia(file);
  };

  const handleDownload = async (url: string, id: number | string) => {
    try {
      const response = await fetch(resolveMediaUrl(url));
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `aispace-video-${id}.mp4`;
      link.click();
      toast.success(t("image.downloadStarted"));
    } catch {
      toast.error(t("image.downloadFailed"));
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetId) return;
    try {
      await deleteChat(deleteTargetId);
      if (currentChatId === deleteTargetId) {
        setCurrentChatId(null);
        setDisplayMessages([]);
        router.replace("/video/chat");
      }
      setDeleteSuccessOpen(false);
      window.setTimeout(() => setDeleteSuccessOpen(true), 0);
    } catch {
      toast.error(t("image.deleteFailed"));
    } finally {
      setDeleteTargetId(null);
    }
  };

  const handleNewChat = () => {
    setDisplayMessages([]);
    setPrompt("");
    setReferenceImages([]);
    setDeleteTargetId(null);
    setCurrentChatId(null);
    router.replace("/image");
    setShowHistory(false);
  };

  const handleSelectVideo = (id: number) => {
    const chat = chats.find((item) => item.id === id);
    if (!chat) return;
    setCurrentChatId(id);
    setPrompt("");
    setReferenceImages([]);
    fetchMessages(id);
    router.replace(`/video/chat?chatId=${id}`);
    setShowHistory(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
      <DeleteSuccessNotice open={deleteSuccessOpen} label={t("video.chatSession")} onClose={() => setDeleteSuccessOpen(false)} />
      <input ref={fileInputRef} type="file" accept="image/*,video/mp4,video/quicktime" className="hidden" onChange={handleFileSelect} />

      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-surface-border">
        <button
          onClick={() => router.push("/image")}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-card transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center">
            <Video className="w-4 h-4 text-brand" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-text-primary">{t("video.title")}</h1>
            <p className="text-[11px] text-text-tertiary">{t("video.subtitle")}</p>
          </div>
        </div>
      </div>

      <div
        ref={messagesScrollRef}
        onScroll={updateAutoScrollIntent}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6"
      >
        <div className="max-w-3xl mx-auto space-y-6">
          {displayMessages.length === 0 && !searchParams.get("prompt") && (
            <div className="flex flex-col items-center justify-center h-full text-text-tertiary py-20">
              <div className="w-16 h-16 rounded-2xl bg-surface-card border border-surface-border flex items-center justify-center mb-4">
                <Video className="w-8 h-8 text-text-tertiary/50" />
              </div>
              <p className="text-sm">{t("video.emptyHint")}</p>
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

            const videoUrl = resolveMediaUrl(msg.videoUrl);
            return (
              <div key={msg.id} className="flex justify-start">
                <div className="w-[min(90vw,36rem)] md:w-[36rem] max-w-[90%] space-y-2">
                  {(msg.status === "pending" || msg.status === "running" || generating) && !videoUrl && (
                    <div className="relative w-full aspect-video rounded-2xl rounded-tl-sm bg-gradient-to-br from-brand/10 via-purple-500/10 to-surface-card border border-surface-border overflow-hidden">
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
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10 px-6 text-center">
                        <div className="flex items-center gap-1.5 rounded-full bg-black/35 px-3 py-1.5 text-sm text-white backdrop-blur-sm">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>{t("video.generating")}</span>
                        </div>
                        <p className="text-xs text-white/50 max-w-[70%] line-clamp-2">
                          {msg.content}
                        </p>
                      </div>
                    </div>
                  )}

                  {msg.status === "failed" && (
                    <div className="rounded-2xl rounded-tl-sm bg-red-500/5 border border-red-500/20 p-4">
                      <p className="text-sm text-red-400">{t("video.generationFailedRetry")}</p>
                      <p className="text-[11px] text-text-tertiary mt-1">{msg.errorMessage || msg.content}</p>
                    </div>
                  )}

                  {videoUrl && (
                    <div className="rounded-2xl rounded-tl-sm bg-surface-card border border-surface-border overflow-hidden group">
                      <video src={videoUrl} controls className="w-full max-h-[70vh] bg-surface object-contain" />
                      <div className="px-3 py-2 border-t border-surface-border">
                        <p className="text-xs text-text-secondary line-clamp-2">{msg.content}</p>
                        <p className="text-[10px] text-text-tertiary mt-0.5">{msg.createdAt.toLocaleString()}</p>
                      </div>
                      <div className="flex items-center gap-0.5 px-3 py-2 border-t border-surface-border">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(msg.content);
                            toast.success(t("video.promptCopied"));
                          }}
                          className="p-1.5 rounded-md hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors"
                          title={t("video.copyPrompt")}
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            setPrompt(msg.content);
                            scrollToBottom("smooth", true);
                          }}
                          className="p-1.5 rounded-md hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors"
                          title={t("video.usePrompt")}
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDownload(videoUrl, msg.generationId || msg.id || "preview")}
                          className="p-1.5 rounded-md hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors"
                          title={t("common.download")}
                        >
                          <Download className="w-4 h-4" />
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

      <div className="shrink-0 border-t border-surface-border px-4 md:px-6 py-3">
        <div className="max-w-3xl mx-auto">
          <div
            className={cn(
              "relative flex flex-col rounded-2xl border transition-all duration-300 bg-surface-card",
              hasReferenceMedia ? "border-brand/20 focus-within:border-brand/40" : "border-surface-border focus-within:border-brand/30"
            )}
          >
            {/* 右上角按钮：历史记录 + 新建会话 */}
            <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
              <button
                onClick={() => setShowHistory((s) => !s)}
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

            <div className="flex items-start gap-3 px-4 pt-3 pb-2">
              <div className="mt-1 flex max-w-[140px] flex-wrap gap-2">
                {!hasReferenceMedia ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingRef || generating}
                    className={cn(
                      "relative shrink-0 w-9 h-16 rounded-xl bg-surface-card border border-surface-border flex items-center justify-center transition-all hover:border-brand/40",
                      (uploadingRef || generating) && "cursor-not-allowed opacity-60"
                    )}
                    title={t("video.uploadReferenceMedia")}
                  >
                    {uploadingRef ? <Loader2 className="w-4 h-4 text-text-tertiary animate-spin" /> : <Plus className="w-4 h-4 text-text-tertiary" />}
                  </button>
                ) : (
                  <>
                    {referenceImages.slice(0, 2).map((url, index) => (
                      <div key={`image-${url}-${index}`} className="relative shrink-0">
                        <div className="w-9 h-16 rounded-xl overflow-hidden border border-surface-border">
                          <img src={resolveMediaUrl(url)} alt={t("image.referenceAlt")} className="w-full h-full object-cover" />
                        </div>
                        <button
                          type="button"
                          onClick={() => setReferenceImages((prev) => prev.filter((_, i) => i !== index))}
                          disabled={generating}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-surface-elevated border border-surface-border shadow-md text-text-secondary hover:text-red-500 flex items-center justify-center z-20"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    {referenceVideos.slice(0, 2).map((url, index) => (
                      <div key={`video-${url}-${index}`} className="relative shrink-0">
                        <div className="relative w-9 h-16 rounded-xl overflow-hidden border border-surface-border bg-surface-elevated">
                          <video src={resolveMediaUrl(url)} className="h-full w-full object-cover" muted playsInline />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                            <Video className="h-4 w-4 text-white" />
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setReferenceVideos((prev) => prev.filter((_, i) => i !== index))}
                          disabled={generating}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-surface-elevated border border-surface-border shadow-md text-text-secondary hover:text-red-500 flex items-center justify-center z-20"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    {(referenceImages.length < MAX_REFERENCE_IMAGES || referenceVideos.length < MAX_REFERENCE_VIDEOS) && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingRef || generating}
                        className={cn(
                          "relative shrink-0 w-9 h-16 rounded-xl bg-surface-card border border-surface-border flex items-center justify-center transition-all hover:border-brand/40",
                          (uploadingRef || generating) && "cursor-not-allowed opacity-60"
                        )}
                        title={t("video.uploadMoreReference")}
                      >
                        {uploadingRef ? <Loader2 className="w-4 h-4 text-text-tertiary animate-spin" /> : <Plus className="w-4 h-4 text-text-tertiary" />}
                      </button>
                    )}
                  </>
                )}
              </div>

              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t("image.prompt.video")}
                disabled={generating}
                className={cn(
                  "flex-1 min-h-[60px] max-h-[160px] bg-transparent text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none text-[15px] leading-relaxed py-2 pr-16",
                  generating && "opacity-60 cursor-not-allowed"
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

            <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setModelMenuOpen((open) => !open)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] text-text-secondary border-surface-border hover:border-brand/30 hover:text-text-primary transition-colors"
                  >
                    <Layers className="w-3 h-3" />
                    <span>{selectedModelInfo?.name || t("video.model")}</span>
                    <ChevronDown className={cn("w-3 h-3 transition-transform", modelMenuOpen && "rotate-180")} />
                  </button>
                  {modelMenuOpen && (
                    <div className="absolute left-0 bottom-full mb-2 w-64 rounded-xl border border-surface-border bg-surface-elevated p-1 shadow-xl z-30">
                      {videoModels.map((model) => (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => {
                            setSelectedModel(model.id);
                            setModelMenuOpen(false);
                          }}
                          className={cn(
                            "w-full rounded-lg px-3 py-2 text-left text-xs transition-colors",
                            selectedModel === model.id ? "bg-surface-card text-text-primary font-medium shadow-sm" : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                          )}
                        >
                          <div className="font-medium">{model.name}</div>
                          <div className="mt-0.5 text-[10px] text-text-tertiary">{model.provider}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

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
                    <div className="absolute left-0 bottom-full mb-2 w-64 rounded-xl border border-surface-border bg-surface-elevated p-3 shadow-xl z-30">
                      <div className="mb-2 text-xs font-medium text-text-primary">{t("video.aspectRatio")}</div>
                      <div className="grid grid-cols-3 gap-2">
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
                              selectedAspectRatio === ratio.value ? "border-surface-border bg-surface-card text-text-primary font-medium shadow-sm" : "border-surface-border text-text-secondary hover:border-text-tertiary/40 hover:text-text-primary"
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

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setResolutionMenuOpen((open) => !open)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] text-text-secondary border-surface-border hover:border-brand/30 hover:text-text-primary transition-colors"
                  >
                    <span>{selectedResolution}</span>
                    <ChevronDown className={cn("w-3 h-3 transition-transform", resolutionMenuOpen && "rotate-180")} />
                  </button>
                  {resolutionMenuOpen && (
                    <div className="absolute left-0 bottom-full mb-2 w-28 rounded-xl border border-surface-border bg-surface-elevated p-1 shadow-xl z-30">
                      {availableResolutions.map((resolution) => (
                        <button
                          key={resolution}
                          type="button"
                          onClick={() => {
                            setSelectedResolution(resolution);
                            setResolutionMenuOpen(false);
                          }}
                          className={cn(
                            "w-full rounded-lg px-3 py-2 text-left text-xs transition-colors",
                            selectedResolution === resolution ? "bg-surface-card text-text-primary font-medium shadow-sm" : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                          )}
                        >
                          {resolution}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setDurationMenuOpen((open) => !open)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] text-text-secondary border-surface-border hover:border-brand/30 hover:text-text-primary transition-colors"
                  >
                    <Video className="w-3 h-3" />
                    <span>{selectedDuration}</span>
                    <ChevronDown className={cn("w-3 h-3 transition-transform", durationMenuOpen && "rotate-180")} />
                  </button>
                  {durationMenuOpen && (
                    <div className="absolute left-0 bottom-full mb-2 w-28 rounded-xl border border-surface-border bg-surface-elevated p-1 shadow-xl z-30">
                      {DURATIONS.map((duration) => (
                        <button
                          key={duration}
                          type="button"
                          onClick={() => {
                            setSelectedDuration(duration);
                            setDurationMenuOpen(false);
                          }}
                          className={cn(
                            "w-full rounded-lg px-3 py-2 text-left text-xs transition-colors",
                            selectedDuration === duration ? "bg-surface-card text-text-primary font-medium shadow-sm" : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                          )}
                        >
                          {duration}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setMusicEnabled((enabled) => !enabled)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition-all duration-200",
                    musicEnabled
                      ? "border-purple-400/50 bg-purple-500/10 text-purple-500"
                      : "border-surface-border text-text-secondary hover:border-text-tertiary/40 hover:text-text-primary"
                  )}
                >
                  <Music className="w-3 h-3" />
                  <span>{t("video.soundtrack")}</span>
                </button>
              </div>

              {generating ? (
                <button disabled className="flex items-center justify-center w-9 h-9 rounded-full bg-text-tertiary/30 text-white cursor-not-allowed">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={!hasContent}
                  className={cn(
                    "flex items-center justify-center w-9 h-9 rounded-full transition-all duration-200",
                    hasContent ? "bg-brand text-white hover:bg-brand-hover" : "bg-text-tertiary/20 text-text-tertiary cursor-not-allowed"
                  )}
                >
                  <Send className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* 历史记录面板 */}
      <CreationHistoryPanel
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        title={t("video.historyTitle")}
        items={chats.map((c) => ({
          id: c.id,
          title: c.title,
          active: currentChatId === c.id,
          updated_at: c.updated_at,
          source: "video" as const,
          cover_image: c.cover_video,
          status: c.status,
        }))}
        onSelect={handleSelectVideo}
        onNew={handleNewChat}
        onDelete={(id) => {
          setDeleteTargetId(id);
          setShowHistory(false);
        }}
        loading={chatsLoading}
      />

      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        title={t("video.deleteChatTitle")}
        description={t("video.deleteChatDesc")}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTargetId(null)}
        variant="danger"
      />

      <NoticeDialog
        isOpen={limitDialogOpen}
        title={t("video.limitTitle")}
        description={t("video.limitDesc")}
        confirmText={t("video.gotIt")}
        onConfirm={() => setLimitDialogOpen(false)}
      />
    </div>
  );
}
