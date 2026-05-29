import {
  buildGroupViewsFromMessages,
  ForkChatMessage,
  ForkChatPersistedMessage,
  mapPersistedChatMessages,
} from "./chatForkCoordinator";

export type ConversationRestoreResponse = {
  title?: string;
  model?: string;
  compare?: boolean;
  compare_models?: string;
  skill_key?: string;
  messages?: ForkChatPersistedMessage[];
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

export function buildConversationRestoreUrl({
  apiBaseUrl = "",
  conversationId,
  tail = 50,
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
  fetchImpl = fetch,
}: {
  apiBaseUrl?: string;
  conversationId: number;
  token: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<ConversationRestoreResponse> {
  const res = await fetchImpl(buildConversationRestoreUrl({ apiBaseUrl, conversationId }), {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!res.ok) throw new Error(`load conversation failed: ${res.status}`);
  return await res.json();
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
        lastSequence: lastSequence || currentMessage.lastSequence || 0,
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
