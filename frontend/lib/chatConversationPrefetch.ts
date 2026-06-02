import { v4 as uuidv4 } from "uuid";
import {
  buildConversationRestoreState,
  fetchConversationMessageCount,
  fetchConversationRestore,
  parseConversationCompareModels,
  resolveConversationSkillKey,
  type ConversationRestoreResponse,
} from "@/lib/chatConversationRestoreCoordinator";
import {
  hasConversationSnapshot,
  setConversationSnapshot,
} from "@/lib/chatConversationCache";
import type { Message } from "@/lib/chatTypes";

const DEFAULT_MAX_CONCURRENT_PREFETCHES = 2;
const DEFAULT_PREFETCH_TAIL = 50;

const inFlightPrefetches = new Map<number, Promise<boolean>>();
let maxConcurrentPrefetches = DEFAULT_MAX_CONCURRENT_PREFETCHES;
let prefetchTail = DEFAULT_PREFETCH_TAIL;

function fallbackId() {
  return uuidv4();
}

export function configureConversationPrefetch(options: { maxConcurrent?: number; tail?: number }) {
  maxConcurrentPrefetches = Math.max(1, options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_PREFETCHES);
  prefetchTail = Math.max(1, options.tail ?? DEFAULT_PREFETCH_TAIL);
}

export function resetConversationPrefetchConfig() {
  maxConcurrentPrefetches = DEFAULT_MAX_CONCURRENT_PREFETCHES;
  prefetchTail = DEFAULT_PREFETCH_TAIL;
}

export function getConversationPrefetchInFlightCount(): number {
  return inFlightPrefetches.size;
}

export function isConversationPrefetchInFlight(conversationId: number): boolean {
  return inFlightPrefetches.has(conversationId);
}

export function clearConversationPrefetchInFlight() {
  inFlightPrefetches.clear();
}

export async function prefetchConversationSnapshot({
  apiBaseUrl = "",
  conversationId,
  token,
  skillKey,
  signal,
  force = false,
  fetchRestore = fetchConversationRestore,
  fetchCount = fetchConversationMessageCount,
}: {
  apiBaseUrl?: string;
  conversationId: number;
  token: string | null | undefined;
  skillKey?: string;
  signal?: AbortSignal;
  force?: boolean;
  fetchRestore?: typeof fetchConversationRestore;
  fetchCount?: typeof fetchConversationMessageCount;
}): Promise<boolean> {
  if (!token || !Number.isFinite(conversationId)) return false;
  if (!force && hasConversationSnapshot(conversationId)) return true;

  const existing = inFlightPrefetches.get(conversationId);
  if (existing) return existing;
  if (inFlightPrefetches.size >= maxConcurrentPrefetches) return false;

  const task = (async () => {
    let data: ConversationRestoreResponse;
    let totalMessages: number | undefined;
    try {
      const [restoreData, count] = await Promise.all([
        fetchRestore({ apiBaseUrl, conversationId, token, signal }),
        fetchCount({ apiBaseUrl, conversationId, token, signal }).catch(() => undefined),
      ]);
      data = restoreData;
      totalMessages = count;
    } catch (error: any) {
      if (signal?.aborted || error?.name === "AbortError") return false;
      return false;
    }

    if (signal?.aborted) return false;
    const restoreState = buildConversationRestoreState({
      data,
      activeEntries: [],
      conversationId,
      fallbackId,
      activeActivityStatus: undefined,
    });
    if (!restoreState) return false;

    setConversationSnapshot({
      conversationId,
      title: data.title || "",
      messages: restoreState.mergedMessages as Message[],
      loadedPersistedMessages: restoreState.loadedMessages.length,
      totalMessages,
      groupViews: restoreState.groupViews,
      isLoading: false,
      isCompare: !!data.compare,
      compareModels: parseConversationCompareModels(data.compare_models),
      model: data.model,
      skillKey: resolveConversationSkillKey(data.skill_key, skillKey),
      fetchedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return true;
  })().finally(() => {
    inFlightPrefetches.delete(conversationId);
  });

  inFlightPrefetches.set(conversationId, task);
  return task;
}
