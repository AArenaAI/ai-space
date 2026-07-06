export type ChatSidebarConversation = {
  id: number;
  title: string;
  model?: string;
  pinned?: boolean;
  created_at?: string;
  updated_at: string;
  skill_key?: string;
  client_temp_id?: string;
  canonical_id?: number;
  title_pending?: boolean;
  [key: string]: any;
};

export type ChatSidebarActivityUpdate = {
  id?: number | string;
  conversationId?: number | string;
  client_temp_id?: string;
  replaceClientTempId?: string;
  title?: string;
  model?: string;
  skill_key?: string;
  workspace_id?: number;
  updated_at?: string;
  source?: string;
};

export const CHAT_SIDEBAR_CONVERSATION_PAGE_SIZE = 500;

export function sortSidebarConversations<T extends ChatSidebarConversation>(conversations: T[]): T[] {
  return [...conversations].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

function resolveActivityTime(current?: string, incoming?: string) {
  if (!current) return incoming || new Date().toISOString();
  if (!incoming) return current;
  const currentMs = new Date(current).getTime();
  const incomingMs = new Date(incoming).getTime();
  if (!Number.isFinite(currentMs)) return incoming;
  if (!Number.isFinite(incomingMs)) return current;
  return incomingMs >= currentMs ? incoming : current;
}

export function mergeSidebarConversations<T extends ChatSidebarConversation>(current: T[], incoming: T[]): T[] {
  const byId = new Map<number, T>();
  const tempIdToId = new Map<string, number>();
  current.forEach((conv) => {
    byId.set(conv.id, conv);
    if (conv.client_temp_id) tempIdToId.set(conv.client_temp_id, conv.id);
  });
  incoming.forEach((conv) => {
    const tempMatchedId = conv.client_temp_id ? tempIdToId.get(conv.client_temp_id) : undefined;
    const existing = byId.get(conv.id) || (tempMatchedId ? byId.get(tempMatchedId) : undefined);
    if (tempMatchedId && tempMatchedId !== conv.id) byId.delete(tempMatchedId);
    byId.set(conv.id, {
      ...(existing || {}),
      ...conv,
      title_pending: conv.title_pending ?? (existing?.title_pending && isDefaultOrEmptySidebarTitle(conv.title)),
      updated_at: resolveActivityTime(existing?.updated_at, conv.updated_at),
    } as T);
  });
  return sortSidebarConversations(Array.from(byId.values()));
}

function isDefaultOrEmptySidebarTitle(title?: string) {
  const normalized = (title || "").trim();
  return !normalized || normalized === "新对话" || normalized.toLowerCase() === "new chat";
}

function resolveSidebarActivityTitle(existingTitle: string | undefined, update: ChatSidebarActivityUpdate) {
  if (update.title === undefined) return existingTitle || "新对话";
  if (update.source === "local-send" && !isDefaultOrEmptySidebarTitle(existingTitle)) return existingTitle || "新对话";
  return update.title || existingTitle || "新对话";
}

export function applySidebarConversationActivity<T extends ChatSidebarConversation>(current: T[], update: ChatSidebarActivityUpdate): T[] {
  const rawId = update.id ?? update.conversationId;
  const id = typeof rawId === "string" ? Number(rawId) : rawId;
  if (!id || !Number.isFinite(id)) return current;
  const updatedAt = update.updated_at || new Date().toISOString();
  const replaceId = update.replaceClientTempId
    ? current.find((conv) => conv.client_temp_id === update.replaceClientTempId)?.id
    : undefined;
  const existing = current.find((conv) => conv.id === id) || (replaceId ? current.find((conv) => conv.id === replaceId) : undefined);
  const nextConversation = {
    ...(existing || {}),
    id,
    canonical_id: id,
    client_temp_id: update.client_temp_id ?? existing?.client_temp_id,
    title: resolveSidebarActivityTitle(existing?.title, update),
    title_pending: update.source === "local-create"
      ? true
      : update.title === undefined
        ? existing?.title_pending
        : false,
    model: update.model ?? existing?.model ?? "",
    skill_key: update.skill_key ?? existing?.skill_key,
    pinned: existing?.pinned ?? false,
    created_at: existing?.created_at || updatedAt,
    updated_at: resolveActivityTime(existing?.updated_at, updatedAt),
  } as T;
  return mergeSidebarConversations(current.filter((conv) => conv.id !== id && conv.id !== replaceId), [nextConversation]);
}

export function patchSidebarConversation<T extends ChatSidebarConversation>(current: T[], id: number, patch: Partial<T>): T[] {
  const existing = current.find((conv) => conv.id === id);
  if (!existing) return current;
  return mergeSidebarConversations(current.filter((conv) => conv.id !== id), [{ ...existing, ...patch } as T]);
}

export function removeSidebarConversation<T extends ChatSidebarConversation>(current: T[], id: number): T[] {
  return current.filter((conv) => conv.id !== id);
}

export function hasMoreSidebarConversations(currentCount: number, nextOffset: number, total?: number, hasMore?: boolean) {
  if (typeof hasMore === "boolean") return hasMore;
  return typeof total === "number" ? currentCount < total : currentCount >= nextOffset;
}

export function parseSidebarCursor(cursor?: string) {
  if (!cursor) return null;
  const idx = cursor.lastIndexOf(":");
  if (idx <= 0) return null;
  const beforeActivityAt = cursor.slice(0, idx);
  const beforeId = cursor.slice(idx + 1);
  if (!beforeActivityAt || !beforeId) return null;
  return { beforeActivityAt, beforeId };
}
