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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import ImageLightbox from "@/components/ui/ImageLightbox";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import NoticeDialog from "@/components/ui/NoticeDialog";
import HistoryDrawer from "@/components/ui/HistoryDrawer";

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
        active ? "border-brand/50 bg-brand/10" : "border-surface-border bg-surface"
      )}
    >
      <div
        className={cn("rounded-sm border-2 transition-colors", active ? "border-brand bg-brand/20" : "border-text-tertiary/50")}
        style={{ width: boxW, height: boxH }}
      />
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
    errorMessage: m.error_message,
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

  // 将 API 消息映射为显示消息
  useEffect(() => {
    if (apiMessages.length > 0) {
      setDisplayMessages(apiMessages.map(msgToDisplay));
    }
  }, [apiMessages]);

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

  // 轮询
  useEffect(() => {
    if (!pollingChatId) return;

    const timer = setInterval(async () => {
      try {
        const msgs = await fetchMessages(pollingChatId);
        const pending = msgs.find((m) => m.role === "assistant" && m.status === "pending");
        if (!pending) {
          clearInterval(timer);
          setPollingChatId(null);
          setIsGenerating(false);
        }
      } catch {
        // ignore
      }
    }, 1000);

    pollTimer.current = timer;
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollingChatId]);

  const handleSend = async (
    text: string,
    aspect: string = "auto",
    resolution: string = "1K",
    quality: string = "medium",
    refs: string[] = []
  ) => {
    if (!text.trim()) {
      toast.error("请输入描述");
      return;
    }
    setIsGenerating(true);
    shouldAutoScrollRef.current = true;

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
        setPollingChatId(newChat.id);
        await fetchMessages(newChat.id);
        fetchChats();
      } else {
        // 在现有会话中发送
        await sendMessage(chatId, payload);
        setPollingChatId(chatId);
        await fetchMessages(chatId);
        fetchChats();
      }

      setPrompt("");
      setReferenceImages([]);
    } catch (err: any) {
      const msg = err.message || "发送失败";
      if (msg.includes("历史记录只能保存")) {
        setLimitDialogOpen(true);
      } else {
        toast.error(msg);
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
      toast.success("下载已开始");
    } catch {
      toast.error("下载失败");
    }
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
    router.replace("/image/chat");
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
      toast.success("删除成功");
      if (chatId === id) {
        handleNewChat();
      }
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* 顶部标题栏 */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-surface-border">
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
            <h1 className="text-sm font-semibold text-text-primary">AI画图</h1>
            <p className="text-[11px] text-text-tertiary">图像生成助手</p>
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
              <p className="text-sm">在下方输入描述开始创作</p>
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
                <div className="max-w-[90%] md:max-w-[70%] space-y-2">
                  {msg.status === "pending" && (
                    <div className="rounded-2xl rounded-tl-sm bg-surface-card border border-surface-border overflow-hidden">
                      {msg.partialImageUrl && (
                        <div className="relative">
                          <img
                            src={resolveImageUrl(msg.partialImageUrl)}
                            alt={msg.content}
                            className="w-full max-h-[70vh] object-contain bg-surface"
                          />
                          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-surface-card/90 border border-surface-border px-2.5 py-1 text-[11px] text-text-secondary backdrop-blur">
                            <Loader2 className="w-3 h-3 animate-spin text-brand" />
                            <span>生成中 · partial image</span>
                          </div>
                        </div>
                      )}
                      <div className="p-6">
                        <div className="flex flex-col items-center gap-3 text-text-tertiary">
                          {!msg.partialImageUrl && (
                            <div className="relative">
                              <Loader2 className="w-8 h-8 animate-spin text-brand/40" />
                              <div className="absolute inset-0 flex items-center justify-center">
                                <ImageIcon className="w-3.5 h-3.5 text-brand" />
                              </div>
                            </div>
                          )}
                          <div className="flex items-center gap-1.5 text-xs">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>{msg.partialImageUrl ? "继续细化中..." : "图片生成中..."}</span>
                          </div>
                          <p className="text-[11px] text-text-tertiary/60 max-w-[80%] text-center line-clamp-2">
                            {msg.content}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {msg.status === "failed" && (
                    <div className="rounded-2xl rounded-tl-sm bg-red-500/5 border border-red-500/20 p-4">
                      <p className="text-sm text-red-400">生成失败，请重试</p>
                      <p className="text-[11px] text-text-tertiary mt-1">{msg.errorMessage || msg.content}</p>
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
                          onClick={() =>
                            handleSend(
                              msg.content,
                              initialAspect,
                              initialResolution,
                              initialQuality
                            )
                          }
                          className="p-1.5 rounded-md hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors"
                          title="重新生成"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteTargetId(msg.id)}
                          className="p-1.5 rounded-md hover:bg-red-500/10 text-text-tertiary hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                          title="删除"
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
      <HistoryDrawer
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        title="AI画图历史"
        items={chats.map((c) => ({
          id: c.id,
          title: c.title,
          active: chatId === c.id,
          updated_at: c.updated_at,
          cover_image: c.cover_image,
        }))}
        onSelect={handleSelectChat}
        onNew={handleNewChat}
        onRename={handleRenameChat}
        onDelete={handleDeleteChat}
        loading={false}
        type="image"
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

            {/* 输入区 */}
            <div className="flex items-start gap-3 px-4 pt-3 pb-2">
              <div className="mt-1">
                {referenceImages.length === 0 ? (
                  <div
                    className={cn(
                      "relative shrink-0 w-9 h-16 rounded-xl bg-surface-card border border-surface-border flex items-center justify-center transition-all cursor-pointer hover:border-brand/40",
                      uploadingRef && "cursor-not-allowed opacity-60"
                    )}
                    onClick={handleAddImage}
                  >
                    {uploadingRef ? (
                      <Loader2 className="w-4 h-4 text-text-tertiary animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4 text-text-tertiary" />
                    )}
                  </div>
                ) : (
                  <div className="relative shrink-0">
                    <div className="w-9 h-16 rounded-xl overflow-hidden border border-surface-border">
                      <img
                        src={resolveImageUrl(referenceImages[0])}
                        alt="参考图"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <button
                      onClick={() => handleRemoveImage(0)}
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
                placeholder="尝试描述您想要创建的图像..."
                disabled={isGenerating}
                className={cn(
                  "flex-1 min-h-[60px] max-h-[160px] bg-transparent text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none text-[15px] leading-relaxed py-2",
                  isGenerating && "opacity-60 cursor-not-allowed"
                )}
                onKeyDown={(e) => {
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
                              ? "bg-brand/10 text-brand"
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
                      <div className="mb-2 text-xs font-medium text-text-primary">图片比例</div>
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
                                ? "border-brand bg-brand/10 text-brand"
                                : "border-surface-border text-text-secondary hover:border-brand/30 hover:text-text-primary"
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
                          ? "bg-brand text-white"
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
                          ? "bg-brand text-white"
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
        title="删除图片"
        description="确定要删除这张图片吗？此操作不可撤销。"
        confirmText="删除"
        cancelText="取消"
        onConfirm={() => {
          if (deleteTargetId) handleDeleteMessageImage(deleteTargetId);
          setDeleteTargetId(null);
        }}
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
