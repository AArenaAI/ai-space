import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CHAT_SIDEBAR_CONVERSATION_PAGE_SIZE,
  applySidebarConversationActivity,
  hasMoreSidebarConversations,
  mergeSidebarConversations,
  parseSidebarCursor,
  patchSidebarConversation,
  removeSidebarConversation,
  sortSidebarConversations,
  type ChatSidebarActivityUpdate,
  type ChatSidebarConversation,
} from "@/lib/chatSidebarHistory";
import { getConversationMetadataEventFromDomEvent } from "@/lib/chatConversationMetadataEvents";
import { apiFetch } from "@/lib/api/client";
import { readAuthState } from "@/lib/auth/state";

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
  workspace?: { current_id?: number };
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
  enabled?: boolean;
  useBootstrapSeed?: boolean;
};

const DEFAULT_HIDDEN_SKILL_KEYS = new Set([
  "ai-writing-assistant",
  "translator",
  "document-reader",
  "seedream-beta",
]);

const sidebarConversationCache = new Map<string, SidebarConversation[] | null>();
const sidebarConversationPageInflight = new Map<string, Promise<SidebarConversationListPage | null>>();
const sidebarConversationPageRecent = new Map<string, { page: SidebarConversationListPage | null; at: number }>();
const SIDEBAR_CANONICAL_CACHE_PREFIX = "chat-sidebar-canonical:";
const SIDEBAR_CANONICAL_RECENT_TTL_MS = 2500;

function getCache(cacheKey: string) {
  return sidebarConversationCache.has(cacheKey) ? sidebarConversationCache.get(cacheKey)! : null;
}

function setCache(cacheKey: string, conversations: SidebarConversation[] | null) {
  sidebarConversationCache.set(cacheKey, conversations);
}

function getCanonicalCacheKey(workspaceId?: number) {
  return workspaceId ? `${SIDEBAR_CANONICAL_CACHE_PREFIX}${workspaceId}` : "";
}

function readCanonicalConversationCache(workspaceId?: number): SidebarConversation[] | null {
  if (typeof window === "undefined") return null;
  const key = getCanonicalCacheKey(workspaceId);
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.conversations)) return null;
    return sortSidebarConversations(data.conversations.map(normalizeConversation));
  } catch {
    return null;
  }
}

function writeCanonicalConversationCache(workspaceId: number | undefined, conversations: SidebarConversation[]) {
  if (typeof window === "undefined") return;
  const key = getCanonicalCacheKey(workspaceId);
  if (!key) return;
  try {
    sessionStorage.setItem(key, JSON.stringify({ conversations, cached_at: new Date().toISOString() }));
  } catch {
    // Ignore quota/private-mode failures; in-memory state remains canonical for this session.
  }
}

function isMainChatConversation(conv: SidebarConversation, hiddenSkillKeys: Set<string>) {
  return !conv.skill_key || !hiddenSkillKeys.has(conv.skill_key);
}

function normalizePathname(pathname?: string | null) {
  if (!pathname) return "";
  return pathname === "/" ? pathname : pathname.replace(/\/$/, "");
}

