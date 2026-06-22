"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Brain, Square, Search, Paperclip, X, FileText, Wrench, SlidersHorizontal, MessageSquarePlus, Check, Zap, Crown, ChevronDown, Quote, Columns3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatModel } from "@/lib/chatTypes";
import { Template } from "@/hooks/useTemplates";
import { getGuestId } from "@/lib/guestId";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { getErrorMessage, readApiError, showUserError } from "@/lib/errors";
import type { ModelRecommendationContext } from "@/lib/models/modelRecommendations";
import { getClipboardFilesWithHtmlImages } from "@/lib/clipboardFiles";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import NetworkStatusHint from "./NetworkStatusHint";

const TEXTAREA_MIN_HEIGHT = 92;
const TEXTAREA_MAX_HEIGHT = 180;

const SUPPORTED_FILE_EXTENSIONS = new Set([
  ".pdf",
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".mp4", ".mov",
  ".xla", ".xlb", ".xlc", ".xlm", ".xls", ".xlsx", ".xlt", ".xlw", ".csv", ".tsv", ".iif",
  ".doc", ".docx", ".dot", ".odt", ".rtf",
  ".pot", ".ppa", ".pps", ".ppt", ".pptx", ".pwz", ".wiz",
  ".asm", ".bat", ".c", ".cc", ".conf", ".cpp", ".css", ".cxx", ".def", ".dic", ".eml", ".h", ".hh",
  ".htm", ".html", ".ics", ".ifb", ".in", ".js", ".json", ".ksh", ".list", ".log", ".markdown", ".md",
  ".mht", ".mhtml", ".mime", ".mjs", ".nws", ".pl", ".py", ".rst", ".s", ".sql", ".srt", ".text",
  ".txt", ".vcf", ".vtt", ".xml", ".ts", ".tsx", ".jsx", ".go", ".rs", ".java", ".php", ".rb",
  ".swift", ".kt", ".scala", ".r", ".tex", ".yaml", ".yml", ".toml", ".sh", ".bash",
]);
const SUPPORTED_FILE_ACCEPT = Array.from(SUPPORTED_FILE_EXTENSIONS).sort().join(",");
const IMAGE_UPLOAD_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);

function getFileExtension(filename: string) {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx).toLowerCase() : "";
}

function getUploadFileExtension(file: File) {
  const ext = getFileExtension(file.name);
  if (ext) return ext;
  if (file.type === "image/jpeg") return ".jpg";
  if (file.type === "image/png") return ".png";
  if (file.type === "image/webp") return ".webp";
  if (file.type === "image/gif") return ".gif";
  if (file.type === "image/bmp") return ".bmp";
  if (file.type === "video/mp4") return ".mp4";
  if (file.type === "video/quicktime") return ".mov";
  return "";
}

function isSupportedUploadFile(file: File) {
  return SUPPORTED_FILE_EXTENSIONS.has(getUploadFileExtension(file));
}

function normalizeExtension(ext: string) {
  const value = ext.trim().toLowerCase();
  if (!value) return "";
  return value.startsWith(".") ? value : `.${value}`;
}

function modelSupportsUploadFile(file: File, model?: ChatModel) {
  if (!model) return true;
  const ext = normalizeExtension(getUploadFileExtension(file));
  const mime = file.type.trim().toLowerCase();
  const supportedInputs = (model.supported_inputs || []).map((input) => input.trim().toLowerCase()).filter(Boolean);
  const supportedExtensions = (model.supported_file_extensions || []).map(normalizeExtension).filter(Boolean);
  const supportedMimeTypes = (model.supported_file_mime_types || []).map((type) => type.trim().toLowerCase()).filter(Boolean);

  if (ext && supportedExtensions.length > 0 && supportedExtensions.includes(ext)) {
    return true;
  }
  if (mime && supportedMimeTypes.length > 0 && supportedMimeTypes.includes(mime)) {
    return true;
  }

  // If metadata explicitly says the model only supports text, it must not accept any attachment.
  if (supportedInputs.length > 0) {
    return false;
  }

  // Older cached model metadata may not include file lists or input lists. In that legacy case, only enforce the app-level allowlist.
  return supportedExtensions.length === 0 && supportedMimeTypes.length === 0;
}

function getModelDisplayName(model?: ChatModel) {
  return model?.name || model?.provider || model?.id || "Current model";
}

