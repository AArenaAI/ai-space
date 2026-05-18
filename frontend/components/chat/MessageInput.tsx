"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Brain, ChevronDown, Square, Search, Columns2, Paperclip, X, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatModel } from "@/hooks/useChat";
import { getGuestId } from "@/lib/guestId";

// DeepSeek 模型的思考档位（兼容旧值）
const DEEPSEEK_EFFORTS = ["high", "max"] as const;
// GPT 模型的思考档位
const GPT_EFFORTS = ["light", "standard", "extended", "heavy"] as const;
// Kimi/Moonshot 模型的思考档位（只有开/关，无等级）
const MOONSHOT_EFFORTS = [] as const;

export type ReasoningEffort = "light" | "standard" | "extended" | "heavy" | "high" | "max";

export interface ReasoningConfig {
  enabled: boolean;
  effort: ReasoningEffort;
}

interface MessageInputProps {
  onSend: (content: string, reasoning: ReasoningConfig, search: boolean, attachments?: AttachedFile[], file_ids?: string[]) => void;
  onStop: () => void;
  isLoading: boolean;
  compareMode: boolean;
  onToggleCompare: () => void;
  currentModel?: ChatModel;
}

export interface AttachedFile {
  filename: string;
  content: string;
  type: string;
  public_id?: string; // 后端返回的文件 PublicID
  parse_status?: string; // pending | done | error
}

