"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  Copy,
  History,
  Languages,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { readApiError, showUserError } from "@/lib/errors";
import { postProcessTranslationFormat } from "@/lib/translatorFormat";
import HistoryDrawer, { type HistoryItem as DrawerHistoryItem } from "@/components/ui/HistoryDrawer";

const TRANSLATOR_SKILL_KEY = "translator";
const MAX_TEXT_LENGTH = 20000;
const TRANSLATOR_MODEL_LABEL = "Google Translation LLM";

type LangOption = {
  labelKey?: string;
  label?: string;
  promptLabel: string;
  value: string;
  supportSource?: boolean;
  supportTarget?: boolean;
};

type SupportedLanguageAPIItem = {
  language_code: string;
  display_name?: string;
  support_source?: boolean;
  support_target?: boolean;
};

type HistoryItem = {
  id: number;
  title: string;
  model: string;
  updated_at: string;
};

const FALLBACK_LANGS: LangOption[] = [
  { labelKey: "translator.lang.auto", promptLabel: "自动检测", value: "auto" },
  { labelKey: "translator.lang.zh", promptLabel: "中文", value: "zh" },
  { labelKey: "translator.lang.en", promptLabel: "英语", value: "en" },
  { labelKey: "translator.lang.ja", promptLabel: "日语", value: "ja" },
  { labelKey: "translator.lang.ko", promptLabel: "韩语", value: "ko" },
  { labelKey: "translator.lang.fr", promptLabel: "法语", value: "fr" },
  { labelKey: "translator.lang.de", promptLabel: "德语", value: "de" },
  { labelKey: "translator.lang.es", promptLabel: "西班牙语", value: "es" },
  { labelKey: "translator.lang.pt", promptLabel: "葡萄牙语", value: "pt" },
  { labelKey: "translator.lang.it", promptLabel: "意大利语", value: "it" },
  { labelKey: "translator.lang.ru", promptLabel: "俄语", value: "ru" },
  { labelKey: "translator.lang.ar", promptLabel: "阿拉伯语", value: "ar" },
  { labelKey: "translator.lang.hi", promptLabel: "印地语", value: "hi" },
  { labelKey: "translator.lang.id", promptLabel: "印尼语", value: "id" },
  { labelKey: "translator.lang.vi", promptLabel: "越南语", value: "vi" },
  { labelKey: "translator.lang.th", promptLabel: "泰语", value: "th" },
  { labelKey: "translator.lang.ms", promptLabel: "马来语", value: "ms" },
  { labelKey: "translator.lang.fil", promptLabel: "菲律宾语", value: "fil" },
  { labelKey: "translator.lang.tr", promptLabel: "土耳其语", value: "tr" },
  { labelKey: "translator.lang.nl", promptLabel: "荷兰语", value: "nl" },
  { labelKey: "translator.lang.pl", promptLabel: "波兰语", value: "pl" },
  { labelKey: "translator.lang.sv", promptLabel: "瑞典语", value: "sv" },
  { labelKey: "translator.lang.uk", promptLabel: "乌克兰语", value: "uk" },
  { labelKey: "translator.lang.he", promptLabel: "希伯来语", value: "he" },
  { labelKey: "translator.lang.el", promptLabel: "希腊语", value: "el" },
  { labelKey: "translator.lang.cs", promptLabel: "捷克语", value: "cs" },
  { labelKey: "translator.lang.da", promptLabel: "丹麦语", value: "da" },
  { labelKey: "translator.lang.fi", promptLabel: "芬兰语", value: "fi" },
  { labelKey: "translator.lang.no", promptLabel: "挪威语", value: "no" },
  { labelKey: "translator.lang.ro", promptLabel: "罗马尼亚语", value: "ro" },
  { labelKey: "translator.lang.hu", promptLabel: "匈牙利语", value: "hu" },
  { labelKey: "translator.lang.sk", promptLabel: "斯洛伐克语", value: "sk" },
  { labelKey: "translator.lang.bg", promptLabel: "保加利亚语", value: "bg" },
  { labelKey: "translator.lang.hr", promptLabel: "克罗地亚语", value: "hr" },
  { labelKey: "translator.lang.sr", promptLabel: "塞尔维亚语", value: "sr" },
  { labelKey: "translator.lang.sl", promptLabel: "斯洛文尼亚语", value: "sl" },
  { labelKey: "translator.lang.lt", promptLabel: "立陶宛语", value: "lt" },
  { labelKey: "translator.lang.lv", promptLabel: "拉脱维亚语", value: "lv" },
  { labelKey: "translator.lang.et", promptLabel: "爱沙尼亚语", value: "et" },
  { labelKey: "translator.lang.bn", promptLabel: "孟加拉语", value: "bn" },
  { labelKey: "translator.lang.ur", promptLabel: "乌尔都语", value: "ur" },
  { labelKey: "translator.lang.fa", promptLabel: "波斯语", value: "fa" },
  { labelKey: "translator.lang.pa", promptLabel: "旁遮普语", value: "pa" },
  { labelKey: "translator.lang.ta", promptLabel: "泰米尔语", value: "ta" },
  { labelKey: "translator.lang.te", promptLabel: "泰卢固语", value: "te" },
  { labelKey: "translator.lang.my", promptLabel: "缅甸语", value: "my" },
  { labelKey: "translator.lang.km", promptLabel: "高棉语", value: "km" },
  { labelKey: "translator.lang.lo", promptLabel: "老挝语", value: "lo" },
  { labelKey: "translator.lang.mn", promptLabel: "蒙古语", value: "mn" },
  { labelKey: "translator.lang.kk", promptLabel: "哈萨克语", value: "kk" },
  { labelKey: "translator.lang.sw", promptLabel: "斯瓦希里语", value: "sw" },
  { labelKey: "translator.lang.af", promptLabel: "南非荷兰语", value: "af" },
  { labelKey: "translator.lang.zu", promptLabel: "祖鲁语", value: "zu" },
  { labelKey: "translator.lang.ha", promptLabel: "豪萨语", value: "ha" },
  { labelKey: "translator.lang.am", promptLabel: "阿姆哈拉语", value: "am" },
  { labelKey: "translator.lang.is", promptLabel: "冰岛语", value: "is" },
  { labelKey: "translator.lang.ga", promptLabel: "爱尔兰语", value: "ga" },
  { labelKey: "translator.lang.ca", promptLabel: "加泰罗尼亚语", value: "ca" },
  { labelKey: "translator.lang.eu", promptLabel: "巴斯克语", value: "eu" },
];

