export type ChatSidebarConversation = {
  id: number;
  title: string;
  model?: string;
  pinned?: boolean;
  created_at?: string;
  updated_at: string;
  skill_key?: string;
  [key: string]: any;
};

export type ChatSidebarActivityUpdate = {
  id?: number | string;
  conversationId?: number | string;
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
  current.forEach((conv) => byId.set(conv.id, conv));
  incoming.forEach((conv) => {
    const existing = byId.get(conv.id);
    byId.set(conv.id, {
      ...(existing || {}),
      ...conv,
      updated_at: resolveActivityTime(existing?.updated_at, conv.updated_at),
    } as T);
  });
  return sortSidebarConversations(Array.from(byId.values()));
}

export function applySidebarConversationActivity<T extends ChatSidebarConversation>(current: T[], update: ChatSidebarActivityUpdate): T[] {
  const rawId = update.id ?? update.conversationId;
  const id = typeof rawId === "string" ? Number(rawId) : rawId;
  if (!id || !Number.isFinite(id)) return current;
  const updatedAt = update.updated_at || new Date().toISOString();
  const existing = current.find((conv) => conv.id === id);
  const nextConversation = {
    ...(existing || {}),
    id,
    title: update.title || existing?.title || "新对话",
    model: update.model ?? existing?.model ?? "",
    skill_key: update.skill_key ?? existing?.skill_key,
    pinned: existing?.pinned ?? false,
    created_at: existing?.created_at || updatedAt,
    updated_at: resolveActivityTime(existing?.updated_at, updatedAt),
  } as T;
  return mergeSidebarConversations(current.filter((conv) => conv.id !== id), [nextConversation]);
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
