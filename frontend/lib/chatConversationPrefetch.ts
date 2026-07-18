import { v4 as uuidv4 } from "uuid";
import {
  buildConversationRestoreState,
  fetchConversationMessageCount,
  fetchConversationRestore,
  parseConversationCompareModels,
  resolveConversationSkillKey,
  type ConversationRestoreResponse,
} from "@/lib/chatConversationRestoreCoordinator";
import { fetchChatBootstrap, type ChatBootstrapPayload } from "@/lib/chatBootstrapCoordinator";
import {
  hasConversationSnapshot,
  setConversationSnapshot,
  type CachedConversationSnapshot,
} from "@/lib/chatConversationCache";
import { setPersistentConversationSnapshot } from "@/lib/chatConversationPersistentCache";
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
  fetchBootstrap = fetchChatBootstrap,
}: {
  apiBaseUrl?: string;
  conversationId: number;
  token: string | null | undefined;
  skillKey?: string;
  signal?: AbortSignal;
  force?: boolean;
  fetchRestore?: typeof fetchConversationRestore;
  fetchCount?: typeof fetchConversationMessageCount;
  fetchBootstrap?: typeof fetchChatBootstrap;
}): Promise<boolean> {
  if (!Number.isFinite(conversationId)) return false;
  if (!force && hasConversationSnapshot(conversationId)) return true;

  const existing = inFlightPrefetches.get(conversationId);
  if (existing) return existing;
  if (inFlightPrefetches.size >= maxConcurrentPrefetches) return false;

  const task = (async () => {
    let data: ConversationRestoreResponse;
    let totalMessages: number | undefined;
    try {
      const authToken = token || undefined;
      if (fetchRestore === fetchConversationRestore && fetchBootstrap === fetchChatBootstrap) {
        const bootstrap = await fetchBootstrap({ apiBaseUrl, conversationId, token: authToken, messageTail: prefetchTail, signal });
        data = mapBootstrapPayloadToRestoreResponse(bootstrap);
      } else {
        const requiredToken = token || "";
        if (!requiredToken) return false;
        data = await fetchRestore({ apiBaseUrl, conversationId, token: requiredToken, signal });
      }
      const countToken = token || "";
      totalMessages = typeof data.total === "number"
        ? data.total
        : countToken
          ? await fetchCount({ apiBaseUrl, conversationId, token: countToken, signal }).catch(() => undefined)
          : undefined;
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

    const snapshot: CachedConversationSnapshot = {
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
    };
    setConversationSnapshot(snapshot);
    setPersistentConversationSnapshot(snapshot);
    return true;
  })().finally(() => {
    inFlightPrefetches.delete(conversationId);
  });

  inFlightPrefetches.set(conversationId, task);
  return task;
}

function mapBootstrapPayloadToRestoreResponse(payload: ChatBootstrapPayload): ConversationRestoreResponse {
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
