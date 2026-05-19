"use client";

import { Suspense } from "react";
import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useImageChats, useImageChatMessages, ImageChatMessage } from "@/hooks/useImageChat";
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
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import ImageLightbox from "@/components/ui/ImageLightbox";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "pending" | "completed" | "failed";
  imageUrl?: string;
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

  const { chats, fetchChats, createChat, deleteChat } = useImageChats();
  const { messages: apiMessages, fetchMessages, sendMessage } = useImageChatMessages();

  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [uploadingRef, setUploadingRef] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [chatId, setChatId] = useState<number | null>(null);
  const [pollingChatId, setPollingChatId] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 解析 URL 参数
  const initialPrompt = searchParams.get("prompt") || "";
  const initialAspect = searchParams.get("aspect") || "1:1";
  const initialResolution = searchParams.get("resolution") || "1K";
  const initialQuality = searchParams.get("quality") || "medium";
  const initialRefs = searchParams.get("refs");
  const initialRefImages = initialRefs ? initialRefs.split(",") : [];
  const urlChatId = searchParams.get("chatId");

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

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
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
    }, 3000);

    pollTimer.current = timer;
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollingChatId]);

  const handleSend = async (
    text: string,
    aspect: string = "1:1",
    resolution: string = "1K",
    quality: string = "medium",
    refs: string[] = []
  ) => {
    if (!text.trim()) {
      toast.error("请输入描述");
      return;
    }
    setIsGenerating(true);

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
      toast.error(err.message || "发送失败");
      setIsGenerating(false);
    }
  };

  const handleSubmit = () => {
    handleSend(prompt, initialAspect, initialResolution, initialQuality, referenceImages);
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

  const handleDeleteChat = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
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

  return (
    <div className="flex flex-col h-full bg-surface">
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
      <div className="flex-1 overflow-auto px-4 md:px-6 py-4">
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
                    <div className="rounded-2xl rounded-tl-sm bg-surface-card border border-surface-border p-6">
                      <div className="flex flex-col items-center gap-3 text-text-tertiary">
                        <div className="relative">
                          <Loader2 className="w-8 h-8 animate-spin text-brand/40" />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <ImageIcon className="w-3.5 h-3.5 text-brand" />
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>图片生成中...</span>
                        </div>
                        <p className="text-[11px] text-text-tertiary/60 max-w-[80%] text-center line-clamp-2">
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
                            scrollToBottom();
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
      {showHistory && (
        <div className="shrink-0 border-t border-surface-border bg-surface-elevated px-4 md:px-6 py-3 max-h-[40vh] overflow-auto">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-text-primary">历史记录</h3>
              <button
                onClick={() => setShowHistory(false)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {chats.length === 0 ? (
              <p className="text-sm text-text-tertiary py-4 text-center">暂无历史记录</p>
            ) : (
              <div className="space-y-1">
                {chats.map((chat) => (
                  <div
                    key={chat.id}
                    onClick={() => handleSelectChat(chat.id)}
                    className={cn(
                      "flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-colors",
                      chatId === chat.id
                        ? "bg-brand/10 border border-brand/20"
                        : "hover:bg-surface-card border border-transparent"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <ImageIcon className="w-4 h-4 text-text-tertiary shrink-0" />
                      <span className="text-sm text-text-primary truncate">{chat.title}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <ChevronRight className="w-4 h-4 text-text-tertiary" />
                      <button
                        onClick={(e) => handleDeleteChat(chat.id, e)}
                        className="p-1 rounded-md hover:bg-red-500/10 text-text-tertiary hover:text-red-500 transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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
            <div className="flex items-center justify-between px-4 pb-3 pt-1">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] text-text-tertiary border-surface-border">
                  <span>{initialAspect}</span>
                  <span>·</span>
                  <span>{initialResolution}</span>
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
    </div>
  );
}
