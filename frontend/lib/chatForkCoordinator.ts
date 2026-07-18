import { normalizeError, readApiError } from "@/lib/errors";
import type { RuntimePhase } from "@/lib/streaming";
import type { ChatStatusTimelineStep } from "@/lib/chatStatusTimeline";
import type { UserSendStatus } from "@/lib/chatTypes";

function getClientTimezone(): string | undefined {
  if (typeof Intl === "undefined") return undefined;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export type ForkChatPersistedMessage = {
  id?: number | string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoning_content?: string;
  reasoning?: string;
  thinking?: string;
  model?: string;
  tokens_used?: number;
  created_at?: string;
  completed_at?: string | null;
  files?: unknown;
  search_sources?: unknown;
  searchSources?: unknown;
  search_sources_count?: number;
  group_id?: number | null;
  group_index?: number | null;
  group_models?: string[] | null;
  user_message_id?: number | string | null;
  generation_task_id?: number | string | null;
  last_sequence_number?: number | string | null;
  server_generation_status?: string | null;
  generation_status?: string | null;
  phase?: string | null;
  status_timeline?: unknown;
  statusTimeline?: unknown;
  // 前端本地发送身份
  client_message_id?: string | null;
  local_run_id?: string | null;
  send_status?: string | null;
  stopped?: boolean | null;
};

export type ForkChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoningContent?: string;
  model?: string;
  tokensUsed?: number;
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
  userMessageId?: number;
  generationTaskId?: number;
  lastSequence?: number;
  serverGenerationStatus?: string;
  phase?: RuntimePhase;
  statusTimeline?: ChatStatusTimelineStep[];
  // 前端本地发送身份
  clientMessageId?: string;
  localRunId?: string;
  sendStatus?: UserSendStatus;
  stopped?: boolean;
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

export function parsePersistedStatusTimeline(raw: Pick<ForkChatPersistedMessage, "status_timeline" | "statusTimeline">): ChatStatusTimelineStep[] | undefined {
  const value = raw?.status_timeline ?? raw?.statusTimeline;
  if (!value) return undefined;
  const parsed = Array.isArray(value) ? value : typeof value === "string" ? (() => {
    try { return JSON.parse(value); } catch { return undefined; }
  })() : undefined;
  if (!Array.isArray(parsed)) return undefined;
  const steps = parsed.filter((step): step is ChatStatusTimelineStep => !!step && typeof step === "object" && typeof step.kind === "string" && typeof step.status === "string" && typeof step.startedAt === "number");
  return steps.length ? steps : undefined;
}

function isPersistedGenerationCancelledNotice(content?: string | null): boolean {
  const text = (content || "").trim().toLowerCase();
  return text === "生成失败: generation cancelled" || text === "generation cancelled" || text.includes("generation cancelled");
}

function normalizePersistedPhase(phase?: string | null): RuntimePhase | undefined {
  if (!phase) return undefined;
  if (phase === "queued") return "starting";
  if (phase === "streaming") return "streaming_answer";
  if (phase === "cancelled") return "stopped";
  if (
    phase === "idle" || phase === "starting" || phase === "waiting_provider" || phase === "thinking" ||
    phase === "reasoning" || phase === "searching" || phase === "retrieving_files" || phase === "generating" ||
    phase === "streaming_answer" || phase === "finalizing" || phase === "completed" || phase === "stopped" ||
    phase === "failed"
  ) return phase;
  return undefined;
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
  const isCancelledNotice = message.role === "assistant" && isPersistedGenerationCancelledNotice(message.content);
  const content = isCancelledNotice
    ? ""
    : message.role === "assistant" && reasoningContent.trim() && !/<think>[\s\S]*?<\/think>/i.test(message.content || "")
      ? `<think>${reasoningContent}</think>\n\n${message.content || ""}`.trim()
      : message.content;
  return {
    id: String(message.id || options.fallbackId()),
    role: message.role,
    content,
    reasoningContent: reasoningContent || undefined,
    model: message.model,
    tokensUsed: typeof message.tokens_used === "number" ? message.tokens_used : undefined,
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
    userMessageId: Number(message.user_message_id || 0) || undefined,
    generationTaskId: Number(message.generation_task_id || 0) || undefined,
    lastSequence: Number(message.last_sequence_number || 0) || undefined,
    serverGenerationStatus: message.server_generation_status || message.generation_status || undefined,
    phase: normalizePersistedPhase(message.phase),
    statusTimeline: parsePersistedStatusTimeline(message),
    // 前端本地发送身份
    clientMessageId: message.client_message_id || undefined,
    localRunId: message.local_run_id || undefined,
    sendStatus: (message.send_status as UserSendStatus) || undefined,
    // stopped 是长期持久化字段；phase/generation_status 兼容旧数据与旧后端进程刷新。
    stopped: Boolean(message.stopped || message.phase === "stopped" || message.phase === "cancelled" || message.generation_status === "cancelled" || isCancelledNotice) || undefined,
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
  initOnly = false,
  fetchImpl = fetch,
}: {
  apiBaseUrl?: string;
  messageId: number;
  modelIds: string[];
  headers: Record<string, string>;
  initOnly?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<ForkChatResponse> {
  const res = await fetchImpl(`${apiBaseUrl}/api/chat/${messageId}/fork`, {
    method: "POST",
    headers,
    body: JSON.stringify({ models: modelIds, init_only: initOnly, client_timezone: getClientTimezone() }),
  });
  if (!res.ok) {
    throw normalizeError(await readApiError(res), { module: "chat", fallbackMessage: "Fork 对比失败，请稍后重试。" });
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
  const headers = { Authorization: `Bearer ${token}` };
  const isBrowserSameOriginApi = typeof window !== "undefined"
    && fetchImpl === fetch
    && (!apiBaseUrl || apiBaseUrl.replace(/\/+$/, "") === window.location.origin);
  const res = isBrowserSameOriginApi
    ? await import("@/lib/api/client").then(({ apiFetch }) => apiFetch(`/conversations/${conversationId}`, { headers }))
    : await fetchImpl(`${apiBaseUrl}/api/conversations/${conversationId}`, { headers, credentials: "include" });
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
