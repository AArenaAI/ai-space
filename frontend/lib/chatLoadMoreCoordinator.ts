import {
  ForkChatMessage,
  ForkChatPersistedMessage,
  mapPersistedChatMessages,
} from "./chatForkCoordinator";

export type LoadMorePaginationInput = {
  totalMessages: number;
  loadedPersistedMessages: number;
  defaultLimit?: number;
};

export type LoadMorePage = {
  limit: number;
  offset: number;
  expectedOlderCount: number;
  requestLimit: number;
};

export type LoadMoreResponse = {
  messages?: ForkChatPersistedMessage[];
  total?: number;
};

export const DEFAULT_CHAT_LOAD_MORE_PAGE_SIZE = 8;

export function shouldStartLoadMore({
  currentConversation,
  isLoadingMore,
  hasMoreMessages,
}: {
  currentConversation?: number;
  isLoadingMore: boolean;
  hasMoreMessages: boolean;
  token: string | null;
}): boolean {
  return Boolean(currentConversation && !isLoadingMore && hasMoreMessages);
}

export function buildLoadMorePage({
  totalMessages,
  loadedPersistedMessages,
  defaultLimit = DEFAULT_CHAT_LOAD_MORE_PAGE_SIZE,
}: LoadMorePaginationInput): LoadMorePage {
  const limit = defaultLimit;
  const offset = Math.max(0, totalMessages - loadedPersistedMessages - limit);
  const expectedOlderCount = Math.max(0, totalMessages - loadedPersistedMessages - offset);
  return {
    limit,
    offset,
    expectedOlderCount,
    requestLimit: expectedOlderCount || limit,
  };
}

export function buildLoadMoreMessagesUrl({
  apiBaseUrl = "",
  conversationId,
  page,
}: {
  apiBaseUrl?: string;
  conversationId: number;
  page: Pick<LoadMorePage, "requestLimit" | "offset">;
}): string {
  return `${apiBaseUrl}/api/conversations/${conversationId}/messages?limit=${page.requestLimit}&offset=${page.offset}`;
}

export async function fetchLoadMoreMessages({
  apiBaseUrl = "",
  conversationId,
  token,
  page,
  fetchImpl = fetch,
}: {
  apiBaseUrl?: string;
  conversationId: number;
  token?: string | null;
  page: Pick<LoadMorePage, "requestLimit" | "offset">;
  fetchImpl?: typeof fetch;
}): Promise<LoadMoreResponse | undefined> {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const isBrowserSameOriginApi = typeof window !== "undefined"
    && fetchImpl === fetch
    && (!apiBaseUrl || apiBaseUrl.replace(/\/+$/, "") === window.location.origin);
  const res = isBrowserSameOriginApi
    ? await import("@/lib/api/client").then(({ apiFetch }) => apiFetch(`/conversations/${conversationId}/messages?limit=${page.requestLimit}&offset=${page.offset}`, { headers }))
    : await fetchImpl(buildLoadMoreMessagesUrl({ apiBaseUrl, conversationId, page }), { headers, credentials: "include" });
  if (!res.ok) return undefined;
  return await res.json();
}

export function mapLoadMoreMessages(
  data: LoadMoreResponse | undefined,
  options: { fallbackId: () => string; parseTime?: (value: string) => number }
): ForkChatMessage[] {
  return mapPersistedChatMessages(data?.messages || [], options);
}

export function prependUniqueOlderMessages<T extends { serverMessageId?: number }>(
  currentMessages: T[],
  olderMessages: T[]
): T[] {
  const existingIds = new Set(currentMessages.map((message) => message.serverMessageId).filter(Boolean));
  const newOnes = olderMessages.filter((message) => {
    if (!message.serverMessageId || existingIds.has(message.serverMessageId)) return false;
    existingIds.add(message.serverMessageId);
    return true;
  });
  return [...newOnes, ...currentMessages];
}

export function resolveLoadedPersistedMessages({
  previousLoaded,
  olderMessagesCount,
  responseTotal,
  fallbackTotal,
}: {
  previousLoaded: number;
  olderMessagesCount: number;
  responseTotal?: number;
  fallbackTotal: number;
}): number {
  return Math.min(typeof responseTotal === "number" ? responseTotal : fallbackTotal, previousLoaded + olderMessagesCount);
}

export function resolveTotalMessages(responseTotal: unknown, fallbackTotal: number): number {
  return typeof responseTotal === "number" ? responseTotal : fallbackTotal;
}
