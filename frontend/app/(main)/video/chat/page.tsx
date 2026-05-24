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
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import NoticeDialog from "@/components/ui/NoticeDialog";
import HistoryDrawer from "@/components/ui/HistoryDrawer";
import DeleteSuccessNotice from "@/components/ui/DeleteSuccessNotice";

const ASPECT_RATIOS = [
  { value: "auto", label: "Auto", w: 1, h: 1 },
  { value: "1:1", label: "1:1", w: 1, h: 1 },
  { value: "4:3", label: "4:3", w: 4, h: 3 },
  { value: "3:4", label: "3:4", w: 3, h: 4 },
  { value: "16:9", label: "16:9", w: 16, h: 9 },
  { value: "9:16", label: "9:16", w: 9, h: 16 },
  { value: "21:9", label: "21:9", w: 21, h: 9 },
];

const DURATIONS = ["4s", "8s", "12s"];

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
        className={cn("rounded-sm border-2 transition-colors", active ? "border-brand bg-brand/20" : "border-text-tertiary/50")}
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

function messageToDisplayMessage(message: VideoChatMessage): DisplayMessage {
  return {
    id: `${message.role}-${message.id}`,
    role: message.role === "user" ? "user" : "assistant",
    content: message.content,
    status: message.status,
    videoUrl: message.video_url,
    errorMessage: message.error_message,
    createdAt: new Date(message.created_at || Date.now()),
    generationId: message.generation_id,
  };
}

