export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: "openai" | "anthropic" | "google" | "deepseek" | "moonshot";
  apiModelId: string;
  supportsVision?: boolean;
  supportsFunctionCalling?: boolean;
  contextWindow?: number;
}

export const SUPPORTED_MODELS: ModelConfig[] = [
  {
    id: "gpt-4o-mini",
    name: "GPT-4o mini",
    provider: "openai",
    apiModelId: "gpt-4o-mini",
    contextWindow: 128000,
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    apiModelId: "gpt-4o",
    supportsVision: true,
    contextWindow: 128000,
  },
  {
    id: "claude-3-5-sonnet-20241022",
    name: "Claude 3.5 Sonnet",
    provider: "anthropic",
    apiModelId: "claude-3-5-sonnet-20241022",
    supportsVision: true,
    contextWindow: 200000,
  },
  {
    id: "gemini-2.0-flash-exp",
    name: "Gemini 2.0 Flash",
    provider: "google",
    apiModelId: "gemini-2.0-flash-exp",
    supportsVision: true,
    contextWindow: 1000000,
  },
  {
    id: "deepseek-chat",
    name: "DeepSeek-V3",
    provider: "deepseek",
    apiModelId: "deepseek-chat",
    contextWindow: 64000,
  },
  {
    id: "moonshot-v1-8k",
    name: "Kimi k1.5",
    provider: "moonshot",
    apiModelId: "moonshot-v1-8k",
    contextWindow: 200000,
  },
];

export function getModelConfig(modelId: string): ModelConfig | undefined {
  return SUPPORTED_MODELS.find((m) => m.id === modelId);
}
