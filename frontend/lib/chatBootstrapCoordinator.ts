import type { ChatModel, Conversation } from "@/lib/chatTypes";
import type { ConversationRestoreStatusResponse } from "@/lib/chatConversationRestoreCoordinator";
import type { ForkChatPersistedMessage } from "@/lib/chatForkCoordinator";

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

export type ChatBootstrapPayload = {
  auth_status: "authenticated" | "anonymous" | "unknown";
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
};

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
  conversationLimit = 30,
  signal,
  fetchImpl = fetch,
}: FetchChatBootstrapInput): Promise<ChatBootstrapPayload> {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetchImpl(buildChatBootstrapUrl({ apiBaseUrl, conversationId, workspaceId, messageTail, conversationLimit }), {
    headers,
    credentials: "include",
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) return { auth_status: "anonymous", ...data } as ChatBootstrapPayload;
  if (!res.ok) {
    const error = new Error(`chat bootstrap failed: ${res.status}`) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return data;
}

export function parseBootstrapCompareModels(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return [];
}
