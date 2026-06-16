"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  ChevronDown,
  Languages,
  Loader2,
  Mic,
  Play,
  Search,
  Square,
  Volume2,
  VolumeX,
  Copy,
  Check,
  RotateCcw,
  ArrowRightLeft,
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { readApiError } from "@/lib/errors";

const TRANSLATION_LLM_SUPPORTED_LANGUAGE_CODES = new Set([
  "af", "sq", "am", "ar-sa", "ar", "hy", "az", "eu", "be",
  "bn-in", "bn", "bs-cyrl", "bs", "bg", "my", "ca",
  "zh-cn", "zh-hk", "zh-hans", "zh-tw", "zh-hant", "zh",
  "hr", "cs", "da", "nl-be", "nl",
  "en-au", "en-ca", "en-nz", "en-ph", "en-za", "en-gb", "en-us", "en",
  "et", "fil", "fi", "fr-ca", "fr-ch", "fr", "fy", "gl", "ka",
  "de", "el", "gn", "gu", "ha", "he", "iw", "hi", "hu", "is",
  "ig", "id", "ga", "it", "ja", "kn", "km", "ko", "ky", "lo",
  "lv", "ln", "lt", "lb", "mk", "ms", "ml", "mt", "mr", "mn",
  "ne", "nb", "no", "or", "fa", "pl", "pt-br", "pt-pt", "pt",
  "pa-pk", "pa", "ro", "ru", "gd", "sr", "sk", "sl", "so",
  "es-ar", "es-cl", "es-co", "es-cr", "es-ec", "es-sv", "es-gt", "es-ht",
  "es-hn", "es-419", "es-mx", "es-ni", "es-pa", "es-py", "es-pe",
  "es-pr", "es-es", "es-us", "es-uy", "es-ve", "es",
  "sw", "sv", "tl", "tg", "ta", "te", "th", "tr", "uk",
  "ur", "uz", "vi", "cy", "zu",
]);

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

const FALLBACK_LANGS: LangOption[] = [
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

function toTranslationLLMLanguageCode(code: string) {
  const lower = code.trim().toLowerCase();
  switch (lower) {
    case "fil":
      return "tl";
    case "zh":
      return "zh-cn";
    default:
      return lower;
  }
}

function isTranslationLLMSupportedLanguage(code: string) {
  return TRANSLATION_LLM_SUPPORTED_LANGUAGE_CODES.has(toTranslationLLMLanguageCode(code));
}

function getFallbackLanguageOptions() {
  return FALLBACK_LANGS.filter((lang) => isTranslationLLMSupportedLanguage(lang.value));
}

function buildLanguageOptions(items: SupportedLanguageAPIItem[]) {
  const seen = new Set<string>();
  const options: LangOption[] = [];
  for (const item of items) {
    const value = toAppLanguageCode(item.language_code || "");
    if (!value || seen.has(value) || !isTranslationLLMSupportedLanguage(value)) continue;
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
  return options.length ? options : getFallbackLanguageOptions();
}

async function createLiveTranslateTicket(targetLanguage: string) {
  const res = await fetch("/api/translate/live/ticket", {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ target_language: toTranslationLLMLanguageCode(targetLanguage) }),
  });
  if (!res.ok) throw await readApiError(res);
  return await res.json() as { ticket: string; expires_in: number; target_language: string };
}

function buildLiveTranslateWebSocketURL(ticket: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({ ticket });
  return `${protocol}//${window.location.host}/api/translate/live/ws?${params.toString()}`;
}

