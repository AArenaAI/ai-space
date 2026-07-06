import type { ChatModel, Conversation } from "@/lib/chatTypes";
import type { ConversationRestoreStatusResponse } from "@/lib/chatConversationRestoreCoordinator";
import type { ForkChatPersistedMessage } from "@/lib/chatForkCoordinator";
import { apiFetch } from "@/lib/api/client";

export type ChatBootstrapWorkspace = {
  current_id?: number;
  default_id?: number;
  items?: Array<{ id: number; name: string; icon?: string; color?: string; is_default?: boolean }>;
};

export type ChatBootstrapConversation = {
  id: number;
  title: string;
  model?: string;
  skill_key?: string;
  workspace_id?: number;
  compare: boolean;
  compare_models?: string[];
  pinned?: boolean;
  created_at: string;
  updated_at: string;
};

export type ChatBootstrapSnapshot = {
  messages: ForkChatPersistedMessage[];
  total: number;
  has_more?: boolean;
  snapshot_version?: string;
  last_assistant_status?: ConversationRestoreStatusResponse;
};

export type ChatBootstrapNotebookListItem = {
  id?: number;
  title?: string;
  description?: string;
  cover_icon?: string;
  workspace_id?: number;
  file_count?: number;
  updated_at?: string;
};

export type ChatBootstrapSidebar = {
  conversations?: Conversation[];
  pinned?: Conversation[];
  recent_notebooks?: ChatBootstrapNotebookListItem[];
  total?: number;
};

export type ChatBootstrapBilling = {
  tier?: string;
  beta_credits?: number;
  basic_credits?: number;
  advanced_credits?: number;
  elite_credits?: number;
};

export type ChatBootstrapMediaTask = {
  id: number;
  kind: "standalone" | "chat" | string;
  status: string;
  prompt?: string;
  model?: string;
  provider?: string;
  chat_id?: number;
  message_id?: number;
  generation_id?: number;
  task_id?: string;
  href: string;
  conversation_title?: string;
  updated_at: string;
};

export type ChatBootstrapPayload = {
  auth_status: "authenticated" | "anonymous" | "unknown";
  http_status?: number;
  requested_conversation_id?: number;
  server_time?: string;
  user?: Record<string, any>;
  workspace?: ChatBootstrapWorkspace;
  models?: ChatModel[];
  billing?: ChatBootstrapBilling;
  conversation?: ChatBootstrapConversation;
  snapshot?: ChatBootstrapSnapshot;
  sidebar?: ChatBootstrapSidebar;
  feature_flags?: Record<string, boolean>;
  token?: string;
  active_tasks?: {
    chat?: Array<{
      id: number;
      conversation_id: number;
      assistant_message_id: number;
      model?: string;
      provider?: string;
      status: string;
      last_sequence_number: number;
      updated_at: string;
    }>;
    image?: ChatBootstrapMediaTask[];
    video?: ChatBootstrapMediaTask[];
  };
};

export type FetchChatBootstrapInput = {
  apiBaseUrl?: string;
  conversationId?: number;
  workspaceId?: number;
  token?: string;
  messageTail?: number;
  conversationLimit?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  retry429?: boolean;
  max429Retries?: number;
};

const bootstrapInFlight = new Map<string, Promise<ChatBootstrapPayload>>();

export function defaultBootstrapSleep(ms: number) {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms));
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.max(seconds * 1000, 250), 5000);
  const at = Date.parse(value);
  if (Number.isFinite(at)) return Math.min(Math.max(at - Date.now(), 250), 5000);
  return undefined;
}

function buildBootstrapInFlightKey(input: { url: string; token?: string }) {
  return `${input.token || "guest"} ${input.url}`;
}

export function buildChatBootstrapUrl(input: Pick<FetchChatBootstrapInput, "apiBaseUrl" | "conversationId" | "workspaceId" | "messageTail" | "conversationLimit">): string {
  const params = new URLSearchParams();
  if (input.conversationId) params.set("id", String(input.conversationId));
  if (input.workspaceId) params.set("workspace_id", String(input.workspaceId));
  if (input.messageTail) params.set("message_tail", String(input.messageTail));
  if (input.conversationLimit) params.set("conversation_limit", String(input.conversationLimit));
  const query = params.toString();
  return `${input.apiBaseUrl || ""}/api/chat/bootstrap${query ? `?${query}` : ""}`;
}

export async function fetchChatBootstrap({
  apiBaseUrl = "",
  conversationId,
  workspaceId,
  token,
  messageTail = 32,
  conversationLimit = 500,
  signal,
  fetchImpl = fetch,
  sleep = defaultBootstrapSleep,
  retry429 = true,
  max429Retries = 2,
}: FetchChatBootstrapInput): Promise<ChatBootstrapPayload> {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const url = buildChatBootstrapUrl({ apiBaseUrl, conversationId, workspaceId, messageTail, conversationLimit });
  const key = buildBootstrapInFlightKey({ url, token });
  if (!signal) {
    const existing = bootstrapInFlight.get(key);
    if (existing) return existing;
  }

  const task = (async () => {
    let attempt = 0;
    for (;;) {
      const isBrowserSameOriginApi = typeof window !== "undefined"
        && fetchImpl === fetch
        && (!apiBaseUrl || apiBaseUrl.replace(/\/+$/, "") === window.location.origin);
      const requestInit: RequestInit = {
        headers,
        credentials: "include",
        signal,
      };
      const res = isBrowserSameOriginApi
        ? await apiFetch(`/chat/bootstrap${url.includes("?") ? `?${url.split("?")[1]}` : ""}`, requestInit)
        : await fetchImpl(url, requestInit);
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return { auth_status: "anonymous", ...data } as ChatBootstrapPayload;
      if (res.status === 429 && retry429 && attempt < max429Retries && !signal?.aborted) {
        attempt += 1;
        const retryAfterMs = parseRetryAfterMs(res.headers?.get?.("Retry-After") || null);
        const backoffMs = retryAfterMs ?? Math.min(250 * 2 ** (attempt - 1), 1000);
        await sleep(backoffMs);
        continue;
      }
      if (!res.ok) {
        const error = new Error(`chat bootstrap failed: ${res.status}`) as Error & { status?: number; retryAfterMs?: number };
        error.status = res.status;
        error.retryAfterMs = parseRetryAfterMs(res.headers?.get?.("Retry-After") || null);
        throw error;
      }
      return data;
    }
  })();

  if (!signal) {
    bootstrapInFlight.set(key, task);
    task.finally(() => bootstrapInFlight.delete(key));
  }
  return task;
}

export function parseBootstrapCompareModels(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return [];
}
