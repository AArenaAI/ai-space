"use client";

import { Suspense } from "react";
import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useImage, GeneratedImage } from "@/hooks/useImage";
import { useImageModels, ChatModel } from "@/hooks/useModels";
import {
  Loader2,
  Send,
  ArrowLeft,
  ImageIcon,
  Plus,
  X,
  RefreshCw,
  Download,
  Trash2,
  ZoomIn,
  Copy,
  MessageSquarePlus,
  History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import ImageLightbox from "@/components/ui/ImageLightbox";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "pending" | "completed" | "failed";
  image?: GeneratedImage;
  createdAt: Date;
}

const API_BASE_URL = "";

async function safeJSON(res: Response): Promise<any> {
  const text = await res.text();
  if (!text || text.trim() === "") {
    throw new Error(`服务器返回空响应 (HTTP ${res.status})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`服务器返回异常 (HTTP ${res.status}): ${text.slice(0, 100)}`);
  }
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
  const { images, fetchImages } = useImage();
  const { models: imageModels } = useImageModels();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewImage, setPreviewImage] = useState<GeneratedImage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [uploadingRef, setUploadingRef] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [currentTaskId, setCurrentTaskId] = useState<number | null>(null);

  // 滚动到底部
  const [showHistory, setShowHistory] = useState(false);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 解析初始参数
  const initialPrompt = searchParams.get("prompt") || "";
  const initialAspect = searchParams.get("aspect") || "1:1";
  const initialResolution = searchParams.get("resolution") || "1K";
  const initialQuality = searchParams.get("quality") || "medium";
  const initialRefs = searchParams.get("refs");
  const initialRefImages = initialRefs ? initialRefs.split(",") : [];

  // 页面加载时如果有初始 prompt，自动发起生成
  useEffect(() => {
    if (initialPrompt && messages.length === 0) {
      handleGenerate(initialPrompt, initialAspect, initialResolution, initialQuality, initialRefImages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  // 轮询当前任务状态
  useEffect(() => {
    if (!currentTaskId) return;

    const timer = setInterval(async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch(`${API_BASE_URL}/api/images`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await safeJSON(res);
        const allImages: GeneratedImage[] = data.images || [];
        const task = allImages.find((img) => img.id === currentTaskId);
        if (!task) return;

        if (task.status === "completed" || task.status === "failed") {
          clearInterval(timer);
          setCurrentTaskId(null);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.role === "assistant" && msg.status === "pending" && msg.image?.id === currentTaskId
                ? { ...msg, status: task.status as "completed" | "failed", image: task }
                : msg
            )
          );
        }
      } catch {
        // ignore poll errors
      }
    }, 3000);

    pollTimer.current = timer;
    return () => clearInterval(timer);
  }, [currentTaskId]);

  const handleGenerate = async (
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

    // 添加用户消息
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date(),
    };

    // 添加 AI pending 消息
    const assistantMsg: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: text,
      status: "pending",
      createdAt: new Date(),
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setPrompt("");
    setReferenceImages([]);

    try {
      const token = localStorage.getItem("token");
      const body: Record<string, any> = {
        prompt: text,
        aspect_ratio: aspect,
        resolution,
        quality,
      };
      if (refs.length > 0) {
        body.reference_image_urls = refs;
      }
      const response = await fetch(`${API_BASE_URL}/api/images/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await safeJSON(response);
        throw new Error(err.error || `生成图片失败 (${response.status})`);
      }

      const data = await safeJSON(response);
      setCurrentTaskId(data.id);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsg.id ? { ...msg, image: data } : msg
        )
      );
    } catch (err: any) {
      toast.error(err.message || "生成失败");
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsg.id ? { ...msg, status: "failed" } : msg
        )
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = () => {
    handleGenerate(prompt, initialAspect, initialResolution, initialQuality, referenceImages);
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

  const handleDelete = async (id: number) => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_BASE_URL}/api/images/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("删除失败");
      toast.success("删除成功");
      setMessages((prev) => prev.filter((msg) => msg.image?.id !== id));
    } catch {
      toast.error("删除失败");
    }
  };

  const resolveImageUrl = (url: string) => {
    if (url.startsWith("file_")) {
      return `/api/files/${url}/view`;
    }
    return url;
  };

  const hasContent = prompt.trim().length > 0;

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
          {messages.length === 0 && !initialPrompt && (
            <div className="flex flex-col items-center justify-center h-full text-text-tertiary py-20">
              <div className="w-16 h-16 rounded-2xl bg-surface-card border border-surface-border flex items-center justify-center mb-4">
                <ImageIcon className="w-8 h-8 text-text-tertiary/50" />
              </div>
              <p className="text-sm">在下方输入描述开始创作</p>
            </div>
          )}

          {messages.map((msg) => {
            if (msg.role === "user") {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-brand/10 px-4 py-2.5 text-sm text-text-primary">
                    {msg.content}
                  </div>
                </div>
              );
            }

            // assistant message
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
                      <p className="text-[11px] text-text-tertiary mt-1">{msg.content}</p>
                    </div>
                  )}

                  {msg.status === "completed" && msg.image && (
                    <div className="rounded-2xl rounded-tl-sm bg-surface-card border border-surface-border overflow-hidden group">
                      <div className="relative aspect-auto">
                        <img
                          src={msg.image.image_url}
                          alt={msg.image.prompt}
                          className="w-full max-h-[70vh] object-contain cursor-zoom-in bg-surface"
                          onClick={() => setPreviewImage(msg.image!)}
                        />
                      </div>
                      <div className="px-3 py-2 border-t border-surface-border">
                        <p className="text-xs text-text-secondary line-clamp-2">{msg.image.prompt}</p>
                        <p className="text-[10px] text-text-tertiary mt-0.5">
                          {new Date(msg.image.created_at).toLocaleString()}
                        </p>
                      </div>
                      {/* 图片下方工具栏 */}
                      <div className="flex items-center gap-0.5 px-3 py-2 border-t border-surface-border">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(msg.image!.prompt);
                            toast.success("提示词已复制");
                          }}
                          className="p-1.5 rounded-md hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors"
                          title="复制此提示"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            setPrompt(msg.image!.prompt);
                            scrollToBottom();
                          }}
                          className="p-1.5 rounded-md hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors"
                          title="使用此提示"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() =>
                            handleGenerate(
                              msg.image!.prompt,
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
                          onClick={() => setDeleteTarget(msg.image!.id)}
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
            {images.length === 0 ? (
              <p className="text-sm text-text-tertiary py-4 text-center">暂无历史记录</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {images.map((img) => (
                  <div
                    key={img.id}
                    className="relative aspect-square rounded-xl overflow-hidden border border-surface-border cursor-pointer group"
                    onClick={() => {
                      const msg: ChatMessage = {
                        id: `assistant-${img.id}`,
                        role: "assistant",
                        content: img.prompt,
                        status: "completed",
                        image: img,
                        createdAt: new Date(img.created_at),
                      };
                      setMessages((prev) => [...prev, msg]);
                      setShowHistory(false);
                      scrollToBottom();
                    }}
                  >
                    <img
                      src={img.image_url}
                      alt={img.prompt}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-[10px] text-white px-2 text-center line-clamp-2">
                        {img.prompt}
                      </span>
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
                onClick={() => setShowHistory(!showHistory)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors"
                title="历史记录"
              >
                <History className="w-4 h-4" />
              </button>
              <button
                onClick={() => router.push("/image")}
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
        onConfirm={() => {
          if (deleteTarget) handleDelete(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
        variant="danger"
      />
    </div>
  );
}
