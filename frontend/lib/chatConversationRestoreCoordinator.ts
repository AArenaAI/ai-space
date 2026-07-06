import {
  buildGroupViewsFromMessages,
  ForkChatMessage,
  ForkChatPersistedMessage,
  mapPersistedChatMessages,
  parsePersistedStatusTimeline,
} from "./chatForkCoordinator";
import { buildChatBootstrapUrl, defaultBootstrapSleep, type ChatBootstrapPayload } from "@/lib/chatBootstrapCoordinator";

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
  serverGenerationStatus?: string;
  stopped?: boolean;
  errorCode?: string;
};

export type ConversationRestoreStatusResponse = {
  message?: { id?: number | string; content?: string; model?: string; reasoning_content?: string; reasoning?: string; thinking?: string; status_timeline?: unknown; statusTimeline?: unknown };
  background_task?: {
    id?: number | string;
    task_id?: number | string;
    assistant_message_id?: number | string;
    status?: string;
    last_sequence_number?: number | string;
    completed_at?: string | null;
    status_timeline?: unknown;
    statusTimeline?: unknown;
  };
};

export function hasCompletedLastAssistantStatus(statusData?: ConversationRestoreStatusResponse): boolean {
  const status = statusData?.background_task?.status || "";
  const content = statusData?.message?.content || "";
  return status === "completed" && content.trim().length > 0;
}

export function isTerminalGenerationStatus(status?: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "incomplete";
}

export function hasTerminalLastAssistantStatus(statusData?: ConversationRestoreStatusResponse): boolean {
  return isTerminalGenerationStatus(statusData?.background_task?.status || "");
}

function isTerminalRestoreMessage(message: ConversationRestoreMessage): boolean {
  if (message.completedAt || message.stopped || message.errorCode) return true;
  return isTerminalGenerationStatus(message.serverGenerationStatus);
}

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
  sleep = defaultBootstrapSleep,
  retry429 = true,
  max429Retries = 2,
}: {
  apiBaseUrl?: string;
  conversationId: number;
  token: string;
  signal?: AbortSignal;
  snapshotVersion?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  retry429?: boolean;
  max429Retries?: number;
}): Promise<ConversationRestoreResponse> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (snapshotVersion) headers["If-None-Match"] = snapshotVersion;
  const url = buildChatBootstrapUrl({ apiBaseUrl, conversationId, messageTail: DEFAULT_CONVERSATION_RESTORE_TAIL, conversationLimit: 30 });
  let attempt = 0;
  for (;;) {
    const res = await fetchImpl(url, {
      headers,
      credentials: "include",
      signal,
    });
    if (res.status === 304) return { notModified: true, snapshot_version: snapshotVersion };
    if (res.status === 429 && retry429 && attempt < max429Retries && !signal?.aborted) {
      attempt += 1;
      const retryAfter = res.headers?.get?.("Retry-After");
      const seconds = retryAfter ? Number(retryAfter) : NaN;
      const retryAfterMs = Number.isFinite(seconds) && seconds >= 0 ? Math.min(Math.max(seconds * 1000, 250), 5000) : undefined;
      await sleep(retryAfterMs ?? Math.min(250 * 2 ** (attempt - 1), 1000));
      continue;
    }
    if (!res.ok) throw new Error(`chat bootstrap failed: ${res.status}`);
    return mapChatBootstrapPayloadToConversationRestore(await res.json());
  }
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
    if (isTerminalRestoreMessage(message)) return message;
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
  for (const message of loadedMessages) {
    if (message.role === "assistant" && message.serverMessageId && isTerminalRestoreMessage(message)) {
      activeByServerMessageId.delete(String(message.serverMessageId));
    }
  }
  let mergedMessages = mergeActiveTaskStreamsIntoMessages(loadedMessages, activeByServerMessageId, activeActivityStatus);
  const statusData = data.last_assistant_status;
  const bgTask = statusData?.background_task;
  const status = bgTask?.status || "";
  const terminalStatus = isTerminalGenerationStatus(status);
  const statusContent = statusData?.message?.content || "";
  const statusServerMessageId = Number(statusData?.message?.id || bgTask?.assistant_message_id || 0) || undefined;
  const shouldAppendPendingStatusAssistant =
    !!bgTask &&
    !terminalStatus &&
    !statusContent.trim() &&
    !mergedMessages.some((message) =>
      message.role === "assistant" &&
      (statusServerMessageId ? String(message.serverMessageId || message.id) === String(statusServerMessageId) : false)
    );
  if (shouldAppendPendingStatusAssistant) {
    mergedMessages = [
      ...mergedMessages,
      {
        id: fallbackId(),
        role: "assistant",
        content: "",
        model: statusData?.message?.model || data.model,
        createdAt: Date.now(),
        serverMessageId: statusServerMessageId,
        generationTaskId: Number(bgTask?.id || bgTask?.task_id || 0) || undefined,
        lastSequence: Number(bgTask?.last_sequence_number || 0) || undefined,
        activityStatus: activeActivityStatus,
        serverGenerationStatus: status,
        statusTimeline: parsePersistedStatusTimeline((statusData?.message?.status_timeline || statusData?.background_task?.status_timeline) ? {
          status_timeline: statusData?.message?.status_timeline || statusData?.background_task?.status_timeline,
        } as ForkChatPersistedMessage : {} as ForkChatPersistedMessage),
      },
    ];
  }
  return {
    loadedMessages,
    mergedMessages,
    groupViews: buildGroupViewsFromMessages(mergedMessages),
    activeByServerMessageId,
    isLoading: activeByServerMessageId.size > 0 || shouldAppendPendingStatusAssistant,
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
  const terminalStatus = isTerminalGenerationStatus(status);
  const serverContent = statusData?.message?.content || "";
  const serverReasoningContent = statusData?.message?.reasoning_content || statusData?.message?.reasoning || statusData?.message?.thinking || "";
  const hasContent = serverContent.trim().length > 0;
  const shouldResumePolling = hasTask && !terminalStatus;
  const generationTaskId = Number(bgTask.id || bgTask.task_id || 0) || undefined;
  const lastSequence = Number(bgTask.last_sequence_number || 0) || 0;
  const currentMessageSequence = currentMessage.lastSequence || 0;
  const resumeAfterSequence = hasContent ? (lastSequence || currentMessageSequence) : currentMessageSequence;
  const statusTimeline = parsePersistedStatusTimeline({
    status_timeline: statusData?.message?.status_timeline || bgTask?.status_timeline,
  } as ForkChatPersistedMessage);
  const completedAt = shouldResumePolling
    ? undefined
    : (hasTask && terminalStatus && !currentMessage.completedAt
      ? (bgTask.completed_at ? parseTime(bgTask.completed_at) : now)
      : currentMessage.completedAt);
  const patch: Partial<ConversationRestoreMessage> = {
    content: serverContent || currentMessage.content,
    ...(serverReasoningContent || currentMessage.reasoningContent
      ? { reasoningContent: serverReasoningContent || currentMessage.reasoningContent }
      : {}),
    generationTaskId: generationTaskId || currentMessage.generationTaskId,
    lastSequence: lastSequence || currentMessage.lastSequence,
    completedAt,
    activityStatus: shouldResumePolling ? busyActivityStatus : (terminalStatus ? undefined : currentMessage.activityStatus),
    serverGenerationStatus: status || currentMessage.serverGenerationStatus,
    statusTimeline: statusTimeline || currentMessage.statusTimeline,
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
