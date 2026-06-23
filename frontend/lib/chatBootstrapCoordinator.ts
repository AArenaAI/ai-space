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

export type ChatBootstrapSidebar = {
  conversations?: Conversation[];
  total?: number;
};

export type ChatBootstrapPayload = {
  auth_status: "authenticated" | "anonymous" | "unknown";
  server_time?: string;
  user?: Record<string, any>;
  workspace?: ChatBootstrapWorkspace;
  models?: ChatModel[];
  conversation?: ChatBootstrapConversation;
  snapshot?: ChatBootstrapSnapshot;
  sidebar?: ChatBootstrapSidebar;
  feature_flags?: Record<string, boolean>;
};

export type FetchChatBootstrapInput = {
  conversationId?: number;
  workspaceId?: number;
  token: string;
  messageTail?: number;
  conversationLimit?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export function buildChatBootstrapUrl(input: Pick<FetchChatBootstrapInput, "conversationId" | "workspaceId" | "messageTail" | "conversationLimit">): string {
  const params = new URLSearchParams();
  if (input.conversationId) params.set("id", String(input.conversationId));
  if (input.workspaceId) params.set("workspace_id", String(input.workspaceId));
  if (input.messageTail) params.set("message_tail", String(input.messageTail));
  if (input.conversationLimit) params.set("conversation_limit", String(input.conversationLimit));
  const query = params.toString();
  return `/api/chat/bootstrap${query ? `?${query}` : ""}`;
}

export async function fetchChatBootstrap({
  conversationId,
  workspaceId,
  token,
  messageTail = 32,
  conversationLimit = 30,
  signal,
  fetchImpl = fetch,
}: FetchChatBootstrapInput): Promise<ChatBootstrapPayload> {
  const res = await fetchImpl(buildChatBootstrapUrl({ conversationId, workspaceId, messageTail, conversationLimit }), {
    headers: { Authorization: `Bearer ${token}` },
    credentials: "include",
    signal,
  });
  if (!res.ok) throw new Error(`chat bootstrap failed: ${res.status}`);
  return await res.json();
}

export function parseBootstrapCompareModels(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return [];
}