export default function MessageInput({ onSend, onStop, isLoading, compareMode, onToggleCompare, currentModel }: MessageInputProps) {
  const [content, setContent] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reasoning, setReasoning] = useState<ReasoningConfig>(() => {
    // 从 localStorage 读取用户上次保存的深度思考配置
    if (typeof window !== "undefined") {
      const savedEnabled = localStorage.getItem("reasoning-enabled");
      const savedEffort = localStorage.getItem("reasoning-effort");
      return {
        enabled: savedEnabled === "true",
        effort: (savedEffort as ReasoningEffort) || "standard",
      };
    }
    return { enabled: false, effort: "standard" };
  });
  const [searchEnabled, setSearchEnabled] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("search-enabled") === "true";
    }
    return false;
  });
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showFileTip, setShowFileTip] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevModelRef = useRef<ChatModel | undefined>(currentModel);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 当打开下拉菜单时，确保当前 effort 对当前模型有效
  useEffect(() => {
    if (!dropdownOpen) return;
    if (!currentModel) return;
    const isDeepSeek = currentModel.provider === "DeepSeek";
    const isMoonshot = currentModel.provider === "Moonshot";
    // Moonshot/Kimi 无 effort 等级，不验证
    if (isMoonshot) {
      setDropdownOpen(false);
      return;
    }
    const validEfforts = isDeepSeek ? DEEPSEEK_EFFORTS : GPT_EFFORTS;
    if (!(validEfforts as readonly string[]).includes(reasoning.effort)) {
      const defaultEffort: ReasoningEffort = isDeepSeek ? "high" : "standard";
      setReasoning((prev) => ({ ...prev, effort: defaultEffort }));
      localStorage.setItem("reasoning-effort", defaultEffort);
    }
  }, [dropdownOpen, currentModel]);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [content]);

  // 点击外部关闭下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // 轮询更新文件解析状态
  useEffect(() => {
    const pendingFiles = attachedFiles.filter((f) => (f.parse_status === "pending" || f.parse_status === "parsing") && f.public_id);
    if (pendingFiles.length === 0) return;

    const token = localStorage.getItem("token");
    const pollHeaders: Record<string, string> = {};
    if (token) {
      pollHeaders["Authorization"] = `Bearer ${token}`;
    } else {
      pollHeaders["X-Guest-ID"] = getGuestId();
    }
    const interval = setInterval(async () => {
      const updates = await Promise.all(
        pendingFiles.map(async (f) => {
          try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/files/${f.public_id}`, {
              headers: pollHeaders,
            });
            if (!res.ok) return null;
            const data = await res.json();
            return { 
              public_id: f.public_id, 
              parse_status: data.parse_status,
              content: data.content ? data.content.slice(0, 8000) : undefined, // 取前8000字符避免过大
            };
          } catch {
            return null;
          }
        })
      );

      setAttachedFiles((prev) =>
        prev.map((f) => {
          const update = updates.find((u) => u && u.public_id === f.public_id);
          if (!update) return f;
          const next: AttachedFile = { ...f };
          if (update.parse_status !== f.parse_status) {
            next.parse_status = update.parse_status;
          }
          if (update.content && !f.content) {
            next.content = update.content;
          }
          return next;
        })
      );
    }, 3000);

    return () => clearInterval(interval);
  }, [attachedFiles]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!content.trim() && attachedFiles.length === 0) || isLoading || hasParsingFiles) {
      if (hasParsingFiles) {
        alert("文件解析中，请稍后");
      }
      return;
    }
    const file_ids = attachedFiles.map((a) => a.public_id).filter((id): id is string => id !== undefined);
    onSend(content.trim(), reasoning, searchEnabled, attachedFiles.length > 0 ? attachedFiles : undefined, file_ids.length > 0 ? file_ids : undefined);
    setContent("");
    setAttachedFiles([]);
    setDropdownOpen(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 如果正在使用输入法组合（IME composition），不处理快捷键
    // macOS Chrome 在 IME 回车确认时 e.key 仍为 "Enter"，必须检测 isComposing
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleStop = (e: React.MouseEvent) => {
    e.preventDefault();
    onStop();
  };

  const toggleReasoning = () => {
    setReasoning((prev) => {
      const next = { ...prev, enabled: !prev.enabled };
      localStorage.setItem("reasoning-enabled", String(next.enabled));
      return next;
    });
  };

  const toggleSearch = () => {
    setSearchEnabled((prev) => {
      const next = !prev;
      localStorage.setItem("search-enabled", String(next));
      return next;
    });
  };

  const uploadSingleFile = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const token = localStorage.getItem("token");
      const fetchHeaders: Record<string, string> = {};
      if (token) {
        fetchHeaders["Authorization"] = `Bearer ${token}`;
      } else {
        fetchHeaders["X-Guest-ID"] = getGuestId();
      }
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/files/upload`, {
        method: "POST",
        headers: fetchHeaders,
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "上传失败");
      }

      const data = await res.json();
      setAttachedFiles((prev) => [...prev, { filename: data.filename, content: data.content_preview || "", type: data.type, public_id: data.public_id, parse_status: data.parse_status || "pending" }]);
    } catch (err: any) {
      alert(`文件上传失败: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    await uploadSingleFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (dragCounter.current === 1) {
      setDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const maxSize = 20 * 1024 * 1024;
    const remainingSlots = 20 - attachedFiles.length;
    if (remainingSlots <= 0) {
      alert("单次聊天最多关联 20 个文件");
      return;
    }

    for (const file of files.slice(0, remainingSlots)) {
      if (file.size > maxSize) {
        alert(`文件 ${file.name} 超过 20MB 限制`);
        continue;
      }
      await uploadSingleFile(file);
    }
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const setEffort = (effort: ReasoningEffort) => {
    setReasoning({ enabled: true, effort });
    localStorage.setItem("reasoning-effort", effort);
    setDropdownOpen(false);
  };

  const hasParsingFiles = attachedFiles.some((f) => f.parse_status === "pending" || f.parse_status === "parsing");
  const hasContent = content.trim().length > 0;
  const canSubmit = (hasContent || attachedFiles.length > 0) && !hasParsingFiles;

  // 切换模型时自动重置思考档位到当前模型有效值
  useEffect(() => {
    if (!currentModel) return;
    if (prevModelRef.current === currentModel) return;
    const prevProvider = prevModelRef.current?.provider;
    const currProvider = currentModel.provider;
    prevModelRef.current = currentModel;
    if (prevProvider === currProvider) return; // 同厂商不重置

    // Moonshot/Kimi 无 effort 等级，重置为 standard（实际无意义）
    const isMoonshot = currProvider === "Moonshot";
    const isDeepSeek = currProvider === "DeepSeek";
    const isGPTLike = !isDeepSeek && !isMoonshot;
    if (isMoonshot) {
      // Moonshot 无 effort 等级，设默认值但不显示下拉
      const newEffort: ReasoningEffort = "standard";
      setReasoning((prev) => ({ ...prev, effort: newEffort }));
      localStorage.setItem("reasoning-effort", newEffort);
    } else if (isDeepSeek && (reasoning.effort === "light" || reasoning.effort === "extended" || reasoning.effort === "heavy")) {
      const newEffort: ReasoningEffort = "high";
      setReasoning((prev) => ({ ...prev, effort: newEffort }));
      localStorage.setItem("reasoning-effort", newEffort);
    } else if (isGPTLike && (reasoning.effort === "high" || reasoning.effort === "max")) {
      const newEffort: ReasoningEffort = "standard";
      setReasoning((prev) => ({ ...prev, effort: newEffort }));
      localStorage.setItem("reasoning-effort", newEffort);
    }
  }, [currentModel?.id]);

  const effortLabel = currentModel?.provider === "DeepSeek"
    ? (reasoning.effort === "max" ? "深度" : "")
    : (currentModel?.provider === "Moonshot" ? ""
      : (reasoning.effort === "standard" ? "" : reasoning.effort === "extended" ? "扩展" : reasoning.effort === "heavy" ? "重度" : "省流"));

  const effortNames: Record<string, string> = {
    light: "省流",
    standard: "标准",
    extended: "扩展",
    heavy: "重度",
  };

  return (
    <div className="shrink-0 px-4 pb-6 pt-2">
      <form onSubmit={handleSubmit} className="max-w-[800px] mx-auto">
        <div
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "relative flex flex-col rounded-2xl border transition-all duration-300",
            "bg-surface-card",
            dragOver
              ? "border-brand/60 border-dashed shadow-[0_0_0_1px_rgba(59,130,246,0.15),0_0_20px_rgba(59,130,246,0.1)]"
              : compareMode
                ? "border-amber-500/30 focus-within:border-amber-500/60 focus-within:shadow-[0_0_0_1px_rgba(251,191,36,0.15),0_0_20px_rgba(251,191,36,0.08)]"
                : "border-surface-border focus-within:border-brand/50 focus-within:shadow-[0_0_0_1px_rgba(59,130,246,0.1)]"
          )}
        >
          {/* 拖拽遮罩 */}
          {dragOver && (
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl bg-surface-card/95 border-2 border-dashed border-brand/40 pointer-events-none">
              <div className="flex flex-col items-center gap-2 text-text-secondary">
                <Paperclip className="w-8 h-8 text-brand/60" />
                <span className="text-sm font-medium">拖拽文件到此处上传</span>
              </div>
            </div>
          )}
          {/* 文件附件标签 */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pt-2">
              {attachedFiles.map((file, idx) => {
                const status = file.parse_status || "pending";
                const statusConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
                  pending: { color: "text-amber-400 border-amber-500/30 bg-amber-500/5", icon: <div className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />, label: "解析中" },
                  done: { color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5", icon: <FileText className="w-3.5 h-3.5" />, label: "已完成" },
                  error: { color: "text-red-400 border-red-500/30 bg-red-500/5", icon: <div className="w-3 h-3 rounded-full bg-red-400" />, label: "失败" },
                };
                const cfg = statusConfig[status] || statusConfig.pending;
                return (
                  <div
                    key={idx}
                    className={cn(
                      "flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 text-[12px] rounded-lg border transition-all",
                      cfg.color
                    )}
                    title={cfg.label}
                  >
                    {cfg.icon}
                    <span className="max-w-[120px] truncate">{file.filename}</span>
                    <span className="text-[10px] opacity-60 ml-0.5">{cfg.label}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachedFile(idx)}
                      className="flex items-center justify-center w-4 h-4 rounded hover:bg-black/10 transition-colors ml-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="问点什么..."
            rows={1}
            className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] outline-none placeholder:text-text-tertiary min-h-[48px] max-h-[200px] leading-relaxed"
          />

          <div className="flex items-center justify-between px-3 pb-3">
            {/* 左侧：文件上传 + 联网搜索 + 深度思考 */}
            <div className="flex items-center gap-2">
              {/* 文件上传按钮 */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || isLoading}
                  onMouseEnter={() => setShowFileTip(true)}
                  onMouseLeave={() => setShowFileTip(false)}
                  className={cn(
                    "relative flex items-center justify-center w-8 h-8 rounded-lg border transition-all duration-200",
                    attachedFiles.length > 0
                      ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400"
                      : "bg-transparent border-surface-border text-text-tertiary hover:text-text-secondary hover:border-text-tertiary/50",
                    (uploading || isLoading) && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {uploading ? (
                    <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Paperclip className="w-3.5 h-3.5" />
                  )}
                  {attachedFiles.length > 0 && !uploading && (
                    <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-emerald-500 text-white text-[10px] font-medium">
                      {attachedFiles.length}
                    </span>
                  )}
                </button>
                {/* 自定义 tooltip */}
                <div
                  className={cn(
                    "absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[220px] z-[60] pointer-events-none transition-opacity duration-200",
                    showFileTip ? "opacity-100" : "opacity-0"
                  )}
                >
                  <div className="rounded-lg border border-surface-border bg-surface-card px-3 py-2 shadow-lg text-[12px] leading-relaxed text-text-secondary">
                    <div className="font-medium text-text-primary mb-0.5">文件上传限制</div>
                    <div>支持: PDF, Word, PPT, Excel, 图片, 代码等</div>
                    <div>单文件 ≤ 20MB，单次最多 20 个</div>
                  </div>
                  {/* 小三角箭头 */}
                  <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 rotate-45 border-r border-b border-surface-border bg-surface-card" />
                </div>
              </div>

              {/* 联网搜索按钮 */}
              <button
                type="button"
                onClick={toggleSearch}
                className={cn(
                  "flex items-center gap-1.5 pl-3 pr-3 py-1.5 text-[13px] font-medium rounded-full border transition-all duration-200",
                  searchEnabled
                    ? "bg-blue-500/10 border-blue-500/40 text-blue-400"
                    : "bg-transparent border-surface-border text-text-tertiary hover:text-text-secondary hover:border-text-tertiary/50"
                )}
              >
                <Search className="w-3.5 h-3.5" />
                <span>联网搜索</span>
              </button>

              {/* 深度思考开关 + 下拉 */}
              <div className="relative flex items-center" ref={dropdownRef}>
                <div className={cn(
                  "flex items-center rounded-full border transition-all duration-200 overflow-hidden",
                  reasoning.enabled
                    ? "bg-purple-500/10 border-purple-500/40"
                    : "bg-transparent border-surface-border hover:border-text-tertiary/50"
                )}>
                  <button
                    type="button"
                    onClick={toggleReasoning}
                    className={cn(
                      "flex items-center gap-1.5 pl-3 pr-2 py-1.5 text-[13px] font-medium transition-all duration-200",
                      reasoning.enabled
                        ? "text-purple-400"
                        : "text-text-tertiary hover:text-text-secondary"
                    )}
                  >
                    <Brain className="w-3.5 h-3.5" />
                    <span>深度思考</span>
                    {reasoning.enabled && (
                      <span className="text-[11px] opacity-70 ml-0.5">· {effortLabel}</span>
                    )}
                  </button>
                  {currentModel?.provider !== "Moonshot" && (
                    <>
                      <div className={cn(
                        "w-px h-4 transition-colors duration-200",
                        reasoning.enabled ? "bg-purple-500/30" : "bg-surface-border"
                      )} />
                      <button
                        type="button"
                        onClick={() => setDropdownOpen(!dropdownOpen)}
                        className={cn(
                          "flex items-center justify-center px-2 py-1.5 text-[13px] transition-all duration-200",
                          reasoning.enabled
                            ? "text-purple-400"
                            : "text-text-tertiary hover:text-text-secondary"
                        )}
                      >
                        <ChevronDown
                          className={cn(
                            "w-3 h-3 transition-transform duration-200",
                            dropdownOpen && "rotate-180"
                          )}
                        />
                      </button>
                    </>
                  )}
                </div>

                {/* 下拉浮层 */}
                {dropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setDropdownOpen(false)}
                    />
                    <div className="absolute bottom-full left-0 mb-2 w-32 rounded-xl border border-surface-border bg-surface-elevated shadow-xl z-50 py-1 animate-fade-in">
                      {currentModel?.provider === "Moonshot" ? (
                        <div className="px-4 py-3 text-sm text-text-tertiary text-center">仅开关</div>
                      ) : currentModel?.provider === "DeepSeek" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setEffort("high")}
                            className={cn(
                              "flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors",
                              reasoning.effort === "high"
                                ? "text-purple-400 bg-purple-500/10"
                                : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                            )}
                          >
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                reasoning.effort === "high" ? "bg-purple-400" : "bg-text-tertiary/30"
                              )}
                            />
                            标准
                          </button>
                          <button
                            type="button"
                            onClick={() => setEffort("max")}
                            className={cn(
                              "flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors",
                              reasoning.effort === "max"
                                ? "text-purple-400 bg-purple-500/10"
                                : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                            )}
                          >
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                reasoning.effort === "max" ? "bg-purple-400" : "bg-text-tertiary/30"
                              )}
                            />
                            深度
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setEffort("light")}
                            className={cn(
                              "flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors",
                              reasoning.effort === "light"
                                ? "text-purple-400 bg-purple-500/10"
                                : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                            )}
                          >
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                reasoning.effort === "light" ? "bg-purple-400" : "bg-text-tertiary/30"
                              )}
                            />
                            {effortNames.light}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEffort("standard")}
                            className={cn(
                              "flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors",
                              reasoning.effort === "standard"
                                ? "text-purple-400 bg-purple-500/10"
                                : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                            )}
                          >
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                reasoning.effort === "standard" ? "bg-purple-400" : "bg-text-tertiary/30"
                              )}
                            />
                            {effortNames.standard}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEffort("extended")}
                            className={cn(
                              "flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors",
                              reasoning.effort === "extended"
                                ? "text-purple-400 bg-purple-500/10"
                                : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                            )}
                          >
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                reasoning.effort === "extended" ? "bg-purple-400" : "bg-text-tertiary/30"
                              )}
                            />
                            {effortNames.extended}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEffort("heavy")}
                            className={cn(
                              "flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors",
                              reasoning.effort === "heavy"
                                ? "text-purple-400 bg-purple-500/10"
                                : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                            )}
                          >
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                reasoning.effort === "heavy" ? "bg-purple-400" : "bg-text-tertiary/30"
                              )}
                            />
                            {effortNames.heavy}
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* 对比模式开关 */}
              <button
                type="button"
                onClick={onToggleCompare}
                className={cn(
                  "flex items-center gap-1.5 pl-3 pr-3 py-1.5 text-[13px] font-medium rounded-full border transition-all duration-200",
                  compareMode
                    ? "bg-amber-500/10 border-amber-500/40 text-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.15)]"
                    : "bg-transparent border-surface-border text-text-tertiary hover:text-text-secondary hover:border-text-tertiary/50"
                )}
              >
                <Columns2 className="w-3.5 h-3.5" />
                <span>对比</span>
              </button>
            </div>

            {/* 发送/停止按钮 */}
            {isLoading ? (
              <button
                type="button"
                onClick={handleStop}
                className="flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200 bg-red-500 text-white hover:bg-red-600"
                title="停止生成"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSubmit}
                title={hasParsingFiles ? "文件解析中，请稍后" : "发送"}
                className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200",
                  canSubmit
                    ? "bg-brand text-white hover:bg-brand-hover"
                    : "bg-surface-elevated text-text-tertiary cursor-not-allowed"
                )}
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* 底部提示 */}
        <p className={cn("text-center text-[11px] mt-2 transition-all duration-300", compareMode ? "text-amber-500/50" : "text-text-tertiary/60")}>
          AI 可能会出现错误，请勿分享敏感信息
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.json,.csv,.js,.ts,.go,.py,.java,.cpp,.c,.h,.hpp,.rs,.html,.css,.xml,.yaml,.yml,.log,.sql,.sh,.bash,.tsx,.jsx,.vue,.php,.rb,.swift,.kt,.scala,.r,.tex,.jpg,.jpeg,.png,.gif,.webp,.bmp,.pdf"
          onChange={handleFileSelect}
          className="hidden"
        />
      </form>
    </div>
  );
}