function getAuthHeaders() {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : "";
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function getLanguageLabel(option: LangOption, t: (key: string) => string) {
  return option.labelKey ? t(option.labelKey) : option.label || option.promptLabel || option.value;
}

function langPromptLabel(value: string, languages: LangOption[]) {
  return languages.find((item) => item.value === value)?.promptLabel || value;
}

function toAppLanguageCode(code: string) {
  const normalized = code.trim();
  const lower = normalized.toLowerCase();
  switch (lower) {
    case "zh":
    case "zh-cn":
      return "zh";
    case "tl":
      return "fil";
    default:
      return normalized;
  }
}

function toDisplayLanguageCode(language: string) {
  if (language.startsWith("zh")) return "zh-CN";
  return language;
}

function buildLanguageOptions(items: SupportedLanguageAPIItem[]) {
  const seen = new Set<string>();
  const options: LangOption[] = [];
  for (const item of items) {
    const value = toAppLanguageCode(item.language_code || "");
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const label = item.display_name || value;
    options.push({
      value,
      label,
      promptLabel: label,
      supportSource: item.support_source !== false,
      supportTarget: item.support_target !== false,
    });
  }
  return options.length ? options : FALLBACK_LANGS.filter((lang) => lang.value !== "auto");
}

function LangDropdown({
  value,
  options,
  onChange,
  t,
}: {
  value: string;
  options: LangOption[];
  onChange: (v: string) => void;
  t: (key: string) => string;
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
          "flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-surface-border bg-surface px-3 text-sm text-text-primary transition",
          open && "border-brand/50 ring-1 ring-brand/30"
        )}
      >
        <span className="flex-1 text-left">{selected ? getLanguageLabel(selected, t) : value}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-[80] mt-1 max-h-80 w-40 overflow-y-auto rounded-xl border border-surface-border bg-surface-elevated shadow-xl">
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
                {getLanguageLabel(opt, t)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
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

async function createConversation(title: string, model: string, t: (key: string) => string) {
  const res = await fetch("/api/conversations", {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ title, model, skill_key: TRANSLATOR_SKILL_KEY }),
  });
  if (!res.ok) {
    throw await readApiError(res);
  }
  return res.json() as Promise<{ id: number }>;
}

async function saveConversationMessage(conversationId: number, role: "user" | "assistant", content: string, model?: string) {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : "";
  if (!token) return;
  const res = await fetch(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ role, content, model }),
  });
  if (!res.ok) {
    console.warn("save translator history failed", await res.text().catch(() => ""));
  }
}

