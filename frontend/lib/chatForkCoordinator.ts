export type ForkChatPersistedMessage = {
  id?: number | string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoning_content?: string;
  reasoning?: string;
  thinking?: string;
  model?: string;
  created_at?: string;
  completed_at?: string | null;
  files?: unknown;
  search_sources?: unknown;
  searchSources?: unknown;
  search_sources_count?: number;
  group_id?: number | null;
  group_index?: number | null;
  group_models?: string[] | null;
};

export type ForkChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model?: string;
  createdAt: number;
  completedAt?: number;
  files?: any[];
  searchSources?: any[];
  searchSourcesCount?: number;
  searchStatus?: "completed";
  serverMessageId?: number;
  groupId?: number;
  groupIndex?: number;
  groupModels?: string[];
};

export type ForkChatResponse = {
  conversation_id?: number;
  models?: string[];
  [key: string]: unknown;
};

export type ForkChatRefreshResponse = {
  messages?: ForkChatPersistedMessage[];
};

export function parsePersistedMessageFiles(value: unknown): any[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function parsePersistedMessageSearchSources(raw: Pick<ForkChatPersistedMessage, "search_sources" | "searchSources">): any[] | undefined {
  const value = raw?.search_sources ?? raw?.searchSources;
  if (!value) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function mapPersistedChatMessage(
  message: ForkChatPersistedMessage,
  options: { fallbackId: () => string; parseTime?: (value: string) => number }
): ForkChatMessage {
  const parseTime = options.parseTime || ((value: string) => new Date(value).getTime());
  const numericId = Number(message.id || 0) || undefined;
  const reasoningContent = typeof message.reasoning_content === "string"
    ? message.reasoning_content
    : typeof message.reasoning === "string"
      ? message.reasoning
      : typeof message.thinking === "string"
        ? message.thinking
        : "";
  const content = message.role === "assistant" && reasoningContent.trim() && !/<think>[\s\S]*?<\/think>/i.test(message.content || "")
    ? `<think>${reasoningContent}</think>\n\n${message.content || ""}`.trim()
    : message.content;
  return {
    id: String(message.id || options.fallbackId()),
    role: message.role,
    content,
    model: message.model,
    createdAt: message.created_at ? parseTime(message.created_at) : 0,
    completedAt: message.completed_at ? parseTime(message.completed_at) : undefined,
    files: parsePersistedMessageFiles(message.files),
    searchSources: parsePersistedMessageSearchSources(message),
    searchSourcesCount: typeof message.search_sources_count === "number" ? message.search_sources_count : undefined,
    searchStatus: message.search_sources_count && message.search_sources_count > 0 || message.search_sources ? "completed" : undefined,
    serverMessageId: numericId,
    groupId: message.group_id || undefined,
    groupIndex: message.group_index ?? undefined,
    groupModels: Array.isArray(message.group_models) ? message.group_models : undefined,
  };
}

export function mapPersistedChatMessages(
  messages: ForkChatPersistedMessage[] = [],
  options: { fallbackId: () => string; parseTime?: (value: string) => number }
): ForkChatMessage[] {
  return messages.map((message) => mapPersistedChatMessage(message, options));
}

export function buildGroupViewsFromMessages(messages: Pick<ForkChatMessage, "groupId">[]): Map<number, number> {
  const groupViews = new Map<number, number>();
  messages.forEach((message) => {
    if (message.groupId !== undefined && !groupViews.has(message.groupId)) {
      groupViews.set(message.groupId, 0);
    }
  });
  return groupViews;
}

export function resolveForkedModels(data: ForkChatResponse, requestedModelIds: string[]): string[] {
  return Array.isArray(data.models) ? data.models : requestedModelIds;
}

export function resolveForkConversationId(data: ForkChatResponse, currentConversation?: number): number | undefined {
  return data.conversation_id || currentConversation;
}

export async function runForkChatRequest({
  apiBaseUrl = "",
  messageId,
  modelIds,
  headers,
  fetchImpl = fetch,
}: {
  apiBaseUrl?: string;
  messageId: number;
  modelIds: string[];
  headers: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<ForkChatResponse> {
  const res = await fetchImpl(`${apiBaseUrl}/api/chat/${messageId}/fork`, {
    method: "POST",
    headers,
    body: JSON.stringify({ models: modelIds }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Fork 对比失败");
  }
  return await res.json();
}

export async function fetchForkConversationRefresh({
  apiBaseUrl = "",
  conversationId,
  token,
  fetchImpl = fetch,
}: {
  apiBaseUrl?: string;
  conversationId: number;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<ForkChatRefreshResponse | undefined> {
  const res = await fetchImpl(`${apiBaseUrl}/api/conversations/${conversationId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return undefined;
  return await res.json();
}

export function buildForkRefreshState(
  refreshData: ForkChatRefreshResponse | undefined,
  options: { fallbackId: () => string; parseTime?: (value: string) => number }
): { messages: ForkChatMessage[]; groupViews: Map<number, number> } | undefined {
  if (!refreshData?.messages) return undefined;
  const messages = mapPersistedChatMessages(refreshData.messages, options);
  return {
    messages,
    groupViews: buildGroupViewsFromMessages(messages),
  };
}
