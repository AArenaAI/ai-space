import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CHAT_SIDEBAR_CONVERSATION_PAGE_SIZE,
  applySidebarConversationActivity,
  hasMoreSidebarConversations,
  mergeSidebarConversations,
  parseSidebarCursor,
  sortSidebarConversations,
  type ChatSidebarConversation,
} from "@/lib/chatSidebarHistory";
import { getConversationMetadataEventFromDomEvent } from "@/lib/chatConversationMetadataEvents";

export type SidebarConversation = ChatSidebarConversation & {
  model: string;
  pinned: boolean;
  created_at: string;
};

type SidebarConversationListPage = {
  conversations: SidebarConversation[];
  total?: number;
  limit: number;
  offset: number;
  next_cursor?: string;
  has_more?: boolean;
};

type ChatBootstrapLike = {
  sidebar?: { conversations?: any[] };
} | null | undefined;

type Anchor = { id?: string; offset: number } | null;

type UseChatSidebarHistoryOptions = {
  user?: unknown;
  workspaceId?: number;
  pathname?: string | null;
  routeConversationId?: string | number | null;
  chatBootstrap?: ChatBootstrapLike;
  cacheKey?: string;
  hiddenSkillKeys?: Set<string>;
  captureAnchor?: () => Anchor;
  restoreAnchor?: (anchor: Anchor) => void;
  firstLoadMinMs?: number;
};

const DEFAULT_HIDDEN_SKILL_KEYS = new Set([
  "ai-writing-assistant",
  "translator",
  "document-reader",
  "seedream-beta",
]);

const sidebarConversationCache = new Map<string, SidebarConversation[] | null>();

function getCache(cacheKey: string) {
  return sidebarConversationCache.has(cacheKey) ? sidebarConversationCache.get(cacheKey)! : null;
}

function setCache(cacheKey: string, conversations: SidebarConversation[] | null) {
  sidebarConversationCache.set(cacheKey, conversations);
}

function isMainChatConversation(conv: SidebarConversation, hiddenSkillKeys: Set<string>) {
  return !conv.skill_key || !hiddenSkillKeys.has(conv.skill_key);
}

function normalizePathname(pathname?: string | null) {
  if (!pathname) return "";
  return pathname === "/" ? pathname : pathname.replace(/\/$/, "");
}

function normalizeConversation(raw: any): SidebarConversation {
  const now = new Date().toISOString();
  return {
    ...raw,
    id: Number(raw?.id || 0),
    title: raw?.title || "新对话",
    model: raw?.model || "",
    pinned: Boolean(raw?.pinned),
    created_at: raw?.created_at || raw?.updated_at || now,
    updated_at: raw?.updated_at || now,
    skill_key: raw?.skill_key,
  };
}

