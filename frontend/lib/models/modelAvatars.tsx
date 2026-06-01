import type { ComponentType, SVGProps } from "react";
import type { ChatModel } from "@/lib/chatTypes";

export type ModelAvatarMeta = {
  label: string;
  color: string;
  background: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  fallback: string;
};

type ProviderAvatarConfig = {
  label: string;
  color: string;
  background: string;
  fallback: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
};

function normalize(value?: string) {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function DeepSeekWhaleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" {...props}>
      <path
        d="M7.3 18.7c-.7-2.1-.2-4.9 1.5-7 2-2.6 5.5-4 9.5-3.3 3.2.5 5.5 2 7.1 4.2.5.7 1.3 1 2.1.7l2.8-.9c.6-.2 1.1.5.8 1l-1.4 2.3 1.8 1.9c.4.5.1 1.2-.5 1.2h-2.9c-.5 0-.9.3-1 .8-1 3.8-4.8 6.6-10.2 6.6-4.9 0-8.4-2.8-9.6-7.5Z"
        fill="currentColor"
      />
      <path
        d="M10.7 10.9c1.4-1.3 3.4-2.1 5.6-2.3-1.2 1.4-1.9 2.8-2.2 4.2-.2 1.1-1.1 1.9-2.2 1.9H8.3c.2-1.4 1-2.7 2.4-3.8Z"
        fill="rgba(255,255,255,.35)"
      />
      <path
        d="M17.4 22.5c-4.2 0-7.7-1.7-10.2-4.1.9 4.7 4.5 7.8 9.7 7.8 5.1 0 8.8-2.5 10-6-2.6 1.5-5.8 2.3-9.5 2.3Z"
        fill="rgba(0,0,0,.12)"
      />
      <circle cx="22.3" cy="13.8" r="1.25" fill="white" />
      <circle cx="22.7" cy="13.5" r=".55" fill="currentColor" />
      <path d="M12.2 18.2c1.2 1.2 3 1.9 5.2 1.9 2.1 0 3.9-.7 5.1-1.9" fill="none" stroke="white" strokeWidth="1.4" strokeLinecap="round" opacity=".9" />
      <path d="M5.7 16.1 2.2 14.2c-.5-.3-1.1.2-.9.8l1.1 3.5-2.1 2.7c-.4.5.1 1.2.7 1l4.7-1.4c1.1-.3 1.8-1.4 1.5-2.5-.2-.9-.7-1.7-1.5-2.2Z" fill="currentColor" />
    </svg>
  );
}

function OpenAIKnotIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" {...props}>
      <path d="M16 3.6a5.2 5.2 0 0 1 5 3.7 5.2 5.2 0 0 1 5.1 8.7 5.2 5.2 0 0 1-5 8.7 5.2 5.2 0 0 1-10.2 0 5.2 5.2 0 0 1-5-8.7 5.2 5.2 0 0 1 5-8.7 5.2 5.2 0 0 1 5.1-3.7Zm0 5.2-5.9 3.4v6.8l5.9 3.4 5.9-3.4v-6.8L16 8.8Zm-3.5 8.8v-3.2L16 12.4l3.5 2v3.2l-3.5 2-3.5-2Z" fill="currentColor" />
    </svg>
  );
}

function AnthropicIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" {...props}>
      <path d="M12.4 5.8 3.8 26.2h5.1l1.7-4.4h8.3l1.7 4.4h5.3L17.2 5.8h-4.8Zm-.2 11.7 2.6-6.8 2.6 6.8h-5.2Z" fill="currentColor" />
      <path d="M23.5 5.8h4.7v20.4h-4.7z" fill="currentColor" opacity=".7" />
    </svg>
  );
}

function GeminiIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" {...props}>
      <path d="M16 2.6c1.2 6.9 5.1 11 12.3 13.4C21.1 18.4 17.2 22.5 16 29.4 14.8 22.5 10.9 18.4 3.7 16 10.9 13.6 14.8 9.5 16 2.6Z" fill="currentColor" />
      <path d="M23.6 5.6c.5 2.8 2.1 4.5 4.9 5.4-2.8.9-4.4 2.6-4.9 5.4-.5-2.8-2.1-4.5-4.9-5.4 2.8-.9 4.4-2.6 4.9-5.4Z" fill="white" opacity=".65" />
    </svg>
  );
}

function MoonshotIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" {...props}>
      <path d="M20.5 3.8c-5.8 1-10.2 6-10.2 12.2s4.4 11.2 10.2 12.2A12.4 12.4 0 1 1 20.5 3.8Z" fill="currentColor" />
      <circle cx="19.8" cy="12.2" r="2.1" fill="currentColor" opacity=".55" />
      <circle cx="22.7" cy="19.4" r="1.3" fill="currentColor" opacity=".45" />
    </svg>
  );
}

function QwenIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" {...props}>
      <path d="M16 3.5 27.7 10v12L16 28.5 4.3 22V10L16 3.5Z" fill="currentColor" />
      <path d="M9.5 16c0-3.8 2.7-6.5 6.6-6.5s6.4 2.6 6.4 6.4c0 2.1-.8 3.9-2.2 5l2.1 2.5h-4.1l-.8-1a8.1 8.1 0 0 1-1.5.1c-3.9 0-6.5-2.7-6.5-6.5Zm3.6 0c0 2.1 1.1 3.4 3 3.4l-1.6-1.9h4l.1.1c.2-.5.3-1 .3-1.7 0-2.1-1.1-3.4-2.9-3.4-1.8 0-2.9 1.4-2.9 3.5Z" fill="white" />
    </svg>
  );
}

function LlamaIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" {...props}>
      <path d="M10 26.5V12.8c0-4.1 2.6-7.3 6-7.3s6 3.2 6 7.3v13.7h-4.1v-6h-3.8v6H10Z" fill="currentColor" />
      <path d="M8.7 10.6 5.6 7.3c-.5-.5-1.3-.2-1.3.5v5.5c0 1 .8 1.8 1.8 1.8h2.6v-4.5Zm14.6 0 3.1-3.3c.5-.5 1.3-.2 1.3.5v5.5c0 1-.8 1.8-1.8 1.8h-2.6v-4.5Z" fill="currentColor" opacity=".78" />
      <circle cx="14.2" cy="13.8" r="1" fill="white" />
      <circle cx="17.8" cy="13.8" r="1" fill="white" />
      <path d="M14.4 17.4c.9.7 2.3.7 3.2 0" fill="none" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

const PROVIDER_AVATARS: Record<string, ProviderAvatarConfig> = {
  deepseek: {
    label: "深度求索",
    color: "#4D6BFA",
    background: "rgba(77, 107, 250, 0.12)",
    fallback: "深",
    icon: DeepSeekWhaleIcon,
  },
  openai: {
    label: "OpenAI",
    color: "#10A37F",
    background: "rgba(16, 163, 127, 0.12)",
    fallback: "O",
    icon: OpenAIKnotIcon,
  },
  anthropic: {
    label: "Anthropic",
    color: "#CC785C",
    background: "rgba(204, 120, 92, 0.13)",
    fallback: "A",
    icon: AnthropicIcon,
  },
  google: {
    label: "Google",
    color: "#4285F4",
    background: "rgba(66, 133, 244, 0.12)",
    fallback: "G",
    icon: GeminiIcon,
  },
  gemini: {
    label: "Google",
    color: "#4285F4",
    background: "rgba(66, 133, 244, 0.12)",
    fallback: "G",
    icon: GeminiIcon,
  },
  moonshot: {
    label: "月之暗面",
    color: "#00B96B",
    background: "rgba(0, 185, 107, 0.12)",
    fallback: "月",
    icon: MoonshotIcon,
  },
  kimi: {
    label: "月之暗面",
    color: "#00B96B",
    background: "rgba(0, 185, 107, 0.12)",
    fallback: "K",
    icon: MoonshotIcon,
  },
  qwen: {
    label: "通义千问",
    color: "#615CED",
    background: "rgba(97, 92, 237, 0.12)",
    fallback: "Q",
    icon: QwenIcon,
  },
  alibaba: {
    label: "通义千问",
    color: "#615CED",
    background: "rgba(97, 92, 237, 0.12)",
    fallback: "Q",
    icon: QwenIcon,
  },
  meta: {
    label: "Meta",
    color: "#0866FF",
    background: "rgba(8, 102, 255, 0.12)",
    fallback: "M",
    icon: LlamaIcon,
  },
  llama: {
    label: "Llama",
    color: "#0866FF",
    background: "rgba(8, 102, 255, 0.12)",
    fallback: "L",
    icon: LlamaIcon,
  },
};

export function getModelAvatarMeta(modelOrProvider: Pick<ChatModel, "id" | "name" | "provider" | "color"> | string): ModelAvatarMeta {
  const isString = typeof modelOrProvider === "string";
  const provider = isString ? modelOrProvider : modelOrProvider.provider;
  const providerKey = normalize(provider);
  const modelKey = isString ? "" : normalize(`${modelOrProvider.id} ${modelOrProvider.name}`);

  const matchedKey = Object.keys(PROVIDER_AVATARS).find((key) => providerKey.includes(key) || modelKey.includes(key));
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
