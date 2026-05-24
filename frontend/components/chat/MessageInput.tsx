"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Brain, ChevronDown, Square, Search, Columns2, Paperclip, X, FileText, Wrench, SlidersHorizontal, MessageSquarePlus, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatModel } from "@/hooks/useChat";
import { Template } from "@/hooks/useTemplates";
import { getGuestId } from "@/lib/guestId";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

// DeepSeek 模型的思考档位（兼容旧值）
const DEEPSEEK_EFFORTS = ["high", "max"] as const;
// GPT 模型的思考档位
const GPT_EFFORTS = ["light", "standard", "extended", "heavy"] as const;
// Kimi/Moonshot 模型的思考档位（只有开/关，无等级）
const MOONSHOT_EFFORTS = [] as const;
const TEXTAREA_MIN_HEIGHT = 92;
const TEXTAREA_MAX_HEIGHT = 180;

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
  templates: Template[];
  selectedTemplateId: number;
  onSelectTemplate: (templateId: number) => void;
  onNewChat: () => void;
}

export interface AttachedFile {
  filename: string;
  content: string;
  type: string;
  public_id?: string; // 后端返回的文件 PublicID
  parse_status?: string; // pending | parsing | done | error | unsupported
  error_message?: string; // 解析失败原因
}

export default function MessageInput({ onSend, onStop, isLoading, compareMode, onToggleCompare, currentModel, templates, selectedTemplateId, onSelectTemplate, onNewChat }: MessageInputProps) {
  const { t } = useI18n();
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
  const [toolsOpen, setToolsOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [showFileTip, setShowFileTip] = useState(false);
  const [showCompareTip, setShowCompareTip] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevModelRef = useRef<ChatModel | undefined>(currentModel);
  const toolsRef = useRef<HTMLDivElement>(null);
  const toolsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const templateRef = useRef<HTMLDivElement>(null);
  const templateTimerRef = useRef<NodeJS.Timeout | null>(null);

  const selectedTemplate = templates.find((tpl) => tpl.id === selectedTemplateId);
  const isTemplateDisabled = selectedTemplateId === 0;

  const handleTemplateEnter = useCallback(() => {
    if (templateTimerRef.current) clearTimeout(templateTimerRef.current);
    templateTimerRef.current = setTimeout(() => setTemplateOpen(true), 120);
  }, []);

  const handleTemplateLeave = useCallback(() => {
    if (templateTimerRef.current) clearTimeout(templateTimerRef.current);
    templateTimerRef.current = setTimeout(() => setTemplateOpen(false), 200);
  }, []);

  const handleTemplateSelect = (templateId: number) => {
    onSelectTemplate(templateId);
    setTemplateOpen(false);
  };

  // 悬浮延迟打开工具下拉
  const handleToolsEnter = useCallback(() => {
    if (toolsTimerRef.current) clearTimeout(toolsTimerRef.current);
    toolsTimerRef.current = setTimeout(() => setToolsOpen(true), 120);
  }, []);

  const handleToolsLeave = useCallback(() => {
    if (toolsTimerRef.current) clearTimeout(toolsTimerRef.current);
    toolsTimerRef.current = setTimeout(() => setToolsOpen(false), 200);
  }, []);

  // 点击外部关闭工具下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) {
        setToolsOpen(false);
      }
      if (templateRef.current && !templateRef.current.contains(e.target as Node)) {
        setTemplateOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      if (toolsTimerRef.current) clearTimeout(toolsTimerRef.current);
      if (templateTimerRef.current) clearTimeout(templateTimerRef.current);
    };
  }, []);

  // 当打开下拉菜单时，确保当前 effort 对当前模型有效
  useEffect(() => {
    if (!toolsOpen) return;
    if (!currentModel) return;
    const isDeepSeek = currentModel.provider === "DeepSeek";
    const isMoonshot = currentModel.provider === "Moonshot";
    // Moonshot/Kimi 无 effort 等级，不验证
    if (isMoonshot) return;
    const validEfforts = isDeepSeek ? DEEPSEEK_EFFORTS : GPT_EFFORTS;
    if (!(validEfforts as readonly string[]).includes(reasoning.effort)) {
      const defaultEffort: ReasoningEffort = isDeepSeek ? "high" : "standard";
      setReasoning((prev) => ({ ...prev, effort: defaultEffort }));
      localStorage.setItem("reasoning-effort", defaultEffort);
    }
  }, [toolsOpen, currentModel]);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = `${TEXTAREA_MIN_HEIGHT}px`;
    const nextHeight = Math.min(Math.max(el.scrollHeight, TEXTAREA_MIN_HEIGHT), TEXTAREA_MAX_HEIGHT);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
  }, [content]);

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
              error_message: data.error_message || undefined,
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
          if (update.error_message && !f.error_message) {
            next.error_message = update.error_message;
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
        toast.warning(t("chat.fileParsingWait"));
      }
      return;
    }
    const file_ids = attachedFiles.map((a) => a.public_id).filter((id): id is string => id !== undefined);
    onSend(content.trim(), reasoning, searchEnabled, attachedFiles.length > 0 ? attachedFiles : undefined, file_ids.length > 0 ? file_ids : undefined);
    setContent("");
    setAttachedFiles([]);
    setToolsOpen(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = `${TEXTAREA_MIN_HEIGHT}px`;
      textareaRef.current.style.overflowY = "hidden";
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
        throw new Error(err.error || t("chat.uploadFailed"));
      }

      const data = await res.json();
      setAttachedFiles((prev) => [...prev, { filename: data.filename, content: data.content_preview || "", type: data.type, public_id: data.public_id, parse_status: data.parse_status || "pending" }]);
    } catch (err: any) {
      toast.error(`${t("chat.fileUploadFailedPrefix")}: ${err.message}`);
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
      toast.warning(t("chat.maxFilesWarning"));
      return;
    }

    for (const file of files.slice(0, remainingSlots)) {
      if (file.size > maxSize) {
        toast.warning(t("chat.fileTooLarge").replace("{name}", file.name));
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
    setToolsOpen(false);
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
    ? (reasoning.effort === "max" ? t("chat.reasoning.deep") : "")
    : (currentModel?.provider === "Moonshot" ? ""
      : (reasoning.effort === "standard" ? "" : reasoning.effort === "extended" ? t("chat.reasoning.extended") : reasoning.effort === "heavy" ? t("chat.reasoning.heavy") : t("chat.reasoning.light")));

  const effortNames: Record<string, string> = {
    light: t("chat.reasoning.light"),
    standard: t("chat.reasoning.standard"),
    extended: t("chat.reasoning.extended"),
    heavy: t("chat.reasoning.heavy"),
  };

  return (
    <div className="shrink-0 px-4 pb-6 pt-6">
      <form onSubmit={handleSubmit} className="max-w-[800px] mx-auto">
        { /* 上方面板：对比 + 附件按钮 */ }
        <div className="flex items-center gap-2 mb-2">
          {/* 对比模式开关 */}
          <div className="relative">
            <button
              type="button"
              onClick={onToggleCompare}
              onMouseEnter={() => setShowCompareTip(true)}
              onMouseLeave={() => setShowCompareTip(false)}
              aria-label={t("chat.compare")}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-lg transition-colors duration-200",
                compareMode
                  ? "bg-amber-500/10 text-amber-400"
                  : "text-text-tertiary hover:bg-surface-card hover:text-text-secondary"
              )}
            >
              <Columns2 className="w-3.5 h-3.5" />
            </button>
            <div
              className={cn(
                "absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[180px] z-[90] pointer-events-none transition-opacity duration-200",
                showCompareTip ? "opacity-100" : "opacity-0"
              )}
            >
              <div className="rounded-lg border border-surface-border bg-surface-card px-3 py-2 shadow-lg text-[12px] leading-relaxed text-text-secondary">
                <div className="font-medium text-text-primary">{t("chat.compare")}</div>
              </div>
              <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 rotate-45 border-r border-b border-surface-border bg-surface-card" />
            </div>
          </div>

          {/* 文件上传按钮 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || isLoading}
              onMouseEnter={() => setShowFileTip(true)}
              onMouseLeave={() => setShowFileTip(false)}
              aria-label={t("chat.attachments")}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-lg transition-colors duration-200",
                attachedFiles.length > 0
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "text-text-tertiary hover:bg-surface-card hover:text-text-secondary",
                (uploading || isLoading) && "opacity-50 cursor-not-allowed"
              )}
            >
              {uploading ? (
                <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <Paperclip className="w-3.5 h-3.5" />
              )}
            </button>
            {/* 自定义 tooltip */}
            <div
              className={cn(
                "absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[220px] z-[90] pointer-events-none transition-opacity duration-200",
                showFileTip ? "opacity-100" : "opacity-0"
              )}
            >
              <div className="rounded-lg border border-surface-border bg-surface-card px-3 py-2 shadow-lg text-[12px] leading-relaxed text-text-secondary">
                <div className="font-medium text-text-primary mb-0.5">{t("chat.fileUploadLimitTitle")}</div>
                <div>{t("chat.fileUploadSupport")}</div>
                <div>{t("chat.fileUploadLimitDesc")}</div>
              </div>
              {/* 小三角箭头 */}
              <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 rotate-45 border-r border-b border-surface-border bg-surface-card" />
            </div>
          </div>
        </div>

        <div
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "relative flex min-h-[134px] flex-col overflow-visible rounded-2xl border transition-all duration-300",
            "bg-surface-card",
            dragOver
              ? "border-brand/60 border-dashed shadow-[0_0_0_1px_rgba(59,130,246,0.15),0_0_20px_rgba(59,130,246,0.1)]"
              : compareMode
                ? "border-amber-500/30 focus-within:border-amber-500/60 focus-within:shadow-[0_0_0_1px_rgba(251,191,36,0.15),0_0_20px_rgba(251,191,36,0.08)]"
                : "border-surface-border focus-within:border-brand/50 focus-within:shadow-[0_0_0_1px_rgba(59,130,246,0.1)]"
          )}
        >
          <div className="absolute right-3 top-2 z-20 flex items-center gap-2">
            <div className="relative" ref={templateRef} onMouseEnter={handleTemplateEnter} onMouseLeave={handleTemplateLeave}>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-xl text-text-secondary transition-colors duration-200 hover:bg-surface-card hover:text-text-primary"
                title={selectedTemplate ? `回答模板：${selectedTemplate.name}` : isTemplateDisabled ? "不使用模板" : "选择回答模板"}
                aria-label={selectedTemplate ? `回答模板：${selectedTemplate.name}` : isTemplateDisabled ? "不使用模板" : "选择回答模板"}
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>

              {templateOpen && (
                <div className="absolute bottom-full right-0 mb-2 w-56 overflow-hidden rounded-xl border border-surface-border bg-surface-elevated py-1 shadow-xl z-[90] animate-fade-in">
                  <div className="px-3 py-2 text-xs font-medium text-text-tertiary">选择回答模板</div>
                  <div className="px-1 pb-1">
                    <button
                      type="button"
                      onClick={() => handleTemplateSelect(0)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                        isTemplateDisabled
                          ? "bg-brand-muted text-brand"
                          : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                      )}
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                        {isTemplateDisabled && <Check className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">不使用模板</span>
                    </button>
                  </div>
                  {templates.length === 0 ? (
                    <div className="px-3 pb-3 pt-1 text-sm text-text-tertiary">暂无回答模板</div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto px-1 pb-1 border-t border-surface-border/60 pt-1">
                      {templates.map((tpl) => (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => handleTemplateSelect(tpl.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                            selectedTemplateId === tpl.id
                              ? "bg-brand-muted text-brand"
                              : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                          )}
                        >
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                            {selectedTemplateId === tpl.id && <Check className="h-3.5 w-3.5" />}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{tpl.name}</span>
                          {tpl.is_default && <span className="shrink-0 rounded-full bg-surface-card px-1.5 py-0.5 text-[10px] text-text-tertiary">默认</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onNewChat}
              className="flex h-8 w-8 items-center justify-center rounded-xl text-brand transition-colors duration-200 hover:bg-surface-card hover:text-brand-hover"
              title={t("common.newChat")}
              aria-label={t("common.newChat")}
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>
          </div>

          {/* 拖拽遮罩 */}
          {dragOver && (
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl bg-surface-card/95 border-2 border-dashed border-brand/40 pointer-events-none">
              <div className="flex flex-col items-center gap-2 text-text-secondary">
                <Paperclip className="w-8 h-8 text-brand/60" />
                <span className="text-sm font-medium">{t("chat.dropFilesHere")}</span>
              </div>
            </div>
          )}
          {/* 文件附件标签 */}
          {attachedFiles.length > 0 && (
            <div className="absolute left-3 right-3 top-2 z-10 flex max-h-8 flex-wrap gap-2 overflow-hidden">
              {attachedFiles.map((file, idx) => {
                const status = file.parse_status || "pending";
                const statusConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
                  pending: { color: "text-amber-400 border-amber-500/30 bg-amber-500/5", icon: <div className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />, label: t("chat.fileStatusParsing") },
                  done: { color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5", icon: <FileText className="w-3.5 h-3.5" />, label: t("chat.fileStatusDone") },
                  error: { color: "text-red-400 border-red-500/30 bg-red-500/5", icon: <div className="w-3 h-3 rounded-full bg-red-400" />, label: t("chat.fileStatusFailed") },
                  unsupported: { color: "text-gray-400 border-gray-500/30 bg-gray-500/5", icon: <FileText className="w-3.5 h-3.5" />, label: t("chat.fileStatusUnsupported") },
                };
                const cfg = statusConfig[status] || statusConfig.pending;
                const isEmptyContent = status === "done" && !file.content?.trim();
                return (
                  <div
                    key={idx}
                    className={cn(
                      "flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 text-[12px] rounded-lg border transition-all",
                      cfg.color
                    )}
                    title={
                      file.error_message
                        ? `${t("chat.fileParseFailed")}: ${file.error_message}`
                        : isEmptyContent
                        ? t("chat.fileEmptyContent")
                        : cfg.label
                    }
                  >
                    {cfg.icon}
                    <span className="max-w-[120px] truncate">{file.filename}</span>
                    <span className="text-[10px] opacity-60 ml-0.5">
                      {file.error_message ? t("chat.fileParseFailed") : isEmptyContent ? t("chat.emptyFile") : cfg.label}
                    </span>
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
            placeholder={t("chat.placeholder")}
            rows={1}
            className="w-full min-h-[92px] shrink-0 resize-none overflow-hidden bg-transparent px-4 pt-12 pb-1 text-[15px] outline-none placeholder:text-text-tertiary leading-relaxed"
          />

          <div className="flex items-center justify-between px-3 pb-3">
            {/* 左侧：联网搜索 + 深度思考 → 合并为工具悬浮选择 */}
            <div className="flex items-center gap-2">
              {/* 工具悬浮按钮：联网搜索 + 深度思考 */}
              <div className="relative" ref={toolsRef} onMouseEnter={handleToolsEnter} onMouseLeave={handleToolsLeave}>
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-1.5 pl-3 pr-3 py-1.5 text-[13px] font-medium rounded-full border transition-all duration-200",
                    reasoning.enabled || searchEnabled
                      ? "border-brand/40 bg-brand-muted text-brand"
                      : "border-surface-border bg-transparent text-text-tertiary hover:text-text-secondary hover:border-text-tertiary/50"
                  )}
                >
                  <Wrench className="w-3.5 h-3.5" />
                  <span>{t("chat.tools")}</span>
                  {(reasoning.enabled || searchEnabled) && (
                    <span className="text-[11px] opacity-70 ml-0.5">
                      · {[reasoning.enabled && t("chat.deepThinking"), searchEnabled && t("chat.webSearch")].filter(Boolean).join("+")}
                    </span>
                  )}
                </button>

                {/* 工具悬浮下拉浮层 */}
                {toolsOpen && (
                  <div className="absolute bottom-full left-0 mb-2 w-48 rounded-xl border border-surface-border bg-surface-elevated shadow-xl z-[90] py-1 animate-fade-in">
                    {/* 联网搜索选项 */}
                    <div className="px-1">
                      <button
                        type="button"
                        onClick={toggleSearch}
                        className={cn(
                          "flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg transition-colors",
                          searchEnabled
                            ? "text-blue-400 bg-blue-500/10"
                            : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                        )}
                      >
                        <span className={cn(
                          "w-4 h-4 rounded border-2 flex items-center justify-center transition-colors",
                          searchEnabled
                            ? "bg-blue-500 border-blue-500"
                            : "border-text-tertiary/40"
                        )}>
                          {searchEnabled && <span className="text-white text-[10px] font-bold">✓</span>}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Search className="w-3.5 h-3.5" />
                            <span>{t("chat.webSearch")}</span>
                          </div>
                        </div>
                      </button>
                    </div>
                    {/* 分割线 */}
                    <div className="mx-2 my-1 border-t border-surface-border/50" />
                    {/* 深度思考选项 */}
                    <div className="px-1 pb-1">
                      <button
                        type="button"
                        onClick={toggleReasoning}
                        className={cn(
                          "flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg transition-colors",
                          reasoning.enabled
                            ? "text-purple-400 bg-purple-500/10"
                            : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                        )}
                      >
                        <span className={cn(
                          "w-4 h-4 rounded border-2 flex items-center justify-center transition-colors",
                          reasoning.enabled
                            ? "bg-purple-500 border-purple-500"
                            : "border-text-tertiary/40"
                        )}>
                          {reasoning.enabled && <span className="text-white text-[10px] font-bold">✓</span>}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Brain className="w-3.5 h-3.5" />
                            <span>{t("chat.deepThinking")}</span>
                          </div>
                        </div>
                      </button>
                      {/* 思考档位（仅开启时显示） */}
                      {reasoning.enabled && currentModel?.provider !== "Moonshot" && (
                        <div className="ml-8 mt-1 pl-2 border-l border-surface-border/50 space-y-0.5">
                          {currentModel?.provider === "DeepSeek" ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setEffort("high")}
                                className={cn(
                                  "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded-md transition-colors",
                                  reasoning.effort === "high"
                                    ? "text-purple-400 bg-purple-500/10"
                                    : "text-text-tertiary hover:bg-surface-card hover:text-text-primary"
                                )}
                              >
                                <span className={cn("w-1 h-1 rounded-full", reasoning.effort === "high" ? "bg-purple-400" : "bg-text-tertiary/30")} />
                                {t("chat.reasoning.standard")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEffort("max")}
                                className={cn(
                                  "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded-md transition-colors",
                                  reasoning.effort === "max"
                                    ? "text-purple-400 bg-purple-500/10"
                                    : "text-text-tertiary hover:bg-surface-card hover:text-text-primary"
                                )}
                              >
                                <span className={cn("w-1 h-1 rounded-full", reasoning.effort === "max" ? "bg-purple-400" : "bg-text-tertiary/30")} />
                                {t("chat.reasoning.deep")}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => setEffort("light")}
                                className={cn(
                                  "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded-md transition-colors",
                                  reasoning.effort === "light"
                                    ? "text-purple-400 bg-purple-500/10"
                                    : "text-text-tertiary hover:bg-surface-card hover:text-text-primary"
                                )}
                              >
                                <span className={cn("w-1 h-1 rounded-full", reasoning.effort === "light" ? "bg-purple-400" : "bg-text-tertiary/30")} />
                                {effortNames.light}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEffort("standard")}
                                className={cn(
                                  "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded-md transition-colors",
                                  reasoning.effort === "standard"
                                    ? "text-purple-400 bg-purple-500/10"
                                    : "text-text-tertiary hover:bg-surface-card hover:text-text-primary"
                                )}
                              >
                                <span className={cn("w-1 h-1 rounded-full", reasoning.effort === "standard" ? "bg-purple-400" : "bg-text-tertiary/30")} />
                                {effortNames.standard}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEffort("extended")}
                                className={cn(
                                  "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded-md transition-colors",
                                  reasoning.effort === "extended"
                                    ? "text-purple-400 bg-purple-500/10"
                                    : "text-text-tertiary hover:bg-surface-card hover:text-text-primary"
                                )}
                              >
                                <span className={cn("w-1 h-1 rounded-full", reasoning.effort === "extended" ? "bg-purple-400" : "bg-text-tertiary/30")} />
                                {effortNames.extended}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEffort("heavy")}
                                className={cn(
                                  "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded-md transition-colors",
                                  reasoning.effort === "heavy"
                                    ? "text-purple-400 bg-purple-500/10"
                                    : "text-text-tertiary hover:bg-surface-card hover:text-text-primary"
                                )}
                              >
                                <span className={cn("w-1 h-1 rounded-full", reasoning.effort === "heavy" ? "bg-purple-400" : "bg-text-tertiary/30")} />
                                {effortNames.heavy}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 发送/停止按钮 */}
            {isLoading ? (
              <button
                type="button"
                onClick={handleStop}
                className="flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200 bg-red-500 text-white hover:bg-red-600"
                title={t("chat.stopGenerating")}
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSubmit}
                title={hasParsingFiles ? t("chat.fileParsingWaitShort") : t("chat.send")}
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
        {/* 已删除：AI 可能会出现错误，请勿分享敏感信息 */}
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