async function fetchSidebarConversationsPage({
  workspaceId,
  offset = 0,
  cursor,
  hiddenSkillKeys,
}: {
  workspaceId?: number;
  offset?: number;
  cursor?: string;
  hiddenSkillKeys: Set<string>;
}): Promise<SidebarConversationListPage | null> {
  const token = localStorage.getItem("token");
  if (!token) return { conversations: [], total: 0, limit: CHAT_SIDEBAR_CONVERSATION_PAGE_SIZE, offset };
  try {
    const params = new URLSearchParams();
    if (workspaceId) params.set("workspace_id", String(workspaceId));
    params.set("limit", String(CHAT_SIDEBAR_CONVERSATION_PAGE_SIZE));
    const parsedCursor = parseSidebarCursor(cursor);
    if (parsedCursor) {
      params.set("before_activity_at", parsedCursor.beforeActivityAt);
      params.set("before_id", parsedCursor.beforeId);
    } else if (offset > 0) {
      params.set("offset", String(offset));
    }
    const res = await fetch(`/api/conversations?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const normalizeList = (items: any[]) => items.map(normalizeConversation).filter((item) => isMainChatConversation(item, hiddenSkillKeys));
    if (Array.isArray(data)) return { conversations: normalizeList(data), limit: CHAT_SIDEBAR_CONVERSATION_PAGE_SIZE, offset };
    if (data && Array.isArray(data.conversations)) {
      return {
        conversations: normalizeList(data.conversations),
        total: typeof data.total === "number" ? data.total : undefined,
        limit: typeof data.limit === "number" ? data.limit : CHAT_SIDEBAR_CONVERSATION_PAGE_SIZE,
        offset: typeof data.offset === "number" ? data.offset : offset,
        next_cursor: typeof data.next_cursor === "string" ? data.next_cursor : undefined,
        has_more: typeof data.has_more === "boolean" ? data.has_more : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearChatSidebarHistoryCache(cacheKey?: string) {
  if (cacheKey) sidebarConversationCache.delete(cacheKey);
  else sidebarConversationCache.clear();
}

export function useChatSidebarHistory({
  user,
  workspaceId,
  pathname,
  routeConversationId,
  chatBootstrap,
  cacheKey = "default",
  hiddenSkillKeys = DEFAULT_HIDDEN_SKILL_KEYS,
  captureAnchor,
  restoreAnchor,
  firstLoadMinMs = 0,
}: UseChatSidebarHistoryOptions) {
  const initialCache = getCache(cacheKey);
  const [conversations, setConversationState] = useState<SidebarConversation[]>(initialCache || []);
  const [loading, setLoading] = useState(initialCache === null);
  const [conversationTotal, setConversationTotal] = useState<number | undefined>();
  const [conversationNextOffset, setConversationNextOffset] = useState(CHAT_SIDEBAR_CONVERSATION_PAGE_SIZE);
  const [conversationNextCursor, setConversationNextCursor] = useState<string | undefined>();
  const [conversationHasMore, setConversationHasMore] = useState<boolean | undefined>();
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
  const [chatBootstrapReady, setChatBootstrapReady] = useState(false);

  const setConversations = useCallback((nextOrUpdater: SidebarConversation[] | ((prev: SidebarConversation[]) => SidebarConversation[])) => {
    const anchor = captureAnchor?.() || null;
    setConversationState((prev) => {
      const rawNext = typeof nextOrUpdater === "function" ? nextOrUpdater(prev) : nextOrUpdater;
      const next = sortSidebarConversations(rawNext.map(normalizeConversation));
      setCache(cacheKey, next);
      return next;
    });
    restoreAnchor?.(anchor);
  }, [cacheKey, captureAnchor, restoreAnchor]);

  const applyBootstrapConversations = useCallback((items?: SidebarConversation[]) => {
    if (!Array.isArray(items)) return;
    setChatBootstrapReady(true);
    const incoming = sortSidebarConversations(items.map(normalizeConversation).filter((item) => isMainChatConversation(item, hiddenSkillKeys)));
    setConversations((prev) => mergeSidebarConversations(prev, incoming));
    setLoading(false);
  }, [hiddenSkillKeys, setConversations]);

  useEffect(() => {
    if (!chatBootstrap) return;
    applyBootstrapConversations(chatBootstrap.sidebar?.conversations as SidebarConversation[] | undefined);
  }, [applyBootstrapConversations, chatBootstrap]);

  useEffect(() => {
    const handleBootstrapReady = (event: Event) => {
      const detail = (event as CustomEvent<ChatBootstrapLike>).detail;
      applyBootstrapConversations(detail?.sidebar?.conversations as SidebarConversation[] | undefined);
    };
    window.addEventListener("chat-bootstrap-ready", handleBootstrapReady);
    return () => window.removeEventListener("chat-bootstrap-ready", handleBootstrapReady);
  }, [applyBootstrapConversations]);

  const shouldWaitForBootstrap = useMemo(() => {
    const normalizedPathname = normalizePathname(pathname);
    return normalizedPathname === "/chat" && !!routeConversationId && !chatBootstrapReady;
  }, [chatBootstrapReady, pathname, routeConversationId]);

  const loadConversations = useCallback(async () => {
    if (!user) {
      setConversations([]);
      setLoading(false);
      return;
    }
    if (shouldWaitForBootstrap) return;
    const isFirstLoad = getCache(cacheKey) === null;
    if (isFirstLoad) setLoading(true);
    const startedAt = Date.now();
    const page = await fetchSidebarConversationsPage({ workspaceId, hiddenSkillKeys });
    if (isFirstLoad && firstLoadMinMs > 0) {
      const elapsed = Date.now() - startedAt;
      if (elapsed < firstLoadMinMs) await new Promise((resolve) => setTimeout(resolve, firstLoadMinMs - elapsed));
    }
    if (isFirstLoad) setLoading(false);
    if (page === null) return;
    setConversationTotal(page.total);
    setConversationNextOffset((page.offset || 0) + page.conversations.length);
    setConversationNextCursor(page.next_cursor);
    setConversationHasMore(page.has_more);
    setConversations(sortSidebarConversations(page.conversations));
  }, [cacheKey, firstLoadMinMs, hiddenSkillKeys, setConversations, shouldWaitForBootstrap, user, workspaceId]);

  useEffect(() => { void loadConversations(); }, [loadConversations]);

  const hasMoreConversations = hasMoreSidebarConversations(conversations.length, conversationNextOffset, conversationTotal, conversationHasMore);

  const loadMoreConversations = useCallback(async () => {
    if (loadingMoreConversations || !hasMoreConversations) return;
    setLoadingMoreConversations(true);
    const page = await fetchSidebarConversationsPage({
      workspaceId,
      offset: conversationNextOffset,
      cursor: conversationNextCursor,
      hiddenSkillKeys,
    });
    setLoadingMoreConversations(false);
    if (!page) return;
    setConversationTotal(page.total);
    setConversationNextOffset((page.offset || conversationNextOffset) + page.conversations.length);
    setConversationNextCursor(page.next_cursor);
    setConversationHasMore(page.has_more);
    setConversations((prev) => mergeSidebarConversations(prev, page.conversations));
  }, [conversationNextCursor, conversationNextOffset, hasMoreConversations, hiddenSkillKeys, loadingMoreConversations, setConversations, workspaceId]);

  useEffect(() => {
    const handleCreated = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail?.id) {
        void loadConversations();
        return;
      }
      const conv = normalizeConversation(detail);
      if (!isMainChatConversation(conv, hiddenSkillKeys)) return;
      setConversations((prev) => mergeSidebarConversations(prev.filter((item) => item.id !== conv.id), [conv]));
    };
    window.addEventListener("conversation-created", handleCreated);
    return () => window.removeEventListener("conversation-created", handleCreated);
  }, [hiddenSkillKeys, loadConversations, setConversations]);

  useEffect(() => {
    const handleRenamed = (event: Event) => {
      const metadata = getConversationMetadataEventFromDomEvent(event);
      if (!metadata || metadata.title == null) return;
      setConversations((prev) => prev.map((item) => item.id === metadata.id ? { ...item, title: metadata.title! } : item));
    };
    window.addEventListener("conversation-renamed", handleRenamed);
    return () => window.removeEventListener("conversation-renamed", handleRenamed);
  }, [setConversations]);

  useEffect(() => {
    const handleUpdated = (event: Event) => {
      const metadata = getConversationMetadataEventFromDomEvent(event);
      if (!metadata) return;
      setConversations((prev) => applySidebarConversationActivity(prev, metadata));
    };
    window.addEventListener("conversation-updated", handleUpdated);
    return () => window.removeEventListener("conversation-updated", handleUpdated);
  }, [setConversations]);

  return {
    conversations,
    setConversations,
    loading,
    setLoading,
    loadConversations,
    hasMoreConversations,
    loadMoreConversations,
    loadingMoreConversations,
  };
}
