import type { ComponentType, SVGProps } from "react";
import type { ChatModel } from "@/lib/chatTypes";

export type ModelAvatarMeta = {
  label: string;
  labelEn?: string;
  color: string;
  background: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  iconSrc?: string;
  fallback: string;
};

type ProviderAvatarConfig = {
  label: string;
  labelEn?: string;
  color: string;
  background: string;
  fallback: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  iconSrc?: string;
};

function normalize(value?: string) {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const ICON_BASE = "/model-icons";

const PROVIDER_AVATARS: Record<string, ProviderAvatarConfig> = {
  deepseek: {
    label: "深度求索",
    labelEn: "DeepSeek",
    color: "#4D6BFA",
    background: "rgba(77, 107, 250, 0.12)",
    fallback: "深",
    iconSrc: `${ICON_BASE}/deepseek.svg`,
  },
  openai: {
    label: "OpenAI",
    color: "#111827",
    background: "rgba(17, 24, 39, 0.10)",
    fallback: "O",
    iconSrc: `${ICON_BASE}/openai.svg`,
  },
  anthropic: {
    label: "Anthropic",
    color: "#CC785C",
    background: "rgba(204, 120, 92, 0.13)",
    fallback: "A",
    iconSrc: `${ICON_BASE}/anthropic.svg`,
  },
  google: {
    label: "Google Gemini",
    labelEn: "Gemini",
    color: "#8E75B7",
    background: "rgba(142, 117, 183, 0.14)",
    fallback: "G",
    iconSrc: `${ICON_BASE}/googlegemini.svg`,
  },
  gemini: {
    label: "Google Gemini",
    labelEn: "Gemini",
    color: "#8E75B7",
    background: "rgba(142, 117, 183, 0.14)",
    fallback: "G",
    iconSrc: `${ICON_BASE}/googlegemini.svg`,
  },
  moonshot: {
    label: "月之暗面",
    labelEn: "Moonshot AI",
    color: "#111827",
    background: "rgba(17, 24, 39, 0.10)",
    fallback: "月",
    iconSrc: `${ICON_BASE}/moonshotai.svg`,
  },
  kimi: {
    label: "Kimi",
    labelEn: "Kimi",
    color: "#111827",
    background: "rgba(17, 24, 39, 0.10)",
    fallback: "K",
    iconSrc: `${ICON_BASE}/kimi.ico`,
  },
  qwen: {
    label: "通义千问",
    labelEn: "Qwen",
    color: "#615CED",
    background: "rgba(97, 92, 237, 0.12)",
    fallback: "Q",
    iconSrc: `${ICON_BASE}/alibabadotcom.svg`,
  },
  alibaba: {
    label: "通义千问",
    labelEn: "Qwen",
    color: "#615CED",
    background: "rgba(97, 92, 237, 0.12)",
    fallback: "Q",
    iconSrc: `${ICON_BASE}/alibabadotcom.svg`,
  },
  meta: {
    label: "Meta",
    color: "#0866FF",
    background: "rgba(8, 102, 255, 0.12)",
    fallback: "M",
    iconSrc: `${ICON_BASE}/meta.svg`,
  },
  llama: {
    label: "Llama",
    color: "#111827",
    background: "rgba(17, 24, 39, 0.10)",
    fallback: "L",
    iconSrc: `${ICON_BASE}/ollama.svg`,
  },
  volcengine: {
    label: "火山引擎",
    labelEn: "Volcengine",
    color: "#1664FF",
    background: "rgba(22, 100, 255, 0.12)",
    fallback: "火",
    iconSrc: `${ICON_BASE}/volcengine.png`,
  },
  seedance: {
    label: "Seedance",
    color: "#1664FF",
    background: "rgba(22, 100, 255, 0.12)",
    fallback: "S",
    iconSrc: `${ICON_BASE}/volcengine.png`,
  },
  doubao: {
    label: "豆包",
    labelEn: "Doubao",
    color: "#111827",
    background: "rgba(17, 24, 39, 0.10)",
    fallback: "豆",
    iconSrc: `${ICON_BASE}/bytedance.svg`,
  },
};

export function getModelAvatarMeta(modelOrProvider: Pick<ChatModel, "id" | "name" | "provider" | "color"> | string): ModelAvatarMeta {
  const isString = typeof modelOrProvider === "string";
  const provider = isString ? modelOrProvider : modelOrProvider.provider;
  const providerKey = normalize(provider);
  const modelKey = isString ? "" : normalize(`${modelOrProvider.id} ${modelOrProvider.name}`);

  const modelMatchedKey = !isString
    ? Object.keys(PROVIDER_AVATARS).find((key) => modelKey.includes(key))
    : undefined;
  const providerMatchedKey = Object.keys(PROVIDER_AVATARS).find((key) => providerKey.includes(key));
  const matchedKey = modelMatchedKey || providerMatchedKey;
  const matched = matchedKey ? PROVIDER_AVATARS[matchedKey] : undefined;
  if (matched) return matched;

  const fallback = provider.trim().slice(0, 1).toUpperCase() || "AI";
  const color = isString ? "#64748B" : modelOrProvider.color || "#64748B";
  return {
    label: provider,
    color,
    background: `${color}18`,
    fallback,
  };
}
