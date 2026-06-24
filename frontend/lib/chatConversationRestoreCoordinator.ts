import {
  buildGroupViewsFromMessages,
  ForkChatMessage,
  ForkChatPersistedMessage,
  mapPersistedChatMessages,
} from "./chatForkCoordinator";
import { buildChatBootstrapUrl, type ChatBootstrapPayload } from "@/lib/chatBootstrapCoordinator";

export type ConversationRestoreResponse = {
  notModified?: boolean;
  snapshot_version?: string;
  title?: string;
  model?: string;
  compare?: boolean;
  compare_models?: string;
  skill_key?: string;
  messages?: ForkChatPersistedMessage[];
  total?: number;
  has_more?: boolean;
  last_assistant_status?: ConversationRestoreStatusResponse;
};

export type ActiveConversationTaskStreamInfo = {
  convId?: number;
  serverMessageId?: number;
  generationTaskId?: number;
  lastSequence?: number;
  content?: string;
};

export type ConversationRestoreMessage = ForkChatMessage & {
  generationTaskId?: number;
  lastSequence?: number;
  activityStatus?: unknown;
};

export type ConversationRestoreStatusResponse = {
  message?: { content?: string };
  background_task?: {
    id?: number | string;
    task_id?: number | string;
    status?: string;
    last_sequence_number?: number | string;
    completed_at?: string | null;
  };
};

export type ConversationRestoreStatusDecision = {
  hasTask: boolean;
  status: string;
  terminalStatus: boolean;
  serverContent: string;
  hasContent: boolean;
  shouldResumePolling: boolean;
  generationTaskId?: number;
  lastSequence: number;
  patch: Partial<ConversationRestoreMessage>;
  resume?: {
    generationTaskId?: number;
    lastSequence: number;
    initialContent: string;
  };
};

export const DEFAULT_CONVERSATION_RESTORE_TAIL = 32;

export function buildConversationRestoreUrl({
  apiBaseUrl = "",
  conversationId,
  tail = DEFAULT_CONVERSATION_RESTORE_TAIL,
}: {
  apiBaseUrl?: string;
  conversationId: number;
  tail?: number;
}): string {
  return `${apiBaseUrl}/api/conversations/${conversationId}?message_tail=${tail}`;
}

export function buildConversationMessageStatusUrl({
  apiBaseUrl = "",
  conversationId,
  serverMessageId,
}: {
  apiBaseUrl?: string;
  conversationId: number;
  serverMessageId: number;
}): string {
  return `${apiBaseUrl}/api/conversations/${conversationId}/messages/${serverMessageId}`;
}

export function buildConversationMessageCountUrl({
  apiBaseUrl = "",
  conversationId,
}: {
  apiBaseUrl?: string;
  conversationId: number;
}): string {
  return `${apiBaseUrl}/api/conversations/${conversationId}/messages?limit=1`;
}

export async function fetchConversationRestore({
  apiBaseUrl = "",
  conversationId,
  token,
  signal,
  snapshotVersion,
  fetchImpl = fetch,
}: {
  apiBaseUrl?: string;
  conversationId: number;
  token: string;
  signal?: AbortSignal;
  snapshotVersion?: string;
  fetchImpl?: typeof fetch;
}): Promise<ConversationRestoreResponse> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (snapshotVersion) headers["If-None-Match"] = snapshotVersion;
  const res = await fetchImpl(buildChatBootstrapUrl({ apiBaseUrl, conversationId, messageTail: DEFAULT_CONVERSATION_RESTORE_TAIL, conversationLimit: 30 }), {
    headers,
    credentials: "include",
    signal,
  });
  if (res.status === 304) return { notModified: true, snapshot_version: snapshotVersion };
  if (!res.ok) throw new Error(`chat bootstrap failed: ${res.status}`);
  return mapChatBootstrapPayloadToConversationRestore(await res.json());
}

export function mapChatBootstrapPayloadToConversationRestore(payload: ChatBootstrapPayload): ConversationRestoreResponse {
  return {
    title: payload.conversation?.title || "",
    model: payload.conversation?.model,
    compare: !!payload.conversation?.compare,
    compare_models: JSON.stringify(payload.conversation?.compare_models || []),
    skill_key: payload.conversation?.skill_key,
    messages: payload.snapshot?.messages || [],
    total: payload.snapshot?.total,
    has_more: payload.snapshot?.has_more,
    snapshot_version: payload.snapshot?.snapshot_version,
    last_assistant_status: payload.snapshot?.last_assistant_status,
  };
}