export default function TranslatorPage() {
  const { t, language } = useI18n();
  const [sourceLang, setSourceLang] = useState("auto");
  const [targetLang, setTargetLang] = useState("en");
  const [languageOptions, setLanguageOptions] = useState<LangOption[]>(FALLBACK_LANGS.filter((lang) => lang.value !== "auto"));
  const [inputText, setInputText] = useState("");
  const [recognizedText, setRecognizedText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [activeHistoryId, setActiveHistoryId] = useState<number | null>(null);

  const sourceLanguageOptions = [FALLBACK_LANGS[0], ...languageOptions.filter((lang) => lang.supportSource !== false)];
  const targetLanguageOptions = languageOptions.filter((lang) => lang.value !== "auto" && lang.supportTarget !== false);

  const loadSupportedLanguages = async () => {
    try {
      const res = await fetch(`/api/translate/languages?display_language=${encodeURIComponent(toDisplayLanguageCode(language))}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw await readApiError(res);
      const data = await res.json() as { languages?: SupportedLanguageAPIItem[] };
      const options = buildLanguageOptions(data.languages || []);
      setLanguageOptions(options);
      if (!options.some((lang) => lang.value === targetLang && lang.supportTarget !== false)) {
        setTargetLang(options.find((lang) => lang.supportTarget !== false)?.value || "en");
      }
    } catch (err) {
      console.warn("load supported translator languages failed", err);
      setLanguageOptions(FALLBACK_LANGS.filter((lang) => lang.value !== "auto"));
    }
  };

  const loadHistoryList = async () => {
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

  useEffect(() => {
    loadHistoryList();

    const refresh = () => loadHistoryList();
    window.addEventListener("conversation-created", refresh);
    return () => window.removeEventListener("conversation-created", refresh);
  }, []);

  useEffect(() => {
    void loadSupportedLanguages();
  }, [language]);


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
        if (parsed.sourceText) {
          setInputText(parsed.sourceText);
        }
      }
      const userMsg = messages.find((m: any) => m.role === "user");
      if (userMsg?.content && !inputText) {
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

  const deleteHistoryItem = async (id: number) => {
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

  const reset = async () => {
    await loadHistoryList();
    setInputText("");
    setRecognizedText("");
    setTranslatedText("");
    setStreamingText("");
    setConversationId(null);
    setActiveHistoryId(null);
  };

  const translate = async () => {
    if (isTranslating) return;
    const text = inputText.trim();
    if (!text) {
      toast.warning(t("translator.error.emptyInput"));
      return;
    }

    setIsTranslating(true);
    setRecognizedText("");
    setTranslatedText("");
    setStreamingText("");
    try {
      const titleSeed = text;
      const title = titleSeed.length > 22 ? `${titleSeed.slice(0, 22)}...` : titleSeed;
      const convId = conversationId || (await createConversation(title || t("translator.defaultTitle"), TRANSLATOR_MODEL_LABEL, t)).id;
      setConversationId(convId);

      const res = await fetch("/api/translate", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          text,
          source_language: sourceLang,
          target_language: targetLang,
          mime_type: "text/plain",
        }),
      });
      if (!res.ok) {
        throw await readApiError(res);
      }
      const data = await res.json() as { translated_text?: string; detected_source_language?: string; provider?: string };
      const raw = data.translated_text || "";
      const formatted = postProcessTranslationFormat(inputText, raw, targetLang);
      setRecognizedText(inputText);
      setTranslatedText(formatted);
      setStreamingText("");

      await saveConversationMessage(convId, "user", text, TRANSLATOR_MODEL_LABEL);
      await saveConversationMessage(convId, "assistant", `<SOURCE_TEXT>${text}</SOURCE_TEXT>
<TRANSLATION>${formatted}</TRANSLATION>`, TRANSLATOR_MODEL_LABEL);
    } catch (err) {
      showUserError(err, { module: "chat", fallbackTitle: t("translator.error.translate"), fallbackMessage: t("translator.error.translate") });
    } finally {
      setIsTranslating(false);
    }
  };

  const copyResult = async () => {
    const text = translatedText || extractTranslatorResult(streamingText).translation;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    toast.success(t("translator.copied"));
  };

  const displayed = translatedText || extractTranslatorResult(streamingText).translation;

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 86400000 && d.getDate() === now.getDate()) return d.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
    if (diff < 172800000 && d.getDate() === now.getDate() - 1) return t("translator.time.yesterday");
    return d.toLocaleDateString(language, { month: "short", day: "numeric" });
  };

  return (
    <div className="flex h-full flex-col bg-surface-elevated text-text-primary">
      <header className="shrink-0 border-b border-surface-border bg-surface-elevated px-6 py-4 md:px-10">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <Languages className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t("translator.title")}</h1>
              <p className="mt-0.5 text-sm text-text-secondary">{t("translator.subtitle")}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={reset}
              disabled={isTranslating}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-3 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-card hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              title={t("translator.resetTitle")}
            >
              <RotateCcw className="h-4 w-4" />
              {t("translator.reset")}
            </button>
            <button
              onClick={() => setShowHistory(true)}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-3 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-card hover:text-text-primary"
              title={t("translator.historyTitle")}
            >
              <History className="h-4 w-4" />
              {t("translator.history")}
            </button>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 overflow-auto px-6 py-6 md:px-10 md:py-8">
        <div className="flex min-h-[calc(100vh-180px)] w-full flex-col gap-5">
          <section className="grid min-h-0 flex-1 gap-5 lg:grid-cols-2">
                <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface-card shadow-sm">
                  <div className="flex h-14 items-center gap-3 border-b border-surface-border px-5">
                    <div className="flex-1">
                      <LangDropdown value={sourceLang} options={sourceLanguageOptions} onChange={setSourceLang} t={t} />
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-text-tertiary">
                      <ArrowRight className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <LangDropdown value={targetLang} options={targetLanguageOptions} onChange={setTargetLang} t={t} />
                    </div>
                  </div>

                  <div className="mx-5 min-h-0 flex-1 pt-5">
                    <textarea
                      value={inputText}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val.length <= MAX_TEXT_LENGTH) {
                          setInputText(val);
                        }
                      }}
                      placeholder={t("translator.placeholder")}
                      className="h-full w-full resize-none rounded-xl bg-surface p-5 text-base leading-7 text-text-primary outline-none placeholder:text-text-tertiary"
                    />
                  </div>
                  <div className="flex items-center justify-end px-5 py-3 text-xs text-text-tertiary">
                    <span className={cn(inputText.length >= MAX_TEXT_LENGTH && "text-red-400")}>
                      {inputText.length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()} {t("translator.wordCount")}
                    </span>
                  </div>

                  <div className="border-t border-surface-border p-4">
                    <button
                      onClick={translate}
                      disabled={isTranslating}
                      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isTranslating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {isTranslating ? t("translator.translating") : t("translator.translateBtn")}
                    </button>
                  </div>
                </div>

                <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface-card shadow-sm">
                  <div className="flex h-14 items-center justify-between border-b border-surface-border px-5">
                    <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                      <Sparkles className="h-4 w-4 text-brand" />
                      {t("translator.translation")}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="inline-flex h-9 items-center rounded-xl border border-surface-border bg-surface px-3 text-sm font-medium text-text-secondary">
                        {TRANSLATOR_MODEL_LABEL}
                      </div>
                      <button
                        onClick={copyResult}
                        disabled={!displayed}
                        className="inline-flex h-9 items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-3 text-sm text-text-secondary transition hover:bg-surface-card hover:text-text-primary disabled:opacity-40"
                      >
                        <Copy className="h-4 w-4" />
                        {t("translator.copy")}
                      </button>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto p-5">
                    {displayed ? (
                      <div data-i18n-skip="true" className="whitespace-pre-wrap rounded-xl bg-surface-elevated p-4 text-base leading-7 text-text-primary">{displayed}</div>
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center rounded-xl bg-surface text-center text-text-secondary">
                        <Languages className="mb-3 h-10 w-10 text-text-tertiary" />
                        <div className="text-sm">{t("translator.emptyResult")}</div>
                        <div className="mt-1 text-xs text-text-tertiary">{t("translator.emptyResultHint")}</div>
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 invisible">
                    <div className="flex items-center justify-end px-5 py-3 text-xs text-text-tertiary">
                      <span>0 / 20,000 {t("translator.wordCount")}</span>
                    </div>
                    <div className="p-4">
                      <button className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60">
                        <Send className="h-4 w-4" />
                        {t("translator.translateBtn")}
                      </button>
                    </div>
                  </div>
                </div>
          </section>
        </div>
      </main>

      <HistoryDrawer
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        title={t("translator.historyTitle")}
        loading={historyLoading}
        emptyText={t("translator.noHistory")}
        items={history.map((item): DrawerHistoryItem => ({
          id: item.id,
          title: item.title,
          subtitle: formatDate(item.updated_at),
          updated_at: item.updated_at,
          active: activeHistoryId === item.id,
          icon: "language",
        }))}
        onSelect={(id) => {
          void loadHistoryConversation(id);
          setShowHistory(false);
        }}
        deleteConfirmTitle={t("common.deleteSession")}
        deleteConfirmDescription={(item) => `${t("common.deleteSessionDesc")}\n${item.title}`}
        onDelete={(id) => void deleteHistoryItem(id)}
      />
    </div>
  );
}
