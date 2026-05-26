"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ChevronDown,
  Copy,
  FileImage,
  History,
  Languages,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";
import ModelSelector from "@/components/chat/ModelSelector";
import { ChatModel, useModels } from "@/hooks/useModels";
import { consumeChatStream } from "@/lib/chatStream";
import { cn } from "@/lib/utils";

const TRANSLATOR_SKILL_KEY = "translator";
const DEFAULT_MODEL = "gpt-5.4-mini";

type TranslateMode = "text" | "image";

type LangOption = {
  label: string;
  value: string;
};

type UploadedImage = {
  file: File;
  previewUrl: string;
  publicId?: string;
  filename?: string;
};

type HistoryItem = {
  id: number;
  title: string;
  model: string;
  updated_at: string;
};

const LANGS: LangOption[] = [
  { label: "自动识别", value: "auto" },
  { label: "中文", value: "zh" },
  { label: "英语", value: "en" },
  { label: "日语", value: "ja" },
  { label: "韩语", value: "ko" },
  { label: "法语", value: "fr" },
  { label: "德语", value: "de" },
  { label: "西班牙语", value: "es" },
];

function getAuthHeaders() {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : "";
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function getUploadHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function langLabel(value: string) {
  return LANGS.find((item) => item.value === value)?.label || value;
}

function LangDropdown({
  value,
  options,
  onChange,
}: {
  value: string;
  options: LangOption[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-10 items-center gap-2 rounded-xl border border-surface-border bg-surface px-3 text-sm text-text-primary transition",
          open && "border-brand/50 ring-1 ring-brand/30"
        )}
      >
        <span className="min-w-[60px] text-left">{selected?.label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-[80] mt-1 w-40 rounded-xl border border-surface-border bg-surface-elevated shadow-xl overflow-hidden">
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={cn(
                  "flex w-full items-center px-3 py-2 text-left text-sm transition",
                  value === opt.value
                    ? "bg-surface-card font-medium text-text-primary"
                    : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}


function supportsVision(model: ChatModel) {
  const inputs = model.supported_inputs || [];
  const caps = model.capabilities || [];
  return inputs.includes("image") || caps.includes("vision") || caps.includes("image") || /vision|image|gpt-4o|gemini|claude/i.test(model.id);
}

function extractTranslatorResult(raw: string) {
  const cleaned = raw.trim();
  const sourceMatch = cleaned.match(/<SOURCE_TEXT>([\s\S]*?)<\/SOURCE_TEXT>/i);
  const translationMatch = cleaned.match(/<TRANSLATION>([\s\S]*?)<\/TRANSLATION>/i);
  return {
    sourceText: sourceMatch?.[1]?.trim() || "",
    translation: translationMatch?.[1]?.trim() || cleaned,
  };
}

async function createConversation(title: string, model: string) {
  const res = await fetch("/api/conversations", {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ title, model, skill_key: TRANSLATOR_SKILL_KEY }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "创建翻译会话失败");
  }
  return res.json() as Promise<{ id: number }>;
}

export default function TranslatorPage() {
  const { models, loading } = useModels();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<TranslateMode>("text");
  const [sourceLang, setSourceLang] = useState("auto");
  const [targetLang, setTargetLang] = useState("zh");
  const [inputText, setInputText] = useState("");
  const [recognizedText, setRecognizedText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [image, setImage] = useState<UploadedImage | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [selectedModel, setSelectedModel] = useState<ChatModel | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [activeHistoryId, setActiveHistoryId] = useState<number | null>(null);

  const visionModels = useMemo(() => models.filter(supportsVision), [models]);

  useEffect(() => {
    if (models.length === 0) return;
    const preferred = models.find((m) => m.id === DEFAULT_MODEL) || models[0];
    setSelectedModel((current) => current || preferred);
  }, [models]);

  useEffect(() => {
    const loadHistory = async () => {
      const token = localStorage.getItem("token");
      if (!token) return;
      setHistoryLoading(true);
      try {
        const res = await fetch(`/api/conversations?skill_key=${TRANSLATOR_SKILL_KEY}&limit=100`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        setHistory(data.conversations || []);
      } finally {
        setHistoryLoading(false);
      }
    };
    loadHistory();

    const refresh = () => loadHistory();
    window.addEventListener("conversation-created", refresh);
    return () => window.removeEventListener("conversation-created", refresh);
  }, []);

  useEffect(() => {
    if (mode !== "image" || models.length === 0) return;
    if (selectedModel && supportsVision(selectedModel)) return;
    const next = visionModels[0] || models[0];
    setSelectedModel(next);
  }, [mode, models, selectedModel, visionModels]);

  useEffect(() => {
    return () => {
      if (image?.previewUrl) URL.revokeObjectURL(image.previewUrl);
    };
  }, [image?.previewUrl]);

  const swapLang = () => {
    if (sourceLang === "auto") return;
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
    if (translatedText) {
      setInputText(translatedText);
      setTranslatedText(inputText);
    }
  };

  const loadHistoryConversation = async (id: number) => {
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const res = await fetch(`/api/conversations/${id}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const messages = data.messages || [];
      const assistantMsg = messages.find((m: any) => m.role === "assistant");
      if (assistantMsg?.content) {
        const parsed = extractTranslatorResult(assistantMsg.content);
        setTranslatedText(parsed.translation);
        setRecognizedText(parsed.sourceText);
        if (parsed.sourceText && mode === "text") {
          setInputText(parsed.sourceText);
        }
      }
      const userMsg = messages.find((m: any) => m.role === "user");
      if (userMsg?.content && mode === "text" && !inputText) {
        const promptLines = userMsg.content.split("\n\n");
        const lastLine = promptLines[promptLines.length - 1];
        if (lastLine) setInputText(lastLine);
      }
      setConversationId(id);
      setActiveHistoryId(id);
    } catch (err) {
      console.error("load history failed", err);
    }
  };

  const deleteHistoryItem = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const res = await fetch(`/api/conversations/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      setHistory((prev) => prev.filter((h) => h.id !== id));
      if (activeHistoryId === id) {
        setActiveHistoryId(null);
        setConversationId(null);
      }
    } catch (err) {
      console.error("delete history failed", err);
    }
  };

  const reset = () => {
    setInputText("");
    setRecognizedText("");
    setTranslatedText("");
    setStreamingText("");
    setConversationId(null);
    setActiveHistoryId(null);
    if (image?.previewUrl) URL.revokeObjectURL(image.previewUrl);
    setImage(null);
  };

  const selectImage = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.warning("请上传图片文件");
      return;
    }
    if (image?.previewUrl) URL.revokeObjectURL(image.previewUrl);
    setImage({ file, previewUrl: URL.createObjectURL(file) });
    setRecognizedText("");
    setTranslatedText("");
    setStreamingText("");
  };

  const uploadImage = async () => {
    if (!image) throw new Error("请先上传图片");
    if (image.publicId) return image.publicId;
    const formData = new FormData();
    formData.append("file", image.file);
    const res = await fetch("/api/files/upload", {
      method: "POST",
      headers: getUploadHeaders(),
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || "图片上传失败");
    }
    const data = await res.json();
    const publicId = data.public_id as string;
    setImage((prev) => prev ? { ...prev, publicId, filename: data.filename } : prev);
    return publicId;
  };

  const translate = async () => {
    if (!selectedModel || isTranslating) return;
    const text = inputText.trim();
    if (mode === "text" && !text) {
      toast.warning("请输入要翻译的文本");
      return;
    }
    if (mode === "image" && !image) {
      toast.warning("请上传要翻译的图片");
      return;
    }

    setIsTranslating(true);
    setRecognizedText("");
    setTranslatedText("");
    setStreamingText("");
    try {
      const fileId = mode === "image" ? await uploadImage() : undefined;
      const titleSeed = mode === "text" ? text : image?.file.name || "图片翻译";
      const title = titleSeed.length > 22 ? `${titleSeed.slice(0, 22)}...` : titleSeed;
      const convId = conversationId || (await createConversation(title || "AI翻译", selectedModel.id)).id;
      setConversationId(convId);

      const targetLangName = langLabel(targetLang);
      const sourceLangName = sourceLang === "auto" ? "原文（自动识别）" : langLabel(sourceLang);
      const systemPrompt = `你是 AI Space 的 AI翻译官。请严格执行：\n1. 保留原意、语气和格式，不扩写、不总结。\n2. 术语、品牌、人名、代码、URL、数字单位保持准确。\n3. 图片模式先识别图片中的文字，再翻译。\n4. 用户要求的目标语言是「${targetLangName}」。你必须严格将内容翻译成该语言，绝对禁止用中文或其他语言输出译文。\n5. 只按以下格式输出：\n<SOURCE_TEXT>识别到的原文；文本模式可原样返回用户输入</SOURCE_TEXT>\n<TRANSLATION>翻译结果</TRANSLATION>`;
      const userPrompt = mode === "image"
        ? `请识别这张图片中的文字，并将其翻译成${targetLangName}。如果图片内有多段文字，请保持段落顺序。`
        : sourceLang === "auto"
          ? `请识别下面文本的源语言，并将其翻译成${targetLangName}：\n\n${text}`
          : `请把下面文本从${sourceLangName}翻译成${targetLangName}：\n\n${text}`;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          model: selectedModel.id,
          stream: true,
          search: false,
          reasoning: false,
          conversation_id: convId,
          skill_key: TRANSLATOR_SKILL_KEY,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          ...(fileId ? { file_ids: [fileId], message_file_ids: [fileId] } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || "翻译失败");
      }
      const contentType = res.headers.get("content-type") || "";
      const raw = contentType.includes("text/event-stream") && res.body
        ? await consumeChatStream(res, { onDelta: (_delta, fullText) => setStreamingText(fullText) })
        : JSON.stringify(await res.json());
      const parsed = extractTranslatorResult(raw);
      setRecognizedText(parsed.sourceText || (mode === "text" ? text : ""));
      setTranslatedText(parsed.translation);
      setStreamingText("");
    } catch (err: any) {
      toast.error(err.message || "翻译失败");
    } finally {
      setIsTranslating(false);
    }
  };

  const copyResult = async () => {
    const text = translatedText || extractTranslatorResult(streamingText).translation;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    toast.success("已复制译文");
  };

  const displayed = translatedText || extractTranslatorResult(streamingText).translation;
  const selected = selectedModel || models[0];
  const modelList = mode === "image" && visionModels.length > 0 ? visionModels : models;

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 86400000 && d.getDate() === now.getDate()) return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    if (diff < 172800000 && d.getDate() === now.getDate() - 1) return "昨天";
    return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  };

  return (
    <div className="flex h-full bg-surface-elevated">
      <header className="shrink-0 border-b border-surface-border bg-surface/80 px-6 py-4 backdrop-blur md:px-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Languages className="h-4 w-4 text-brand" />
              AI 工作 / Skill
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-text-primary">AI 翻译官</h1>
            <p className="mt-1 text-sm text-text-secondary">文本、图片，一页完成精准翻译</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowHistory(true)}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-3 text-sm font-medium text-text-secondary transition hover:text-text-primary hover:bg-surface"
              title="翻译历史"
            >
              <History className="h-4 w-4" />
              <span className="hidden sm:inline">历史</span>
            </button>
            {selected && !loading && (
              <ModelSelector models={modelList} selected={selected} onSelect={setSelectedModel} />
            )}
            <button
              onClick={reset}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-4 text-sm font-medium text-text-primary transition hover:bg-surface"
            >
              <Plus className="h-4 w-4" />
              新建翻译
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto px-6 py-6 md:px-10 md:py-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-5">
          <section className="rounded-2xl border border-surface-border bg-surface-card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <LangDropdown value={sourceLang} options={LANGS} onChange={setSourceLang} />
              <button
                onClick={swapLang}
                disabled={sourceLang === "auto"}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-surface-border bg-surface text-text-secondary transition hover:text-text-primary disabled:opacity-40"
              >
                <ArrowLeftRight className="h-4 w-4" />
              </button>
              <LangDropdown value={targetLang} options={LANGS.filter((lang) => lang.value !== "auto")} onChange={setTargetLang} />

              <div className="ml-auto flex rounded-xl border border-surface-border bg-surface p-1">
                {(["text", "image"] as TranslateMode[]).map((item) => (
                  <button
                    key={item}
                    onClick={() => setMode(item)}
                    className={cn(
                      "rounded-lg px-4 py-2 text-sm font-medium transition",
                      mode === item ? "bg-brand text-white" : "text-text-secondary hover:text-text-primary"
                    )}
                  >
                    {item === "text" ? "文本翻译" : "图片翻译"}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            <div className="flex min-h-[560px] flex-col rounded-2xl border border-surface-border bg-surface-card">
              <div className="flex h-14 items-center justify-between border-b border-surface-border px-5">
                <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  {mode === "text" ? <Sparkles className="h-4 w-4 text-brand" /> : <FileImage className="h-4 w-4 text-brand" />}
                  {mode === "text" ? "原文" : "图片"}
                </div>
              </div>

              {mode === "text" ? (
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="输入要翻译的文本..."
                  className="min-h-0 flex-1 resize-none bg-transparent p-5 text-base leading-7 text-text-primary outline-none placeholder:text-text-tertiary"
                />
              ) : (
                <div className="flex flex-1 flex-col gap-4 p-5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => selectImage(e.target.files?.[0])}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      selectImage(e.dataTransfer.files?.[0]);
                    }}
                    className={cn(
                      "flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-surface-border bg-surface text-center transition",
                      dragOver && "border-brand bg-brand/5"
                    )}
                  >
                    {image ? (
                      <img src={image.previewUrl} alt="待翻译图片" className="max-h-[340px] max-w-full rounded-xl object-contain" />
                    ) : (
                      <>
                        <UploadCloud className="mb-3 h-9 w-9 text-brand" />
                        <div className="text-sm font-medium text-text-primary">点击或拖拽上传图片</div>
                        <div className="mt-1 text-xs text-text-secondary">支持截图、海报、文档图片</div>
                      </>
                    )}
                  </button>
                  {image && (
                    <button
                      onClick={() => {
                        if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
                        setImage(null);
                      }}
                      className="inline-flex w-fit items-center gap-2 rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm text-text-secondary hover:text-text-primary"
                    >
                      <X className="h-4 w-4" />
                      移除图片
                    </button>
                  )}
                  {recognizedText && (
                    <div className="rounded-xl border border-surface-border bg-surface p-4">
                      <div className="mb-2 text-xs font-medium text-text-secondary">识别原文</div>
                      <div className="whitespace-pre-wrap text-sm leading-6 text-text-primary">{recognizedText}</div>
                    </div>
                  )}
                </div>
              )}

              <div className="border-t border-surface-border p-4">
                <button
                  onClick={translate}
                  disabled={isTranslating || !selected}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isTranslating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {isTranslating ? "翻译中" : "开始翻译"}
                </button>
              </div>
            </div>

            <div className="flex min-h-[560px] flex-col rounded-2xl border border-surface-border bg-surface-card">
              <div className="flex h-14 items-center justify-between border-b border-surface-border px-5">
                <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  <Languages className="h-4 w-4 text-brand" />
                  译文
                </div>
                <button
                  onClick={copyResult}
                  disabled={!displayed}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-surface-border bg-surface px-3 text-sm text-text-secondary transition hover:text-text-primary disabled:opacity-40"
                >
                  <Copy className="h-4 w-4" />
                  复制
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-5">
                {displayed ? (
                  <div className="whitespace-pre-wrap text-base leading-7 text-text-primary">{displayed}</div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-center text-text-secondary">
                    <Languages className="mb-3 h-10 w-10 text-text-tertiary" />
                    <div className="text-sm">译文会显示在这里</div>
                    <div className="mt-1 text-xs text-text-tertiary">文本和图片共用同一个结果区</div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* 右侧历史抽屉 */}
      {showHistory && (
        <>
          <div
            className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm transition-opacity"
            onClick={() => setShowHistory(false)}
          />
          <div className="fixed top-0 right-0 bottom-0 z-[71] w-[340px] bg-surface-elevated border-l border-surface-border shadow-2xl flex flex-col transition-transform duration-300 ease-out">
            <div className="shrink-0 flex items-center justify-between px-4 py-3.5 border-b border-surface-border">
              <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <History className="h-4 w-4 text-brand" />
                翻译历史
              </div>
              <button
                onClick={() => setShowHistory(false)}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto py-2">
              {historyLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
                </div>
              ) : history.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 px-4 text-center">
                  <MessageSquare className="h-6 w-6 text-text-tertiary" />
                  <p className="text-xs text-text-tertiary">暂无翻译记录</p>
                </div>
              ) : (
                <div className="space-y-0.5 px-2">
                  {history.map((item) => {
                    const isActive = activeHistoryId === item.id;
                    return (
                      <div
                        key={item.id}
                        onClick={() => { loadHistoryConversation(item.id); setShowHistory(false); }}
                        className={cn(
                          "group relative flex cursor-pointer items-start gap-2 rounded-lg px-3 py-2.5 transition",
                          isActive ? "bg-surface-card text-text-primary" : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                        )}
                      >
                        <Languages className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", isActive ? "text-brand" : "text-text-tertiary")} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium">{item.title}</div>
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-tertiary">
                            <span>{formatDate(item.updated_at)}</span>
                          </div>
                        </div>
                        <button
                          onClick={(e) => deleteHistoryItem(item.id, e)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-text-tertiary hover:text-red-400 hover:bg-red-500/10 transition"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