export async function fetchConversationMessageStatus({
  apiBaseUrl = "",
  conversationId,
  serverMessageId,
  token,
  signal,
  fetchImpl = fetch,
}: {
  apiBaseUrl?: string;
  conversationId: number;
  serverMessageId: number;
  token: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<ConversationRestoreStatusResponse | undefined> {
  const res = await fetchImpl(buildConversationMessageStatusUrl({ apiBaseUrl, conversationId, serverMessageId }), {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  return res.ok ? await res.json() : undefined;
}

export async function fetchConversationMessageCount({
  apiBaseUrl = "",
  conversationId,
  token,
  signal,
  fetchImpl = fetch,
}: {
  apiBaseUrl?: string;
  conversationId: number;
  token: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<number | undefined> {
  const res = await fetchImpl(buildConversationMessageCountUrl({ apiBaseUrl, conversationId }), {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!res.ok) return undefined;
  const data = await res.json();
  return typeof data?.total === "number" ? data.total : undefined;
}

export function mapConversationRestoreMessages(
  messages: ForkChatPersistedMessage[] = [],
  options: { fallbackId: () => string; parseTime?: (value: string) => number }
): ConversationRestoreMessage[] {
  return mapPersistedChatMessages(messages, options).map((message) => ({
    ...message,
    groupModels: Array.isArray(message.groupModels)
      ? message.groupModels.filter((model): model is string => typeof model === "string" && model.length > 0)
      : undefined,
  }));
}

export function buildActiveTaskStreamsByServerMessageId(
  activeEntries: [string, ActiveConversationTaskStreamInfo][],
  conversationId: number
): Map<string, { localId: string; info: ActiveConversationTaskStreamInfo }> {
  return new Map(
    activeEntries
      .filter(([, info]) => info.convId === conversationId && info.serverMessageId)
      .map(([localId, info]) => [String(info.serverMessageId), { localId, info }])
  );
}

export function mergeActiveTaskStreamsIntoMessages(
  messages: ConversationRestoreMessage[],
  activeByServerMessageId: Map<string, { localId: string; info: ActiveConversationTaskStreamInfo }>,
  activeActivityStatus: unknown
): ConversationRestoreMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant") return message;
    const active = activeByServerMessageId.get(String(message.serverMessageId || message.id));
    if (!active) return message;
    return {
      ...message,
      id: active.localId,
      content: active.info.content || message.content,
      serverMessageId: active.info.serverMessageId || message.serverMessageId,
      generationTaskId: active.info.generationTaskId || message.generationTaskId,
      lastSequence: active.info.lastSequence || message.lastSequence,
      activityStatus: activeActivityStatus,
    };
  });
}

export function buildConversationRestoreState({
  data,
  activeEntries,
  conversationId,
  fallbackId,
  activeActivityStatus,
  parseTime,
}: {
  data: ConversationRestoreResponse;
  activeEntries: [string, ActiveConversationTaskStreamInfo][];
  conversationId: number;
  fallbackId: () => string;
  activeActivityStatus: unknown;
  parseTime?: (value: string) => number;
}): {
  loadedMessages: ConversationRestoreMessage[];
  mergedMessages: ConversationRestoreMessage[];
  groupViews: Map<number, number>;
  activeByServerMessageId: Map<string, { localId: string; info: ActiveConversationTaskStreamInfo }>;
  isLoading: boolean;
} | undefined {
  if (!data.messages) return undefined;
  const loadedMessages = mapConversationRestoreMessages(data.messages, { fallbackId, parseTime });
  const activeByServerMessageId = buildActiveTaskStreamsByServerMessageId(activeEntries, conversationId);
  const mergedMessages = mergeActiveTaskStreamsIntoMessages(loadedMessages, activeByServerMessageId, activeActivityStatus);
  return {
    loadedMessages,
    mergedMessages,
    groupViews: buildGroupViewsFromMessages(mergedMessages),
    activeByServerMessageId,
    isLoading: activeByServerMessageId.size > 0,
  };
}

export function findLastAssistantStatusTarget(
  messages: ConversationRestoreMessage[],
  activeByServerMessageId: Map<string, unknown>
): ConversationRestoreMessage | undefined {
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant" && message.serverMessageId);
  if (!lastAssistant?.serverMessageId) return undefined;
  return activeByServerMessageId.has(String(lastAssistant.serverMessageId)) ? undefined : lastAssistant;
}

export function buildConversationStatusDecision({
  statusData,
  currentMessage,
  busyActivityStatus,
  now = Date.now(),
  parseTime = (value: string) => new Date(value).getTime(),
}: {
  statusData: ConversationRestoreStatusResponse;
  currentMessage: ConversationRestoreMessage;
  busyActivityStatus: unknown;
  now?: number;
  parseTime?: (value: string) => number;
}): ConversationRestoreStatusDecision {
  const bgTask = statusData?.background_task || {};
  const hasTask = !!bgTask.id || !!bgTask.task_id || !!bgTask.status;
  const status = bgTask.status || "";
  const terminalStatus = status === "completed" || status === "failed" || status === "cancelled" || status === "incomplete";
  const serverContent = statusData?.message?.content || "";
  const hasContent = serverContent.trim().length > 0;
  const shouldResumePolling = hasTask && (!terminalStatus || !hasContent);
  const generationTaskId = Number(bgTask.id || bgTask.task_id || 0) || undefined;
  const lastSequence = Number(bgTask.last_sequence_number || 0) || 0;
  const currentMessageSequence = currentMessage.lastSequence || 0;
  const resumeAfterSequence = hasContent ? (lastSequence || currentMessageSequence) : currentMessageSequence;
  const completedAt = shouldResumePolling
    ? undefined
    : (hasTask && terminalStatus && hasContent && !currentMessage.completedAt
      ? (bgTask.completed_at ? parseTime(bgTask.completed_at) : now)
      : currentMessage.completedAt);
  const patch: Partial<ConversationRestoreMessage> = {
    content: serverContent || currentMessage.content,
    generationTaskId: generationTaskId || currentMessage.generationTaskId,
    lastSequence: lastSequence || currentMessage.lastSequence,
    completedAt,
    activityStatus: shouldResumePolling ? busyActivityStatus : currentMessage.activityStatus,
  };
  return {
    hasTask,
    status,
    terminalStatus,
    serverContent,
    hasContent,
    shouldResumePolling,
    generationTaskId,
    lastSequence,
    patch,
    resume: shouldResumePolling
      ? {
        generationTaskId,
        lastSequence: resumeAfterSequence,
        initialContent: serverContent || currentMessage.content || "",
      }
      : undefined,
  };
}

export function parseConversationCompareModels(value: unknown): string[] {
  if (!value || typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function resolveConversationSkillKey(dataSkillKey: unknown, fallbackSkillKey?: string): string | undefined {
  return typeof dataSkillKey === "string" && dataSkillKey.length > 0 ? dataSkillKey : fallbackSkillKey;
}
