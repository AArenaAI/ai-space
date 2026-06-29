import type { Message } from "@/lib/chatTypes";

export type CachedConversationSnapshot = {
  conversationId: number;
  title: string;
  messages: Message[];
  loadedPersistedMessages: number;
  totalMessages?: number;
  groupViews: Map<number, number>;
  isLoading: boolean;
  isCompare: boolean;
  compareModels: string[];
  model?: string;
  skillKey?: string;
  snapshotVersion?: string;
  fetchedAt: number;
  updatedAt: number;
};

const DEFAULT_MAX_ENTRIES = 50;
const DEFAULT_TTL_MS = 60 * 60 * 1000;

let maxEntries = DEFAULT_MAX_ENTRIES;
let ttlMs = DEFAULT_TTL_MS;

const snapshots = new Map<number, CachedConversationSnapshot>();

function nowMs(): number {
  return Date.now();
}

function cloneMessages(messages: Message[]): Message[] {
  return messages.map((message) => ({
    ...message,
    files: message.files ? message.files.map((file) => ({ ...file })) : undefined,
    searchSources: message.searchSources ? message.searchSources.map((source) => ({ ...source })) : undefined,
    groupModels: message.groupModels ? [...message.groupModels] : undefined,
    statusTimeline: message.statusTimeline ? message.statusTimeline.map((step) => ({ ...step })) : undefined,
    activityStatus: message.activityStatus ? { ...message.activityStatus } : undefined,
  }));
}

function cloneSnapshot(snapshot: CachedConversationSnapshot): CachedConversationSnapshot {
  return {
    ...snapshot,
    messages: cloneMessages(snapshot.messages),
    groupViews: new Map(snapshot.groupViews),
    compareModels: [...snapshot.compareModels],
  };
}

function isExpired(snapshot: CachedConversationSnapshot, now = nowMs()): boolean {
  return now - snapshot.updatedAt > ttlMs;
}

function evictExpired(now = nowMs()) {
  Array.from(snapshots.entries()).forEach(([conversationId, snapshot]) => {
    if (isExpired(snapshot, now)) snapshots.delete(conversationId);
  });
}

function evictLru() {
  while (snapshots.size > maxEntries) {
    const oldest = snapshots.keys().next().value;
    if (typeof oldest !== "number") return;
    snapshots.delete(oldest);
  }
}

export function configureConversationSnapshotCache(options: { maxEntries?: number; ttlMs?: number }) {
  maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  ttlMs = Math.max(1, options.ttlMs ?? DEFAULT_TTL_MS);
  evictExpired();
  evictLru();
}

export function resetConversationSnapshotCacheConfig() {
  maxEntries = DEFAULT_MAX_ENTRIES;
  ttlMs = DEFAULT_TTL_MS;
}

export function clearConversationSnapshotCache() {
  snapshots.clear();
}

export function getConversationSnapshot(conversationId: number): CachedConversationSnapshot | undefined {
  const snapshot = snapshots.get(conversationId);
  if (!snapshot) return undefined;
  if (isExpired(snapshot)) {
    snapshots.delete(conversationId);
    return undefined;
  }
  snapshots.delete(conversationId);
  snapshots.set(conversationId, { ...snapshot, updatedAt: nowMs() });
  return cloneSnapshot(snapshots.get(conversationId) as CachedConversationSnapshot);
}

export function hasConversationSnapshot(conversationId: number): boolean {
  const snapshot = snapshots.get(conversationId);
  if (!snapshot) return false;
  if (isExpired(snapshot)) {
    snapshots.delete(conversationId);
    return false;
  }
  return true;
}

export function getConversationSnapshotCacheConfig(): { maxEntries: number; ttlMs: number } {
  return { maxEntries, ttlMs };
}

export function setConversationSnapshot(snapshot: CachedConversationSnapshot) {
  evictExpired();
  snapshots.delete(snapshot.conversationId);
  snapshots.set(snapshot.conversationId, cloneSnapshot({ ...snapshot, updatedAt: nowMs() }));
  evictLru();
}

export function patchConversationSnapshot(
  conversationId: number,
  patch: Partial<Omit<CachedConversationSnapshot, "conversationId" | "messages" | "groupViews" | "compareModels">> & {
    messages?: Message[];
    groupViews?: Map<number, number>;
    compareModels?: string[];
  }
) {
  const snapshot = snapshots.get(conversationId);
  if (!snapshot || isExpired(snapshot)) {
    snapshots.delete(conversationId);
    return;
  }
  setConversationSnapshot({
    ...snapshot,
    ...patch,
    conversationId,
    messages: patch.messages ? cloneMessages(patch.messages) : snapshot.messages,
    groupViews: patch.groupViews ? new Map(patch.groupViews) : snapshot.groupViews,
    compareModels: patch.compareModels ? [...patch.compareModels] : snapshot.compareModels,
  });
}

export function invalidateConversationSnapshot(conversationId: number | undefined | null) {
  if (typeof conversationId !== "number") return;
  snapshots.delete(conversationId);
}

export function getConversationSnapshotCacheSize(): number {
  evictExpired();
  return snapshots.size;
}

export function buildConversationMessageSnapshotKey(message: Message): string {
  return [
    message.serverMessageId ?? message.id,
    message.role,
    message.content,
    message.reasoningContent ?? "",
    message.model ?? "",
    message.completedAt ?? "",
    message.generationTaskId ?? "",
    message.lastSequence ?? "",
    message.searchStatus ?? "",
    message.activityStatus?.kind ?? "",
    message.activityStatus?.status ?? "",
  ].join("\u001f");
}

export function buildConversationMessagesSnapshotKey(messages: Message[]): string {
  return messages.map(buildConversationMessageSnapshotKey).join("\u001e");
}

export function areConversationMessagesEquivalent(left: Message[], right: Message[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return buildConversationMessagesSnapshotKey(left) === buildConversationMessagesSnapshotKey(right);
}