function messagesToDisplayMessages(messages: VideoChatMessage[]): DisplayMessage[] {
  return messages.map(messageToDisplayMessage);
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
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [uploadingRef, setUploadingRef] = useState(false);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState(searchParams.get("aspect") || "auto");
  const [selectedDuration, setSelectedDuration] = useState(searchParams.get("duration") || "4s");
  const [musicEnabled, setMusicEnabled] = useState(searchParams.get("audio") === "1");
  const [selectedModel, setSelectedModel] = useState(searchParams.get("model") || "");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);
  const [durationMenuOpen, setDurationMenuOpen] = useState(false);
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
  const hasContent = prompt.trim().length > 0;

  useEffect(() => {
    if (!selectedModel && videoModels.length > 0) {
      setSelectedModel(videoModels[0].id);
    }
  }, [videoModels, selectedModel]);

  useEffect(() => {
    const refs = searchParams.get("refs");
    if (refs) setReferenceImages(refs.split(",").filter(Boolean));
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
    setDisplayMessages(messagesToDisplayMessages(messages));
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
    const hasPending = displayMessages.some((msg) => msg.role === "assistant" && !msg.videoUrl && ["pending", "running"].includes(msg.status || ""));
    if (!hasPending) return;
    const timer = window.setInterval(() => {
      fetchMessages(currentChatId);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [currentChatId, displayMessages, fetchMessages]);

  const handleSend = useCallback(async (text: string) => {
    const cleanPrompt = text.trim();
    if (!cleanPrompt) {
      toast.error("请输入描述");
      return;
    }
    const model = selectedModelInfo?.id || selectedModel;
    if (!model) {
      toast.error("无可用的视频模型");
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
      const durationSec = parseInt(selectedDuration.replace("s", ""), 10) || 4;
      const payload = {
        prompt: cleanPrompt,
        model,
        ratio: selectedAspectRatio,
        duration: durationSec,
        generate_audio: musicEnabled,
        watermark: false,
        reference_image_urls: referenceImages.length > 0 ? referenceImages : undefined,
      };

      let chatId = currentChatId;
      if (chatId) {
        await sendMessage(chatId, payload);
      } else {
        const created = await createChat(payload);
        chatId = created.chat_id || created.chat?.id;
        if (!chatId) throw new Error("创建视频会话失败");
        setCurrentChatId(chatId);
        router.replace(`/video/chat?chatId=${chatId}`);
      }

      setPrompt("");
      setReferenceImages([]);
      await fetchMessages(chatId);
      fetchChats();
    } catch (err: any) {
      const msg = err.message || "提交失败";
      if (msg.includes("历史记录只能保存")) {
        setLimitDialogOpen(true);
        // 移除刚才添加的临时消息
        setDisplayMessages((prev) =>
          prev.filter((m) => m.id !== localAssistantMessage.id && m.id !== localUserMessage.id)
        );
      } else {
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
  }, [createChat, currentChatId, fetchChats, fetchMessages, musicEnabled, referenceImages, router, selectedAspectRatio, selectedDuration, selectedModel, selectedModelInfo, sendMessage]);

  useEffect(() => {
    const initialPrompt = searchParams.get("prompt") || "";
    if (!initialPrompt || autoSubmittedRef.current) return;
    if (!selectedModelInfo && videoModels.length === 0) return;
    autoSubmittedRef.current = true;
    handleSend(initialPrompt);
  }, [handleSend, searchParams, selectedModelInfo, videoModels.length]);

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
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "上传失败");
      }
      const data = await res.json();
      const url = data.public_id || data.url || data.image_url;
      setReferenceImages((prev) => [...prev, url]);
    } catch (err: any) {
      toast.error(`上传失败: ${err.message}`);
    } finally {
      setUploadingRef(false);
    }
  };

  const handleSubmit = () => handleSend(prompt);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    uploadReferenceImage(file);
  };

  const handleDownload = async (url: string, id: number | string) => {
    try {
      const response = await fetch(resolveMediaUrl(url));
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `aispace-video-${id}.mp4`;
      link.click();
      toast.success("下载已开始");
    } catch {
      toast.error("下载失败");
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
      toast.error("删除失败");
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
    router.replace("/video/chat");
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
      <DeleteSuccessNotice open={deleteSuccessOpen} label="视频会话" onClose={() => setDeleteSuccessOpen(false)} />
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />

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
            <h1 className="text-sm font-semibold text-text-primary">AI视频</h1>
            <p className="text-[11px] text-text-tertiary">视频生成助手</p>
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
              <p className="text-sm">在下方输入描述开始创作视频</p>
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
                    <div className="relative w-full aspect-video rounded-2xl rounded-tl-sm bg-surface-card border border-surface-border overflow-hidden">
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
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 px-6 text-center">
                        <div className="flex items-center gap-1.5 rounded-full bg-black/35 px-3 py-1.5 text-sm text-white backdrop-blur-sm">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>视频生成中...</span>
                        </div>
                        <p className="text-xs text-white/75 max-w-[70%] line-clamp-2">
                          {msg.content}
                        </p>
                      </div>
                    </div>
                  )}

                  {msg.status === "failed" && (
                    <div className="rounded-2xl rounded-tl-sm bg-red-500/5 border border-red-500/20 p-4">
                      <p className="text-sm text-red-400">生成失败，请重试</p>
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
                            toast.success("提示词已复制");
                          }}
                          className="p-1.5 rounded-md hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors"
                          title="复制此提示"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            setPrompt(msg.content);
                            scrollToBottom("smooth", true);
                          }}
                          className="p-1.5 rounded-md hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors"
                          title="使用此提示"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDownload(videoUrl, msg.generationId || msg.id || "preview")}
                          className="p-1.5 rounded-md hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors"
                          title="下载"
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
              referenceImages.length > 0 ? "border-brand/20 focus-within:border-brand/40" : "border-surface-border focus-within:border-brand/30"
            )}
          >
            {/* 右上角按钮：历史记录 + 新建会话 */}
            <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
              <button
                onClick={() => setShowHistory((s) => !s)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors"
                title="历史记录"
              >
                <History className="w-4 h-4" />
              </button>
              <button
                onClick={handleNewChat}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-brand hover:text-brand-hover hover:bg-brand/10 transition-colors"
                title="新建会话"
              >
                <MessageSquarePlus className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-start gap-3 px-4 pt-3 pb-2">
              <div className="mt-1">
                {referenceImages.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingRef || generating}
                    className={cn(
                      "relative shrink-0 w-9 h-16 rounded-xl bg-surface-card border border-surface-border flex items-center justify-center transition-all hover:border-brand/40",
                      (uploadingRef || generating) && "cursor-not-allowed opacity-60"
                    )}
                    title="上传参考图"
                  >
                    {uploadingRef ? <Loader2 className="w-4 h-4 text-text-tertiary animate-spin" /> : <Plus className="w-4 h-4 text-text-tertiary" />}
                  </button>
                ) : (
                  <div className="relative shrink-0">
                    <div className="w-9 h-16 rounded-xl overflow-hidden border border-surface-border">
                      <img src={resolveMediaUrl(referenceImages[0])} alt="参考图" className="w-full h-full object-cover" />
                    </div>
                    <button
                      type="button"
                      onClick={() => setReferenceImages((prev) => prev.slice(1))}
                      disabled={generating}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-surface-elevated border border-surface-border shadow-md text-text-secondary hover:text-red-500 flex items-center justify-center z-20"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>

              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="尝试描述您想要创建的视频..."
                disabled={generating}
                className={cn(
                  "flex-1 min-h-[60px] max-h-[160px] bg-transparent text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none text-[15px] leading-relaxed py-2",
                  generating && "opacity-60 cursor-not-allowed"
                )}
                onKeyDown={(e) => {
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
                    <span>{selectedModelInfo?.name || "视频模型"}</span>
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
                            selectedModel === model.id ? "bg-brand/10 text-brand" : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
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
                      <div className="mb-2 text-xs font-medium text-text-primary">视频比例</div>
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
                              selectedAspectRatio === ratio.value ? "border-brand bg-brand/10 text-brand" : "border-surface-border text-text-secondary hover:border-brand/30 hover:text-text-primary"
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
                            selectedDuration === duration ? "bg-brand/10 text-brand" : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
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
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] transition-colors",
                    musicEnabled ? "border-brand bg-brand/10 text-brand" : "border-surface-border text-text-secondary hover:border-brand/30 hover:text-text-primary"
                  )}
                >
                  <Music className="w-3 h-3" />
                  <span>配乐</span>
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
      <HistoryDrawer
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        title="AI视频历史"
        items={chats.map((chat) => ({
          id: chat.id,
          title: chat.title,
          active: currentChatId === chat.id,
          updated_at: chat.updated_at,
          cover_image: chat.cover_video,
          source: "video" as const,
        }))}
        onSelect={handleSelectVideo}
        onNew={handleNewChat}
        onDelete={(id) => {
          setDeleteTargetId(id);
          setShowHistory(false);
        }}
        loading={chatsLoading}
        type="image"
      />

      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        title="删除视频会话"
        description="确定要删除这个视频会话吗？此操作不可撤销。"
        confirmText="删除"
        cancelText="取消"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTargetId(null)}
        variant="danger"
      />

      <NoticeDialog
        isOpen={limitDialogOpen}
        title="会话数量已满"
        description="历史记录只能保存8条会话，如需新建，请先删除旧会话。"
        confirmText="我知道了"
        onConfirm={() => setLimitDialogOpen(false)}
      />
    </div>
  );
}