function isImageAttachment(file: AttachedFile) {
  return file.type === "image" || file.type.startsWith("image/") || IMAGE_UPLOAD_EXTENSIONS.has(getFileExtension(file.filename));
}

function getFilePreviewUrl(file: AttachedFile) {
  if (!file.public_id) return "";
  return `${process.env.NEXT_PUBLIC_API_URL || ""}/api/files/${file.public_id}/view`;
}

export type ReasoningEffort = "light" | "standard" | "extended" | "heavy" | "high" | "max";
export type ReasoningMode = "fast" | "think" | "expert";

export interface ReasoningConfig {
  enabled: boolean;
  effort: ReasoningEffort;
}

export type QuoteDraft = {
  id: number;
  text: string;
};

interface MessageInputProps {
  onSend: (content: string, reasoning: ReasoningConfig, search: boolean, attachments?: AttachedFile[], file_ids?: string[]) => void;
  onStop: () => void;
  isLoading: boolean;
  compareMode: boolean;
  onToggleCompare: () => void;
  currentModel?: ChatModel;
  compareModels?: ChatModel[];
  templates: Template[];
  selectedTemplateId: number;
  onSelectTemplate: (templateId: number) => void;
  onNewChat: () => void;
  onRecommendationContextChange?: (context: ModelRecommendationContext) => void;
  quoteDraft?: QuoteDraft | null;
  initialAttachedFiles?: AttachedFile[];
}

export interface AttachedFile {
  filename: string;
  content: string;
  type: string;
  public_id?: string; // 后端返回的文件 PublicID
  parse_status?: string; // pending | parsing | done | error | unsupported
  error_message?: string; // 解析失败原因
}

function getReasoningEffortForMode(model: ChatModel | undefined, mode: ReasoningMode): ReasoningConfig {
  if (mode === "fast") {
    return { enabled: false, effort: "standard" };
  }

  const provider = model?.provider;
  const modelId = model?.id || "";

  if (mode === "think") {
    if (provider === "DeepSeek") return { enabled: true, effort: "high" };
    return { enabled: true, effort: "standard" };
  }

  if (provider === "DeepSeek") return { enabled: true, effort: "max" };
  if (modelId === "gpt-5.5-pro" || modelId.startsWith("gpt-5.5-pro-")) {
    return { enabled: true, effort: "extended" };
  }
  if (provider === "Moonshot") return { enabled: true, effort: "standard" };
  return { enabled: true, effort: "heavy" };
}

function normalizeReasoningMode(value: string | null): ReasoningMode {
  return value === "think" || value === "expert" || value === "fast" ? value : "fast";
}