function readStoredWorkspaceId() {
  if (typeof window === "undefined") return undefined;
  const raw = localStorage.getItem("current-workspace");
  const id = raw ? Number(raw) : 0;
  return Number.isFinite(id) && id > 0 ? id : undefined;
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
  if (!readAuthState().user) return { conversations: [], total: 0, limit: CHAT_SIDEBAR_CONVERSATION_PAGE_SIZE, offset };
  const inflightKey = JSON.stringify({ workspaceId: workspaceId || 0, offset, cursor: cursor || "" });
  const existingInflight = sidebarConversationPageInflight.get(inflightKey);
  if (existingInflight) return existingInflight;
  const recent = sidebarConversationPageRecent.get(inflightKey);
  if (recent && Date.now() - recent.at < SIDEBAR_CANONICAL_RECENT_TTL_MS) return recent.page;

  const request = (async (): Promise<SidebarConversationListPage | null> => {
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
      const res = await apiFetch(`/conversations?${params.toString()}`);
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
    } finally {
      sidebarConversationPageInflight.delete(inflightKey);
    }
  })();

  sidebarConversationPageInflight.set(inflightKey, request);
  request.then((page) => {
    if (page) sidebarConversationPageRecent.set(inflightKey, { page, at: Date.now() });
  }).catch(() => undefined);
  return request;
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
  enabled = true,
  useBootstrapSeed = false,
}: UseChatSidebarHistoryOptions) {
  const initialWorkspaceId = workspaceId || chatBootstrap?.workspace?.current_id || readStoredWorkspaceId();
  const initialCache = enabled ? getCache(cacheKey) || readCanonicalConversationCache(initialWorkspaceId) : null;
  const [conversations, setConversationState] = useState<SidebarConversation[]>(initialCache || []);
  const [loading, setLoading] = useState(enabled && initialCache === null);
  const [conversationTotal, setConversationTotal] = useState<number | undefined>();
  const [conversationNextOffset, setConversationNextOffset] = useState(CHAT_SIDEBAR_CONVERSATION_PAGE_SIZE);
  const [conversationNextCursor, setConversationNextCursor] = useState<string | undefined>();
  const [conversationHasMore, setConversationHasMore] = useState<boolean | undefined>();
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
  const [chatBootstrapReady, setChatBootstrapReady] = useState(false);
  const effectiveWorkspaceId = initialWorkspaceId;

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

  useEffect(() => {
    if (enabled) return;
    setConversationState([]);
    setLoading(false);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !effectiveWorkspaceId || conversations.length > 0) return;
    const cached = readCanonicalConversationCache(effectiveWorkspaceId);
    if (!cached?.length) return;
    setConversations(cached);
    setLoading(false);
  }, [conversations.length, effectiveWorkspaceId, enabled, setConversations]);

  const applyBootstrapConversations = useCallback((items?: SidebarConversation[]) => {
    setChatBootstrapReady(true);
    if (!useBootstrapSeed) return;
    if (!Array.isArray(items)) return;
    const incoming = sortSidebarConversations(items.map(normalizeConversation).filter((item) => isMainChatConversation(item, hiddenSkillKeys)));
    setConversations((prev) => mergeSidebarConversations(prev, incoming));
    setLoading(false);
  }, [hiddenSkillKeys, setConversations, useBootstrapSeed]);

  useEffect(() => {
    if (!enabled) return;
    if (!chatBootstrap) return;
    applyBootstrapConversations(chatBootstrap.sidebar?.conversations as SidebarConversation[] | undefined);
  }, [applyBootstrapConversations, chatBootstrap, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const handleBootstrapReady = (event: Event) => {
      const detail = (event as CustomEvent<ChatBootstrapLike>).detail;
      applyBootstrapConversations(detail?.sidebar?.conversations as SidebarConversation[] | undefined);
    };
    window.addEventListener("chat-bootstrap-ready", handleBootstrapReady);
    return () => window.removeEventListener("chat-bootstrap-ready", handleBootstrapReady);
  }, [applyBootstrapConversations, enabled]);

  const shouldWaitForBootstrap = useMemo(() => {
    const normalizedPathname = normalizePathname(pathname);
    return normalizedPathname === "/chat" && !!routeConversationId && !chatBootstrapReady;
  }, [chatBootstrapReady, pathname, routeConversationId]);

  const loadConversations = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    if (!user) {
      setConversationState((prev) => prev.length > 0 ? prev : []);
      setLoading(false);
      return;
    }
    if (!effectiveWorkspaceId) return;
    if (shouldWaitForBootstrap) return;
    const isFirstLoad = getCache(cacheKey) === null;
    if (isFirstLoad) setLoading(true);
    const startedAt = Date.now();
    const page = await fetchSidebarConversationsPage({ workspaceId: effectiveWorkspaceId, hiddenSkillKeys });
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
    setConversations((prev) => {
      const merged = mergeSidebarConversations(prev, page.conversations);
      writeCanonicalConversationCache(effectiveWorkspaceId, merged);
      return merged;
    });
  }, [cacheKey, effectiveWorkspaceId, enabled, firstLoadMinMs, hiddenSkillKeys, setConversations, shouldWaitForBootstrap, user]);

  useEffect(() => { void loadConversations(); }, [loadConversations]);

  const hasMoreConversations = hasMoreSidebarConversations(conversations.length, conversationNextOffset, conversationTotal, conversationHasMore);

  const applyConversationActivity = useCallback((detail: ChatSidebarActivityUpdate) => {
    setConversations((prev) => applySidebarConversationActivity(prev, detail));
  }, [setConversations]);

  const patchConversation = useCallback((id: number, patch: Partial<SidebarConversation>) => {
    setConversations((prev) => patchSidebarConversation(prev, id, patch));
  }, [setConversations]);

  const removeConversation = useCallback((id: number) => {
    setConversations((prev) => removeSidebarConversation(prev, id));
  }, [setConversations]);

  const loadMoreConversations = useCallback(async () => {
    if (!enabled || loadingMoreConversations || !hasMoreConversations || !effectiveWorkspaceId) return;
    setLoadingMoreConversations(true);
    const page = await fetchSidebarConversationsPage({
      workspaceId: effectiveWorkspaceId,
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
    setConversations((prev) => {
      const merged = mergeSidebarConversations(prev, page.conversations);
      writeCanonicalConversationCache(effectiveWorkspaceId, merged);
      return merged;
    });
  }, [conversationNextCursor, conversationNextOffset, effectiveWorkspaceId, enabled, hasMoreConversations, hiddenSkillKeys, loadingMoreConversations, setConversations]);

  useEffect(() => {
    const handleCreated = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail?.id) {
        void loadConversations();
        return;
      }
      const conv = normalizeConversation(detail);
      if (!isMainChatConversation(conv, hiddenSkillKeys)) return;
      applyConversationActivity({ ...conv, source: "created" });
    };
    window.addEventListener("conversation-created", handleCreated);
    return () => window.removeEventListener("conversation-created", handleCreated);
  }, [applyConversationActivity, hiddenSkillKeys, loadConversations]);

  useEffect(() => {
    const handleRenamed = (event: Event) => {
      const metadata = getConversationMetadataEventFromDomEvent(event);
      if (!metadata || metadata.title == null) return;
      applyConversationActivity({ ...metadata, source: metadata.source || "manual-rename" });
    };
    window.addEventListener("conversation-renamed", handleRenamed);
    return () => window.removeEventListener("conversation-renamed", handleRenamed);
  }, [applyConversationActivity]);

  useEffect(() => {
    const handleUpdated = (event: Event) => {
      const metadata = getConversationMetadataEventFromDomEvent(event);
      if (!metadata) return;
      applyConversationActivity(metadata);
    };
    window.addEventListener("conversation-updated", handleUpdated);
    return () => window.removeEventListener("conversation-updated", handleUpdated);
  }, [applyConversationActivity]);

  useEffect(() => {
    const handleDeleted = (event: Event) => {
      const metadata = getConversationMetadataEventFromDomEvent(event);
      if (!metadata) return;
      removeConversation(metadata.id);
    };
    window.addEventListener("conversation-deleted", handleDeleted);
    return () => window.removeEventListener("conversation-deleted", handleDeleted);
  }, [removeConversation]);

  return {
    conversations,
    setConversations,
    applyConversationActivity,
    patchConversation,
    removeConversation,
    loading,
    setLoading,
    loadConversations,
    hasMoreConversations,
    loadMoreConversations,
    loadingMoreConversations,
  };
}