function downsampleToPCM16(input: Float32Array, inputSampleRate: number, outputSampleRate = 16000) {
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = inputSampleRate === outputSampleRate ? input.length : Math.floor(input.length / ratio);
  const buffer = new ArrayBuffer(outputLength * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < outputLength; i += 1) {
    let sample = input[i];
    if (inputSampleRate !== outputSampleRate) {
      const start = Math.floor(i * ratio);
      const end = Math.min(Math.floor((i + 1) * ratio), input.length);
      let sum = 0;
      for (let j = start; j < end; j += 1) sum += input[j];
      sample = sum / Math.max(1, end - start);
    }
    const s = Math.max(-1, Math.min(1, sample));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function pcm16ToFloat32(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const output = new Float32Array(Math.floor(buffer.byteLength / 2));
  for (let i = 0; i < output.length; i += 1) {
    output[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return output;
}

/* ── Waveform visualizer component ── */
function WaveformBars({ level, isActive }: { level: number; isActive: boolean }) {
  const bars = 12;
  return (
    <div className="flex items-end gap-[2px] h-5">
      {Array.from({ length: bars }).map((_, i) => {
        const threshold = (i / bars) * 100;
        const filled = isActive && level > threshold;
        const height = filled ? Math.max(20, ((level - threshold) / (100 - threshold)) * 100) : 8;
        return (
          <div
            key={i}
            className={cn(
              "w-[3px] rounded-full transition-all duration-75",
              filled ? "bg-brand" : "bg-surface-border"
            )}
            style={{ height: `${height}%`, opacity: filled ? 0.6 + (level / 100) * 0.4 : 0.35 }}
          />
        );
      })}
    </div>
  );
}

/* ── Compact status bar ── */
function StatusBar({
  status,
  level,
  isTranslating,
  sentChunks,
  playTranslatedAudio,
  playedChunks,
  t,
}: {
  status: string;
  level: number;
  isTranslating: boolean;
  sentChunks: number;
  playTranslatedAudio: boolean;
  playedChunks: number;
  t: (key: string) => string;
}) {
  const getStatusDot = () => {
    if (!isTranslating) return "bg-text-tertiary";
    if (status === t("translator.live.active")) return "bg-emerald-500 animate-pulse";
    if (status === t("translator.live.connecting") || status === t("translator.live.ready")) return "bg-amber-500";
    return "bg-red-500";
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-surface-border bg-surface px-3 py-2">
      <span className={cn("inline-flex h-2 w-2 rounded-full shrink-0", getStatusDot())} />
      <span className="text-xs text-text-secondary truncate">
        {status || t("translator.live.idle")}
      </span>
      <div className="ml-auto">
        <WaveformBars level={level} isActive={isTranslating && level > 1} />
      </div>
      {isTranslating && (
        <span className="text-[10px] text-text-tertiary tabular-nums shrink-0">
          {sentChunks > 0 ? `${sentChunks}` : "·"}
          {playTranslatedAudio && playedChunks > 0 ? ` / ${playedChunks}` : ""}
        </span>
      )}
    </div>
  );
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
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((opt) => {
        const label = getLanguageLabel(opt, t).toLowerCase();
        const promptLabel = opt.promptLabel.toLowerCase();
        const code = opt.value.toLowerCase();
        return label.includes(normalizedQuery) || promptLabel.includes(normalizedQuery) || code.includes(normalizedQuery);
      })
    : options;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const id = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-surface-border bg-surface px-3 text-sm text-text-primary transition",
          open && "border-brand/50 ring-1 ring-brand/30"
        )}
      >
        <span className="flex-1 truncate text-left">{selected ? getLanguageLabel(selected, t) : value}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-[80] mt-1 w-full overflow-hidden rounded-xl border border-surface-border bg-surface-elevated shadow-xl">
            <div className="border-b border-surface-border p-2">
              <div className="flex h-9 items-center gap-2 rounded-lg border border-surface-border bg-surface px-2.5 text-text-tertiary">
                <Search className="h-3.5 w-3.5 shrink-0" />
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setOpen(false);
                  }}
                  placeholder={t("appearance.language.search")}
                  className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
                />
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto py-1">
              {filteredOptions.length ? (
                filteredOptions.map((opt) => (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => { onChange(opt.value); setOpen(false); }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition",
                      value === opt.value
                        ? "bg-surface-card font-medium text-text-primary"
                        : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{getLanguageLabel(opt, t)}</span>
                    <span className="shrink-0 text-xs uppercase text-text-tertiary">{opt.value}</span>
                  </button>
                ))
              ) : (
                <div className="px-3 py-6 text-center text-sm text-text-tertiary">
                  {t("appearance.language.noResults")}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function LiveTranslatePage() {
  const { t, language } = useI18n();
  const [targetLang, setTargetLang] = useState("en");
  const [languageOptions, setLanguageOptions] = useState<LangOption[]>(getFallbackLanguageOptions());
  const [isLiveTranslating, setIsLiveTranslating] = useState(false);
  const [hasLiveSession, setHasLiveSession] = useState(false);
  const [liveStatus, setLiveStatus] = useState("");
  const [liveInputTranscript, setLiveInputTranscript] = useState("");
  const [liveOutputTranscript, setLiveOutputTranscript] = useState("");
  const [liveMicLevel, setLiveMicLevel] = useState(0);
  const [liveSentChunks, setLiveSentChunks] = useState(0);
  const [livePlayedChunks, setLivePlayedChunks] = useState(0);
  const [playTranslatedAudio, setPlayTranslatedAudio] = useState(false);
  const [copiedOutput, setCopiedOutput] = useState(false);
  const liveSocketRef = useRef<WebSocket | null>(null);
  const liveAudioContextRef = useRef<AudioContext | null>(null);
  const livePlaybackContextRef = useRef<AudioContext | null>(null);
  const livePlaybackTimeRef = useRef(0);
  const livePlayedChunksRef = useRef(0);
  const playTranslatedAudioRef = useRef(false);
  const liveStreamRef = useRef<MediaStream | null>(null);
  const liveProcessorRef = useRef<ScriptProcessorNode | AudioWorkletNode | null>(null);
  const liveSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const liveSentChunksRef = useRef(0);
  const liveMicLevelUpdateRef = useRef(0);
  const inputScrollRef = useRef<HTMLDivElement>(null);
  const outputScrollRef = useRef<HTMLDivElement>(null);

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
      console.warn("load live translator languages failed", err);
      setLanguageOptions(getFallbackLanguageOptions());
    }
  };

  useEffect(() => {
    void loadSupportedLanguages();
  }, [language]);

  useEffect(() => {
    playTranslatedAudioRef.current = playTranslatedAudio;
  }, [playTranslatedAudio]);

  // Auto-scroll transcripts
  useEffect(() => {
    if (inputScrollRef.current) {
      inputScrollRef.current.scrollTop = inputScrollRef.current.scrollHeight;
    }
  }, [liveInputTranscript]);

  useEffect(() => {
    if (outputScrollRef.current) {
      outputScrollRef.current.scrollTop = outputScrollRef.current.scrollHeight;
    }
  }, [liveOutputTranscript]);

  const stopLiveAudioCapture = () => {
    liveProcessorRef.current?.disconnect();
    liveProcessorRef.current = null;
    liveSourceRef.current?.disconnect();
    liveSourceRef.current = null;
    liveStreamRef.current?.getTracks().forEach((track) => track.stop());
    liveStreamRef.current = null;
    void liveAudioContextRef.current?.close().catch(() => {});
    liveAudioContextRef.current = null;
    setLiveMicLevel(0);
    setIsLiveTranslating(false);
  };

  const stopLiveTranslate = () => {
    stopLiveAudioCapture();
    void livePlaybackContextRef.current?.close().catch(() => {});
    livePlaybackContextRef.current = null;
    livePlaybackTimeRef.current = 0;
    liveSocketRef.current?.close();
    liveSocketRef.current = null;
    setHasLiveSession(false);
    setLiveStatus((status) => status === t("translator.live.error.connection") || status === t("translator.live.error.failed") ? status : "");
  };

  useEffect(() => {
    return () => stopLiveTranslate();
  }, []);

  const sendLiveAudioChunk = (pcm: ArrayBuffer) => {
    const socket = liveSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !pcm.byteLength) return;
    socket.send(pcm);
    liveSentChunksRef.current += 1;
    if (liveSentChunksRef.current === 1 || liveSentChunksRef.current % 10 === 0) {
      setLiveSentChunks(liveSentChunksRef.current);
    }
  };

  const playLiveOutputAudio = async (buffer: ArrayBuffer) => {
    if (!buffer.byteLength) return;
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    let playbackContext = livePlaybackContextRef.current;
    if (!playbackContext || playbackContext.state === "closed") {
      playbackContext = new AudioContextCtor({ sampleRate: 24000 });
      livePlaybackContextRef.current = playbackContext;
      livePlaybackTimeRef.current = playbackContext.currentTime;
    }
    if (playbackContext.state === "suspended") {
      await playbackContext.resume();
    }
    const samples = pcm16ToFloat32(buffer);
    const audioBuffer = playbackContext.createBuffer(1, samples.length, 24000);
    audioBuffer.copyToChannel(samples, 0);
    const source = playbackContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(playbackContext.destination);
    const startAt = Math.max(playbackContext.currentTime + 0.02, livePlaybackTimeRef.current);
    source.start(startAt);
    livePlaybackTimeRef.current = startAt + audioBuffer.duration;
    livePlayedChunksRef.current += 1;
    if (livePlayedChunksRef.current === 1 || livePlayedChunksRef.current % 10 === 0) {
      setLivePlayedChunks(livePlayedChunksRef.current);
    }
  };

  const startLiveAudioCapture = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    const audioContext = new AudioContextCtor();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    const source = audioContext.createMediaStreamSource(stream);
    let processor: ScriptProcessorNode | AudioWorkletNode;
    if (audioContext.audioWorklet) {
      try {
        await audioContext.audioWorklet.addModule("/live-translate-worklet.js");
        const worklet = new AudioWorkletNode(audioContext, "live-translate-pcm-processor");
        worklet.port.onmessage = (event) => {
          const message = event.data;
          if (message?.type === "level") {
            const now = performance.now();
            if (now - liveMicLevelUpdateRef.current > 120) {
              liveMicLevelUpdateRef.current = now;
              setLiveMicLevel(message.level || 0);
            }
            return;
          }
          if (message?.type === "audio" && message.buffer instanceof ArrayBuffer) {
            sendLiveAudioChunk(message.buffer);
          }
        };
        source.connect(worklet);
        worklet.connect(audioContext.destination);
        processor = worklet;
      } catch (workletErr) {
        console.warn("live translate AudioWorklet unavailable, falling back to ScriptProcessor", workletErr);
        const fallback = audioContext.createScriptProcessor(4096, 1, 1);
        fallback.onaudioprocess = (event) => {
          const input = event.inputBuffer.getChannelData(0);
          let sumSquares = 0;
          for (let i = 0; i < input.length; i += 1) sumSquares += input[i] * input[i];
          const rms = Math.sqrt(sumSquares / Math.max(1, input.length));
          const now = performance.now();
          if (now - liveMicLevelUpdateRef.current > 120) {
            liveMicLevelUpdateRef.current = now;
            setLiveMicLevel(Math.min(100, Math.round(rms * 260)));
          }
          sendLiveAudioChunk(downsampleToPCM16(input, audioContext.sampleRate));
        };
        source.connect(fallback);
        fallback.connect(audioContext.destination);
        processor = fallback;
      }
    } else {
      const fallback = audioContext.createScriptProcessor(4096, 1, 1);
      fallback.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        let sumSquares = 0;
        for (let i = 0; i < input.length; i += 1) sumSquares += input[i] * input[i];
        const rms = Math.sqrt(sumSquares / Math.max(1, input.length));
        const now = performance.now();
        if (now - liveMicLevelUpdateRef.current > 120) {
          liveMicLevelUpdateRef.current = now;
          setLiveMicLevel(Math.min(100, Math.round(rms * 260)));
        }
        sendLiveAudioChunk(downsampleToPCM16(input, audioContext.sampleRate));
      };
      source.connect(fallback);
      fallback.connect(audioContext.destination);
      processor = fallback;
    }

    liveStreamRef.current = stream;
    liveAudioContextRef.current = audioContext;
    liveSourceRef.current = source;
    liveProcessorRef.current = processor;
    setIsLiveTranslating(true);
  };

  const startLiveTranslate = async () => {
    if (isLiveTranslating || hasLiveSession) {
      stopLiveTranslate();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error(t("translator.live.error.unsupported"));
      return;
    }
    if (!localStorage.getItem("token")) {
      toast.error(t("translator.live.error.login"));
      return;
    }
    setLiveInputTranscript("");
    setLiveOutputTranscript("");
    liveSentChunksRef.current = 0;
    livePlayedChunksRef.current = 0;
    livePlaybackTimeRef.current = 0;
    setLiveSentChunks(0);
    setLivePlayedChunks(0);
    setLiveMicLevel(0);
    setLiveStatus(t("translator.live.connecting"));
    try {
      const liveTicket = await createLiveTranslateTicket(targetLang);
      const ws = new WebSocket(buildLiveTranslateWebSocketURL(liveTicket.ticket));
      ws.binaryType = "arraybuffer";
      liveSocketRef.current = ws;

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          if (playTranslatedAudioRef.current) {
            void playLiveOutputAudio(event.data).catch((err) => console.warn("play live translate audio failed", err));
          }
          return;
        }
        if (event.data instanceof Blob) {
          if (playTranslatedAudioRef.current) {
            void event.data.arrayBuffer().then((buffer) => playLiveOutputAudio(buffer)).catch((err) => console.warn("play live translate audio failed", err));
          }
          return;
        }
        if (typeof event.data !== "string") return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "ready") {
            setLiveStatus(t("translator.live.ready"));
            return;
          }
          if (message.type === "paused") {
            setLiveStatus(t("translator.live.paused"));
            return;
          }
          if (message.type === "resumed") {
            setLiveStatus(t("translator.live.active"));
            return;
          }
          if (message.type === "error") {
            setLiveStatus(message.message || message.error || t("translator.live.error.failed"));
            return;
          }
          if (message.type === "setup_complete") {
            setLiveStatus(t("translator.live.active"));
            return;
          }
          if (message.type === "input_transcript" && message.text) {
            setLiveInputTranscript((prev) => `${prev}${message.text}`);
            return;
          }
          if (message.type === "output_transcript" && message.text) {
            setLiveOutputTranscript((prev) => `${prev}${message.text}`);
            return;
          }
          const content = message.serverContent;
          if (content?.inputTranscription?.text) {
            setLiveInputTranscript((prev) => `${prev}${content.inputTranscription.text}`);
          }
          if (content?.outputTranscription?.text) {
            setLiveOutputTranscript((prev) => `${prev}${content.outputTranscription.text}`);
          }
        } catch (err) {
          console.warn("parse live translate message failed", err);
        }
      };
      ws.onerror = () => setLiveStatus(t("translator.live.error.connection"));
      ws.onclose = (event) => {
        stopLiveAudioCapture();
        setHasLiveSession(false);
        if (liveSentChunksRef.current === 0) {
          setLiveStatus(event.reason || t("translator.live.error.closedBeforeAudio"));
        } else {
          setLiveStatus("");
        }
      };

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("websocket_open_failed"));
      });

      await startLiveAudioCapture();
      setHasLiveSession(true);
      setLiveStatus(t("translator.live.active"));
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : t("translator.live.error.start");
      stopLiveTranslate();
      console.error("start live translate failed", err);
      setLiveStatus(message);
      toast.error(message);
    }
  };

  const clearTranscripts = () => {
    setLiveInputTranscript("");
    setLiveOutputTranscript("");
  };

  const copyOutput = useCallback(async () => {
    if (!liveOutputTranscript) return;
    try {
      await navigator.clipboard.writeText(liveOutputTranscript);
      setCopiedOutput(true);
      setTimeout(() => setCopiedOutput(false), 2000);
      toast.success(t("sidebar.menu.copied"));
    } catch {
      toast.error(t("common.error"));
    }
  }, [liveOutputTranscript, t]);

  return (
    <div className="flex h-full flex-col bg-surface-elevated text-text-primary">
      {/* Header */}
      <header className="shrink-0 border-b border-surface-border bg-surface-elevated px-6 py-4 md:px-10">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors",
              isLiveTranslating ? "bg-brand/15 text-brand" : "bg-brand/10 text-brand"
            )}>
              <Mic className={cn("h-5 w-5", isLiveTranslating && "animate-pulse")} />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t("translator.live.title")}</h1>
              <p className="mt-0.5 text-sm text-text-secondary">{t("translator.live.subtitle")}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={clearTranscripts}
              disabled={isLiveTranslating || (!liveInputTranscript && !liveOutputTranscript)}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-3 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-card hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              {t("translator.live.clear")}
            </button>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 overflow-auto px-6 py-6 md:px-10 md:py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
          {/* Control panel */}
          <section className="rounded-2xl border border-surface-border bg-surface-card p-5 shadow-sm">
            <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-end">
              <div>
                <div className="mb-2 text-sm font-medium text-text-secondary">{t("translator.live.targetLanguage")}</div>
                <LangDropdown value={targetLang} options={targetLanguageOptions} onChange={setTargetLang} t={t} />
              </div>
              <div className="flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => {
                    if (!isLiveTranslating) {
                      const current = targetLang;
                      setTargetLang("zh");
                      setTimeout(() => setTargetLang(current), 0);
                    }
                  }}
                  disabled={isLiveTranslating}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-surface-border bg-surface text-text-tertiary transition hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-50"
                  title={t("translator.live.targetLanguage")}
                >
                  <ArrowRightLeft className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPlayTranslatedAudio((value) => !value)}
                  className={cn(
                    "inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-surface-border bg-surface px-4 text-sm font-medium text-text-secondary transition hover:text-text-primary",
                    playTranslatedAudio && "border-brand/40 bg-brand/10 text-brand"
                  )}
                  aria-pressed={playTranslatedAudio}
                >
                  {playTranslatedAudio ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                  {playTranslatedAudio ? t("translator.live.audioOn") : t("translator.live.audioOff")}
                </button>
                <button
                  onClick={startLiveTranslate}
                  className={cn(
                    "inline-flex h-11 min-w-36 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
                    isLiveTranslating
                      ? "bg-red-500 text-white hover:bg-red-500/90"
                      : "bg-brand text-white hover:bg-brand/90"
                  )}
                >
                  {isLiveTranslating ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  {isLiveTranslating ? t("translator.live.stop") : t("translator.live.start")}
                </button>
              </div>
            </div>

            {/* Status bar + waveform */}
            <div className="mt-4">
              <StatusBar
                status={liveStatus}
                level={liveMicLevel}
                isTranslating={isLiveTranslating}
                sentChunks={liveSentChunks}
                playTranslatedAudio={playTranslatedAudio}
                playedChunks={livePlayedChunks}
                t={t}
              />
            </div>
            <div className="mt-2 text-xs text-text-tertiary">
              {t("translator.live.hint")}
            </div>
          </section>

          {/* Transcript panels */}
          <section className="grid min-h-[460px] flex-1 gap-5 md:grid-cols-2">
            {/* Input */}
            <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface-card shadow-sm">
              <div className="flex h-12 items-center justify-between border-b border-surface-border px-5">
                <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  <Languages className="h-4 w-4 text-text-tertiary" />
                  {t("translator.live.inputTranscript")}
                </div>
                <span className="text-[10px] text-text-tertiary">{t("translator.lang.auto")}</span>
              </div>
              <div ref={inputScrollRef} className="min-h-0 flex-1 overflow-auto p-5">
                {liveInputTranscript ? (
                  <div data-i18n-skip="true" className="whitespace-pre-wrap rounded-xl bg-surface-elevated p-4 text-base leading-7 text-text-primary">
                    {liveInputTranscript}
                    {isLiveTranslating && <span className="inline-block h-4 w-0.5 bg-brand animate-pulse ml-0.5 align-middle" />}
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center rounded-xl bg-surface text-center text-text-secondary">
                    <Mic className="mb-3 h-10 w-10 text-text-tertiary" />
                    <div className="text-sm">{t("translator.live.emptyInput")}</div>
                    {!isLiveTranslating && (
                      <button
                        onClick={startLiveTranslate}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition hover:bg-brand/15"
                      >
                        <Play className="h-3 w-3" />
                        {t("translator.live.start")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Output */}
            <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface-card shadow-sm">
              <div className="flex h-12 items-center justify-between border-b border-surface-border px-5">
                <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  <Languages className="h-4 w-4 text-brand" />
                  {t("translator.live.outputTranscript")}
                </div>
                <div className="flex items-center gap-1">
                  {liveOutputTranscript && (
                    <button
                      onClick={copyOutput}
                      className="inline-flex h-7 items-center gap-1 rounded-lg border border-surface-border bg-surface px-2 text-xs text-text-secondary transition hover:text-text-primary"
                    >
                      {copiedOutput ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                      {copiedOutput ? t("sidebar.menu.copied") : t("common.copy")}
                    </button>
                  )}
                </div>
              </div>
              <div ref={outputScrollRef} className="min-h-0 flex-1 overflow-auto p-5">
                {liveOutputTranscript ? (
                  <div data-i18n-skip="true" className="whitespace-pre-wrap rounded-xl bg-surface-elevated p-4 text-base leading-7 text-text-primary">
                    {liveOutputTranscript}
                    {isLiveTranslating && <span className="inline-block h-4 w-0.5 bg-brand animate-pulse ml-0.5 align-middle" />}
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center rounded-xl bg-surface text-center text-text-secondary">
                    <Languages className="mb-3 h-10 w-10 text-text-tertiary" />
                    <div className="text-sm">{t("translator.live.emptyOutput")}</div>
                    {!isLiveTranslating && (
                      <button
                        onClick={startLiveTranslate}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition hover:bg-brand/15"
                      >
                        <Play className="h-3 w-3" />
                        {t("translator.live.start")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