export default function MessageInput({ onSend, onStop, isLoading, compareMode, onToggleCompare, currentModel, compareModels = [], templates, selectedTemplateId, onSelectTemplate, onNewChat, onRecommendationContextChange, quoteDraft, initialAttachedFiles }: MessageInputProps) {
  const { t } = useI18n();
  const { isOffline, justRestored } = useNetworkStatus();
  const [content, setContent] = useState("");
  const [activeQuote, setActiveQuote] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>(() => initialAttachedFiles || []);
  const [uploading, setUploading] = useState(false);
  const [reasoningMode, setReasoningMode] = useState<ReasoningMode>(() => {
    if (typeof window !== "undefined") {
      const savedMode = localStorage.getItem("reasoning-mode");
      if (savedMode) return normalizeReasoningMode(savedMode);
      return localStorage.getItem("reasoning-enabled") === "true" ? "think" : "fast";
    }
    return "fast";
  });
  const reasoning = getReasoningEffortForMode(currentModel, reasoningMode);
  const [searchEnabled, setSearchEnabled] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("search-enabled") === "true";
    }
    return false;
  });
  const effectiveSearchEnabled = searchEnabled;
  const [toolsOpen, setToolsOpen] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [showFileTip, setShowFileTip] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const toolsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reasoningRef = useRef<HTMLDivElement>(null);
  const reasoningTimerRef = useRef<NodeJS.Timeout | null>(null);
  const templateRef = useRef<HTMLDivElement>(null);
  const templateTimerRef = useRef<NodeJS.Timeout | null>(null);

  const selectedTemplate = templates.find((tpl) => tpl.id === selectedTemplateId);
  const isTemplateDisabled = selectedTemplateId === 0;

  useEffect(() => {
    onRecommendationContextChange?.({
      searchEnabled: effectiveSearchEnabled,
      hasImageAttachment: attachedFiles.some((file) => isImageAttachment(file)),
      hasDocumentAttachment: attachedFiles.some((file) => !isImageAttachment(file)),
      inputText: content,
    });
  }, [attachedFiles, content, effectiveSearchEnabled, onRecommendationContextChange]);

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

  const handleReasoningEnter = useCallback(() => {
    if (reasoningTimerRef.current) clearTimeout(reasoningTimerRef.current);
    reasoningTimerRef.current = setTimeout(() => setReasoningOpen(true), 120);
  }, []);

  const handleReasoningLeave = useCallback(() => {
    if (reasoningTimerRef.current) clearTimeout(reasoningTimerRef.current);
    reasoningTimerRef.current = setTimeout(() => setReasoningOpen(false), 200);
  }, []);

  // 点击外部关闭下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) {
        setToolsOpen(false);
      }
      if (reasoningRef.current && !reasoningRef.current.contains(e.target as Node)) {
        setReasoningOpen(false);
      }
      if (templateRef.current && !templateRef.current.contains(e.target as Node)) {
        setTemplateOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      if (toolsTimerRef.current) clearTimeout(toolsTimerRef.current);
      if (reasoningTimerRef.current) clearTimeout(reasoningTimerRef.current);
      if (templateTimerRef.current) clearTimeout(templateTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = `${TEXTAREA_MIN_HEIGHT}px`;
    const nextHeight = Math.min(Math.max(el.scrollHeight, TEXTAREA_MIN_HEIGHT), TEXTAREA_MAX_HEIGHT);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
  }, [content]);

  useEffect(() => {
    if (!quoteDraft?.text) return;
    const quote = quoteDraft.text.trim();
    if (!quote) return;

    setActiveQuote(quote);

    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [quoteDraft?.id, quoteDraft?.text]);

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
    const trimmedContent = content.trim();
    const trimmedQuote = activeQuote.trim();
    if ((!trimmedContent && !trimmedQuote && attachedFiles.length === 0) || isLoading || hasParsingFiles || hasBlockingAttachmentFiles || isOffline) {
      if (hasParsingFiles) {
        toast.warning(t("chat.fileParsingWait"));
      } else if (hasBlockingAttachmentFiles) {
        toast.warning(t("chat.fileAttachmentFixErrors"));
      } else if (isOffline) {
        toast.warning(t("messageInput.network.offlineToast"));
      }
      return;
    }
    const file_ids = attachedFiles.map((a) => a.public_id).filter((id): id is string => id !== undefined);
    const messageContent = trimmedQuote ? `${trimmedQuote}\n\n${trimmedContent}`.trim() : trimmedContent;
    onSend(messageContent, reasoning, effectiveSearchEnabled, attachedFiles.length > 0 ? attachedFiles : undefined, file_ids.length > 0 ? file_ids : undefined);
    setContent("");
    setActiveQuote("");
    setAttachedFiles([]);
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

  const selectReasoningMode = (mode: ReasoningMode) => {
    setReasoningMode(mode);
    setReasoningOpen(false);
    const next = getReasoningEffortForMode(currentModel, mode);
    localStorage.setItem("reasoning-mode", mode);
    localStorage.setItem("reasoning-enabled", String(next.enabled));
    localStorage.setItem("reasoning-effort", next.effort);
  };

  const toggleSearch = () => {
    setSearchEnabled((prev) => {
      const next = !prev;
      localStorage.setItem("search-enabled", String(next));
      return next;
    });
  };

  const uploadSingleFile = async (file: File) => {
    if (file.size <= 0) {
      toast.warning(t("chat.emptyFile"));
      return;
    }

    if (!isSupportedUploadFile(file)) {
      const ext = getFileExtension(file.name);
      toast.warning(ext ? t("messageInput.search.fileFormat").replace("{ext}", ext) : t("messageInput.unsupportedFile"));
      return;
    }

    const modelsToValidate = compareMode && compareModels.length > 0 ? compareModels : [currentModel];
    const unsupportedModels = modelsToValidate.filter((model) => !modelSupportsUploadFile(file, model));
    if (unsupportedModels.length > 0) {
      const ext = getUploadFileExtension(file).toUpperCase().replace(/^\./, "") || file.type || file.name;
      toast.error(
        t("chat.fileUploadUnsupportedModel")
          .replace("{model}", unsupportedModels.map(getModelDisplayName).join(", "))
          .replace("{type}", ext)
      );
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const token = localStorage.getItem("token");
      const fetchHeaders: Record<string, string> = {};
      if (token && token !== "null" && token !== "undefined") {
        fetchHeaders["Authorization"] = `Bearer ${token}`;
      }
      const guestId = getGuestId();
      if (guestId) fetchHeaders["X-Guest-ID"] = guestId;
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/files/upload`, {
        method: "POST",
        headers: fetchHeaders,
        body: formData,
      });

      if (!res.ok) {
        throw await readApiError(res);
      }

      const data = await res.json();
      setAttachedFiles((prev) => [...prev, { filename: data.filename, content: data.content_preview || "", type: data.type, public_id: data.public_id, parse_status: data.parse_status || "pending" }]);
    } catch (err) {
      showUserError(err, {
        module: "file",
        fallbackTitle: t("chat.uploadFailed"),
        fallbackMessage: t("chat.fileUploadFailedRetry"),
      });
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const maxSize = 20 * 1024 * 1024;
    const remainingSlots = 20 - attachedFiles.length;
    const toUpload = Array.from(files).slice(0, remainingSlots);
    e.target.value = "";
    for (const file of toUpload) {
      if (file.size > maxSize) {
        toast.warning(t("chat.fileTooLarge").replace("{name}", file.name));
        continue;
      }
      await uploadSingleFile(file);
    }
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

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const hasFileItems = Array.from(e.clipboardData?.items || []).some((item) => item.kind === "file");
    const hasHtmlImage = /<img\b/i.test(e.clipboardData?.getData("text/html") || "");
    if (!hasFileItems && !hasHtmlImage && (e.clipboardData?.files?.length || 0) === 0) return;

    e.preventDefault();
    const files = await getClipboardFilesWithHtmlImages(e);
    if (files.length === 0) {
      toast.warning(t("messageInput.unsupportedFile"));
      return;
    }

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

  const hasParsingFiles = attachedFiles.some((f) => f.parse_status === "pending" || f.parse_status === "parsing");
  const hasBlockingAttachmentFiles = attachedFiles.some((f) => f.parse_status === "error" || f.parse_status === "unsupported" || (f.parse_status === "done" && !f.content?.trim() && !isImageAttachment(f)));
  const hasContent = content.trim().length > 0;
  const activeQuotePreview = activeQuote.replace(/^>\s?/gm, "").trim();
  const canSubmit = (hasContent || activeQuote.length > 0 || attachedFiles.length > 0) && !hasParsingFiles && !hasBlockingAttachmentFiles && !isOffline;

  useEffect(() => {
    const next = getReasoningEffortForMode(currentModel, reasoningMode);
    localStorage.setItem("reasoning-enabled", String(next.enabled));
    localStorage.setItem("reasoning-effort", next.effort);
  }, [currentModel?.id, reasoningMode]);

  const reasoningModes: { key: ReasoningMode; label: string; title: string; icon: React.ReactNode }[] = [
    { key: "fast", label: t("messageInput.thinking.fast"), title: t("messageInput.thinking.fastDesc"), icon: <Zap className="h-3.5 w-3.5" /> },
    { key: "think", label: t("messageInput.thinking.think"), title: t("messageInput.thinking.thinkDesc"), icon: <Brain className="h-3.5 w-3.5" /> },
    { key: "expert", label: t("messageInput.thinking.expert"), title: t("messageInput.thinking.expertDesc"), icon: <Crown className="h-3.5 w-3.5" /> },
  ];
  const currentReasoningMode = reasoningModes.find((mode) => mode.key === reasoningMode) || reasoningModes[0];

  return (
    <div className="shrink-0 px-4 pb-6 pt-6">
      <form onSubmit={handleSubmit} className="max-w-[800px] mx-auto">
        <NetworkStatusHint
          isOffline={isOffline}
          justRestored={justRestored}
          offlineLabel={t("messageInput.network.offline")}
          restoredLabel={t("messageInput.network.restored")}
        />
        { /* 上方面板：左侧对比/附件 + 右侧模板/新建 */ }
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
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

            <button
              type="button"
              onClick={onToggleCompare}
              disabled={isLoading}
              aria-pressed={compareMode}
              aria-label={t("chat.compareMode")}
              title={t("chat.compareMode")}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-lg transition-colors duration-200",
                compareMode
                  ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/15"
                  : "text-text-tertiary hover:bg-surface-card hover:text-text-secondary",
                isLoading && "opacity-50 cursor-not-allowed"
              )}
            >
              <Columns3 className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* 回答模板 */}
            <div className="relative" ref={templateRef} onMouseEnter={handleTemplateEnter} onMouseLeave={handleTemplateLeave}>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-text-tertiary transition-colors duration-200 hover:bg-surface-card hover:text-text-secondary"
                title={selectedTemplate ? `${t("messageInput.template.tooltip")}：${selectedTemplate.name}` : isTemplateDisabled ? t("messageInput.template.disabled") : t("messageInput.template.select")}
                aria-label={selectedTemplate ? `${t("messageInput.template.tooltip")}：${selectedTemplate.name}` : isTemplateDisabled ? t("messageInput.template.disabled") : t("messageInput.template.select")}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>

              {templateOpen && (
                <div className="absolute bottom-full right-0 z-[90] mb-2 w-56 overflow-hidden rounded-xl border border-surface-border bg-surface-elevated py-1 shadow-xl animate-fade-in">
                  <div className="px-3 py-2 text-xs font-medium text-text-tertiary">{t("messageInput.template.select")}</div>
                  <div className="px-1 pb-1">
                    <button
                      type="button"
                      onClick={() => handleTemplateSelect(0)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                        isTemplateDisabled
                          ? "bg-surface-card text-text-primary font-medium shadow-sm"
                          : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                      )}
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                        {isTemplateDisabled && <Check className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{t("messageInput.template.none")}</span>
                    </button>
                  </div>
                  {templates.length === 0 ? (
                    <div className="px-3 pb-3 pt-1 text-sm text-text-tertiary">{t("messageInput.template.empty")}</div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto border-t border-surface-border/60 px-1 pb-1 pt-1">
                      {templates.map((tpl) => (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => handleTemplateSelect(tpl.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                            selectedTemplateId === tpl.id
                              ? "bg-surface-card text-text-primary font-medium shadow-sm"
                              : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                          )}
                        >
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                            {selectedTemplateId === tpl.id && <Check className="h-3.5 w-3.5" />}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{tpl.name}</span>
                          {tpl.is_default && <span className="shrink-0 rounded-full bg-surface-card px-1.5 py-0.5 text-[10px] text-text-tertiary">{t("messageInput.template.default")}</span>}
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
              className="flex h-7 w-7 items-center justify-center rounded-lg text-brand transition-colors duration-200 hover:bg-surface-card hover:text-brand-hover"
              title={t("common.newChat")}
              aria-label={t("common.newChat")}
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
            </button>
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
          {/* 拖拽遮罩 */}
          {dragOver && (
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl bg-surface-card/95 border-2 border-dashed border-brand/40 pointer-events-none">
              <div className="flex flex-col items-center gap-2 text-text-secondary">
                <Paperclip className="w-8 h-8 text-brand/60" />
                <span className="text-sm font-medium">{t("chat.dropFilesHere")}</span>
              </div>
            </div>
          )}
          {/* 引用上下文 */}
          {activeQuotePreview && (
            <div className="px-4 pt-3" data-testid="chat-quote-draft">
              <div className="relative rounded-xl border border-surface-border/60 bg-surface-elevated/70 px-3 py-2.5 pr-10 shadow-sm">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
                  <Quote className="h-3.5 w-3.5" />
                  <span>{t("chat.quote.title")}</span>
                </div>
                <div className="line-clamp-3 whitespace-pre-wrap border-l-2 border-brand/35 pl-3 text-[13px] leading-5 text-text-secondary">
                  {activeQuotePreview}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setActiveQuote("");
                    textareaRef.current?.focus();
                  }}
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-surface-card hover:text-text-primary"
                  aria-label={t("chat.quote.clear")}
                  title={t("chat.quote.clear")}
                  data-testid="chat-quote-draft-clear"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-3 border-t border-surface-border/60" />
            </div>
          )}

          {/* 文件附件 */}
          {attachedFiles.length > 0 && (
            <div className="px-4 pt-3">
              <div className="flex flex-wrap gap-2">
                {attachedFiles.map((file, idx) => {
                  const status = file.parse_status || "pending";
                  const statusConfig: Record<string, { icon: React.ReactNode; label: string }> = {
                    pending: { icon: <div className="w-3.5 h-3.5 border-2 border-text-tertiary border-t-transparent rounded-full animate-spin" />, label: t("chat.fileStatusParsing") },
                    done: { icon: <FileText className="w-4 h-4 text-text-tertiary" />, label: t("chat.fileStatusDone") },
                    error: { icon: <div className="w-3.5 h-3.5 rounded-full bg-red-400" />, label: t("chat.fileStatusFailed") },
                    unsupported: { icon: <FileText className="w-4 h-4 text-text-tertiary" />, label: t("chat.fileStatusUnsupported") },
                  };
                  const cfg = statusConfig[status] || statusConfig.pending;
                  const isImage = isImageAttachment(file);
                  const isEmptyContent = status === "done" && !file.content?.trim() && !isImage;
                  const title = file.error_message
                    ? getErrorMessage(file.error_message, { module: "file", fallbackMessage: t("chat.fileParseFailedRetry") })
                    : isEmptyContent
                    ? t("chat.fileEmptyContent")
                    : cfg.label;
                  const hasIssue = status === "error" || status === "unsupported" || isEmptyContent;
                  const issueLabel = status === "unsupported"
                    ? t("chat.fileStatusUnsupported")
                    : isEmptyContent
                    ? t("chat.fileEmptyShort")
                    : t("chat.fileStatusFailed");
                  const previewUrl = getFilePreviewUrl(file);

                  if (isImage && previewUrl) {
                    return (
                      <div
                        key={idx}
                        className="group relative h-24 w-24 overflow-hidden rounded-xl border border-surface-border/50 bg-surface-elevated shadow-sm transition-all"
                        title={title}
                      >
                        <img src={previewUrl} alt={file.filename} className="h-full w-full object-cover" draggable={false} />
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 via-black/25 to-transparent px-2 pb-1.5 pt-5">
                          <span className="block truncate text-[11px] font-medium text-white drop-shadow">{file.filename}</span>
                        </div>
                        {status !== "done" && (
                          <div className="absolute left-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-black/55 px-1.5 text-white shadow-sm backdrop-blur">
                            {cfg.icon}
                          </div>
                        )}
                        {hasIssue && (
                          <div className="absolute inset-x-1.5 bottom-1.5 rounded-lg border border-red-300/50 bg-red-950/75 px-1.5 py-1 text-[10px] font-medium leading-tight text-red-50 shadow-sm backdrop-blur" data-testid="chat-attachment-error-label">
                            <div>{issueLabel}</div>
                            <div className="line-clamp-2 font-normal opacity-90">{title}</div>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removeAttachedFile(idx)}
                          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white opacity-90 shadow-sm transition-colors hover:bg-black/75"
                          aria-label={file.filename}
                          title={file.filename}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={idx}
                      className={cn(
                        "flex items-center gap-2 rounded-xl border bg-surface-card px-3 py-1.5 text-[13px] transition-all",
                        hasIssue ? "border-red-400/40 bg-red-500/5" : "border-surface-border/30"
                      )}
                      title={title}
                      data-testid={hasIssue ? "chat-attachment-error-chip" : "chat-attachment-chip"}
                    >
                      <div className="shrink-0">{cfg.icon}</div>
                      <div className="min-w-0 max-w-[220px]">
                        <div className={cn("truncate text-text-primary", hasIssue && "text-red-400")}>{file.filename}</div>
                        {hasIssue && (
                          <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] leading-tight text-red-400" data-testid="chat-attachment-error-label">
                            <span className="shrink-0 rounded-full bg-red-500/10 px-1.5 py-0.5 font-medium">{issueLabel}</span>
                            <span className="truncate text-red-400/80">{title}</span>
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeAttachedFile(idx)}
                        className="flex items-center justify-center w-4 h-4 rounded-full hover:bg-black/5 transition-colors shrink-0 ml-0.5"
                        aria-label={file.filename}
                        title={file.filename}
                      >
                        <X className="w-3 h-3 text-text-tertiary" />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 border-t border-surface-border/60" />
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={t("chat.placeholder")}
            rows={1}
            className={cn(
              "w-full min-h-[92px] shrink-0 resize-none overflow-hidden bg-transparent px-4 pb-1 text-[15px] font-normal leading-6 text-slate-900 outline-none placeholder:text-slate-400 [font-family:Inter,'PingFang_SC','Microsoft_YaHei',sans-serif] dark:text-text-primary dark:placeholder:text-text-tertiary",
              attachedFiles.length > 0 ? "pt-3" : "pt-4"
            )}
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
                    effectiveSearchEnabled
                      ? "border-surface-border bg-surface-card text-text-primary shadow-sm"
                      : "border-surface-border bg-transparent text-text-tertiary hover:text-text-secondary hover:border-text-tertiary/50"
                  )}
                >
                  <Wrench className="w-3.5 h-3.5" />
                  <span>{t("chat.tools")}</span>
                  {effectiveSearchEnabled && (
                    <span className="text-[11px] opacity-70 ml-0.5">· {t("chat.webSearch")}</span>
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
                          effectiveSearchEnabled
                            ? "bg-surface-card text-text-primary font-medium shadow-sm"
                            : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                        )}
                      >
                        <span className={cn(
                          "w-4 h-4 rounded border-2 flex items-center justify-center transition-colors",
                          effectiveSearchEnabled
                            ? "bg-slate-900 border-slate-900 dark:bg-text-primary dark:border-text-primary"
                            : "border-text-tertiary/40"
                        )}>
                          {effectiveSearchEnabled && <span className="text-white text-[10px] font-bold">✓</span>}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Search className="w-3.5 h-3.5" />
                            <span>{t("chat.webSearch")}</span>
                          </div>
                        </div>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative mr-1" ref={reasoningRef}>
                <button
                  type="button"
                  onClick={() => setReasoningOpen((open) => !open)}
                  className={cn(
                    "flex items-center gap-1.5 pl-3 pr-2.5 py-1.5 text-[13px] font-medium rounded-full transition-colors duration-200",
                    reasoning.enabled
                      ? "bg-surface-card text-text-primary hover:bg-surface-elevated"
                      : "bg-surface-card text-text-secondary hover:text-text-primary hover:bg-surface-elevated"
                  )}
                >
                  {currentReasoningMode.icon}
                  <span>{currentReasoningMode.label}</span>
                  <ChevronDown className="w-3.5 h-3.5 opacity-60" />
                </button>

                {reasoningOpen && (
                  <div className="absolute bottom-full right-0 mb-2 w-64 rounded-xl border border-surface-border bg-surface-elevated shadow-xl z-[90] py-2 animate-fade-in overflow-hidden">
                    <div className="px-3 py-1.5 text-[11px] font-medium text-text-tertiary uppercase tracking-wider border-b border-surface-border mb-1">
                      {t("messageInput.thinking.selectIntensity")}
                    </div>
                    <div className="px-1 space-y-1">
                      {reasoningModes.map((mode) => {
                        const active = reasoningMode === mode.key;
                        return (
                          <button
                            key={mode.key}
                            type="button"
                            onClick={() => selectReasoningMode(mode.key)}
                            className={cn(
                              "group flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                              active
                                ? "bg-surface-card text-text-primary"
                                : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                            )}
                          >
                            <span className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-0.5 transition-colors",
                              active ? "bg-brand/10 text-brand" : "bg-surface-card text-text-tertiary group-hover:bg-brand/25 group-hover:text-brand"
                            )}>
                              {mode.icon}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={cn("text-sm", active && "font-medium")}>{mode.label}</span>
                                {active && <Check className="w-3.5 h-3.5 text-text-primary shrink-0" />}
                              </div>
                              <p className="text-[11px] text-text-tertiary mt-0.5 leading-snug">
                                {mode.title}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
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
                  title={isOffline ? t("messageInput.network.offlineShort") : hasParsingFiles ? t("chat.fileParsingWaitShort") : t("chat.send")}
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
        </div>

        {/* 底部提示 */}
        {/* 已删除：AI 可能会出现错误，请勿分享敏感信息 */}
        <input
          ref={fileInputRef}
          type="file"
          accept={currentModel?.file_accept || SUPPORTED_FILE_ACCEPT}
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
      </form>
    </div>
  );
}

