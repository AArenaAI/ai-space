"use client";

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, memo, type UIEvent } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Message, ChatModel } from "@/lib/chatTypes";
import { useFavorites } from "@/hooks/useFavorites";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
const ShareDialog = dynamic(() => import("@/components/ui/ShareDialog"), { ssr: false });
import { Virtuoso, VirtuosoHandle, type Components } from "react-virtuoso";
import { useMessageStream } from "@/hooks/useMessageStream";
import { inferGroups, InferredGroup } from "@/lib/groups";
import { useI18n } from "@/lib/i18n";
import ModelSelector from "./ModelSelector";
import { DeferredMarkdownRenderer } from "./DeferredMarkdownRenderer";

const MarkdownRenderer = dynamic(() => import("./MarkdownRenderer"), {
  ssr: false,
  loading: () => null,
});
import ChatMessageListItem from "./ChatMessageListItem";
import ChatCompareGroupRow from "./ChatCompareGroupRow";
import { type TextSelectionFloatingBarState } from "./TextSelectionFloatingBar";
import ChatScrollProgress from "./ChatScrollProgress";
import ChatMessageOverview, { type ChatMessageOverviewItem } from "./ChatMessageOverview";
import ChatSelectionOverlays from "./ChatSelectionOverlays";
import ChatScrollToBottomButton from "./ChatScrollToBottomButton";
import ChatHistoryLoadingState from "./ChatHistoryLoadingState";
import ChatEmptyState from "./ChatEmptyState";
import { parseThinkContent, sanitizeContent, isMessageGenerating } from "@/lib/chatContent";


const CHAT_BOTTOM_SPACER = 280;
const SCROLL_TO_BOTTOM_OFFSET = 238;
const AT_BOTTOM_THRESHOLD = 24;
const SELECT_MODE_EXTRA_SPACER = 80;
const LONG_MARKDOWN_LAZY_THRESHOLD = 4000;
type SelectionMode = "share" | "favorite";

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  isLoadingHistory?: boolean;
  isComplexTask?: boolean;
  models: ChatModel[];
  conversationId?: number;
  onDeleteMessage?: (id: string) => void;
  onRegenerate?: () => void;
  onContinueGenerate?: () => void;
  isCompare?: boolean;
  compareModels?: string[];
  onCompareModelChange?: (index: number, modelId: string) => void;
  welcomeTitle?: string;
  welcomeSubtitle?: string;
  welcomeExamples?: { title: string; desc: string; prompt: string }[];
  onExampleClick?: (prompt: string) => void;
  groupViews?: Map<number, number>;
  switchGroupModel?: (groupId: number, activeIndex: number) => void;
  onForkCompare?: (messageId: number) => void;
  isLoadingMore?: boolean;
  hasMoreMessages?: boolean;
  onLoadMore?: () => void | Promise<void>;
  targetMessageId?: number;
  bottomSpacer?: number;
  onSelectModeChange?: (active: boolean) => void;
  onExitCompare?: () => void;
  onQuoteSelection?: (quote: string) => void;
}

function normalizeExportPlainText(content: string): string {
  return content
    .replace(/```([\w-]+)?\n([\s\S]*?)```/g, (_match, lang, code) => {
      const label = lang ? `代码（${lang}）` : "代码";
      return `\n【${label}】\n${String(code).trim()}\n【代码结束】\n`;
    })
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1（$2）")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "引用：")
    .replace(/^\s{0,3}[-*+]\s+/gm, "• ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatMessageForTextExport(msg: Message, index: number, total: number): string {
  const roleLabel = msg.role === "user" ? "用户" : "AI Space";
  const title = `【${index + 1}/${total} ${roleLabel}】`;

  if (msg.role === "user") {
    const content = normalizeExportPlainText(msg.content || "");
    return `${title}\n${content || "（空消息）"}`;
  }

  const { reasoning, answer, isThinking } = parseThinkContent(msg.content || "");
  const cleanAnswer = normalizeExportPlainText(sanitizeContent(answer));
  const cleanReasoning = reasoning ? normalizeExportPlainText(reasoning) : "";
  const sections: string[] = [title];

  if (cleanReasoning) {
    sections.push(`【深度推理${isThinking ? "中" : ""}】\n${cleanReasoning}`);
  }

  sections.push(`【回答】\n${cleanAnswer || "（空回答）"}`);
  return sections.join("\n\n");
}

const MemoMarkdownRenderer = memo(function MemoMarkdownRenderer({ content }: { content: string }) {
  return <MarkdownRenderer content={content} />;
});

function LazyMarkdownRenderer({ content }: { content: string }) {
  if (content.length < LONG_MARKDOWN_LAZY_THRESHOLD) {
    return <MemoMarkdownRenderer content={content} />;
  }

  return <DeferredMarkdownRenderer content={content} />;
}

function MessageList({
  messages,
  isLoading,
  isLoadingHistory,
  isComplexTask = false,
  models,
  conversationId,
  onDeleteMessage,
  onRegenerate,
  onContinueGenerate,
  isCompare = false,
  compareModels = [],
  onCompareModelChange,
  welcomeTitle,
  welcomeSubtitle,
  welcomeExamples,
  onExampleClick,
  groupViews,
  switchGroupModel,
  onForkCompare,
  isLoadingMore,
  hasMoreMessages,
  onLoadMore,
  targetMessageId,
  onSelectModeChange,
  onExitCompare,
  onQuoteSelection,
}: MessageListProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const loadingMoreTriggeredRef = useRef(false);
  const loadMoreAnchorRef = useRef<{ messageId: string; top: number; messageCount: number } | null>(null);
  const programmaticScrollUntilRef = useRef(0);
  const userScrollOverrideUntilRef = useRef(0);
  const bottomLockRafRef = useRef<number>(0);
  const bottomLockTimersRef = useRef<number[]>([]);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const [userBrowsing, setUserBrowsing] = useState(false);
  const userBrowsingTimerRef = useRef<number>(0);
  const [scrollProgress, setScrollProgress] = useState({ ratio: 1, canScroll: false });
  const [, setScrollProgressDragging] = useState(false);
  const [activeOverviewMessageId, setActiveOverviewMessageId] = useState<string | null>(null);
  const firstItemIndexRef = useRef(100_000);
  const previousVisibleMessagesRef = useRef<Message[]>([]);
  const historyPrependUntilRef = useRef(0);

  const stopBottomLockForUserBrowse = useCallback((duration = 2500) => {
    stickToBottomRef.current = false;
    userScrollOverrideUntilRef.current = Date.now() + duration;
    if (bottomLockRafRef.current) {
      cancelAnimationFrame(bottomLockRafRef.current);
      bottomLockRafRef.current = 0;
    }
    bottomLockTimersRef.current.forEach(window.clearTimeout);
    bottomLockTimersRef.current = [];
  }, []);

  const scrollToBottom = useCallback(() => {
    programmaticScrollUntilRef.current = Date.now() + 320;
    const el = scrollRef.current;
    if (el) {
      const nextTop = Math.ceil(el.scrollHeight - el.clientHeight);
      el.scrollTop = nextTop;
      lastScrollTopRef.current = el.scrollTop;
      return;
    }
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
  }, []);

  const updateScrollProgressFromElement = useCallback((el: HTMLElement | null) => {
    if (!el) {
      setScrollProgress({ ratio: 1, canScroll: false });
      return;
    }
    const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const ratio = maxScrollTop > 0 ? Math.min(1, Math.max(0, el.scrollTop / maxScrollTop)) : 1;
    setScrollProgress((prev) => {
      const canScroll = maxScrollTop > 4;
      if (prev.canScroll === canScroll && Math.abs(prev.ratio - ratio) < 0.004) return prev;
      return { ratio, canScroll };
    });
  }, []);

  const jumpToScrollRatio = useCallback((ratio: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    programmaticScrollUntilRef.current = Date.now() + 480;
    stopBottomLockForUserBrowse(900);
    el.scrollTop = Math.round(maxScrollTop * Math.min(1, Math.max(0, ratio)));
    lastScrollTopRef.current = el.scrollTop;
    updateScrollProgressFromElement(el);
  }, [stopBottomLockForUserBrowse, updateScrollProgressFromElement]);

  const lockBottomAfterLayout = useCallback(() => {
    if (bottomLockRafRef.current) cancelAnimationFrame(bottomLockRafRef.current);
    bottomLockTimersRef.current.forEach(window.clearTimeout);
    bottomLockTimersRef.current = [];

    const lock = () => {
      if (Date.now() < userScrollOverrideUntilRef.current) return;
      if (stickToBottomRef.current) scrollToBottom();
    };

    bottomLockRafRef.current = requestAnimationFrame(() => {
      lock();
      bottomLockRafRef.current = requestAnimationFrame(() => {
        bottomLockRafRef.current = 0;
        lock();
      });
    });

    // Virtuoso 对最后一项换行后的高度测量可能晚于 RAF，补两次 post-layout 锁底，
    // 否则每新增一行会短暂把底部 Composer 顶出一行高。
    bottomLockTimersRef.current = [
      window.setTimeout(lock, 80),
      window.setTimeout(lock, 180),
    ];
  }, [scrollToBottom]);

  const handleVirtuosoScrollerRef = useCallback((ref: Window | HTMLElement | null) => {
    const el = ref instanceof HTMLElement ? (ref as HTMLDivElement) : null;
    scrollRef.current = el;
    if (el) {
      lastScrollTopRef.current = el.scrollTop;
      updateScrollProgressFromElement(el);
    }
  }, [updateScrollProgressFromElement]);

  const handleVirtuosoScroll = useCallback((event: UIEvent<HTMLElement>) => {
    const el = event.currentTarget;
    scrollRef.current = el as HTMLDivElement;

    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isScrollingUp = el.scrollTop < lastScrollTopRef.current;

    // stickToBottom 表示用户意图，只在明确上滑离开底部时关闭；
    // 用户主动上滑时立即打断补偿锁底，避免流式内容继续增长时把视图吸回底部。
    const isProgrammaticScroll = Date.now() < programmaticScrollUntilRef.current;
    if (isScrollingUp && distanceToBottom > 1) {
      stopBottomLockForUserBrowse(isProgrammaticScroll ? 1200 : 2500);
    }
    if (distanceToBottom <= 24) {
      stickToBottomRef.current = true;
      userScrollOverrideUntilRef.current = 0;
    }
    lastScrollTopRef.current = el.scrollTop;
    updateScrollProgressFromElement(el);

    const scrollerTop = el.getBoundingClientRect().top;
    const firstVisibleUserRow = Array.from(el.querySelectorAll<HTMLElement>('[data-chat-message-row="true"][data-message-role="user"]'))
      .find((row) => row.getBoundingClientRect().bottom >= scrollerTop + 8);
    if (firstVisibleUserRow?.dataset.messageId) {
      setActiveOverviewMessageId((previous) => previous === firstVisibleUserRow.dataset.messageId ? previous : firstVisibleUserRow.dataset.messageId || null);
    }

  }, [stopBottomLockForUserBrowse, updateScrollProgressFromElement]);

  const markUserBrowsing = useCallback((duration = 2500) => {
    setUserBrowsing(true);
    if (userBrowsingTimerRef.current) window.clearTimeout(userBrowsingTimerRef.current);
    userBrowsingTimerRef.current = window.setTimeout(() => {
      userBrowsingTimerRef.current = 0;
      setUserBrowsing(false);
    }, duration);
  }, []);

  useEffect(() => () => {
    if (userBrowsingTimerRef.current) window.clearTimeout(userBrowsingTimerRef.current);
  }, []);

  const handleUserScrollIntent = useCallback((deltaY: number) => {
    const el = scrollRef.current;
    if (!el || deltaY >= 0) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceToBottom > 1) {
      stopBottomLockForUserBrowse(2500);
      markUserBrowsing(2500);
      atBottomRef.current = false;
      setAtBottom(false);
    }
  }, [markUserBrowsing, stopBottomLockForUserBrowse]);

  useLayoutEffect(() => {
    const anchor = loadMoreAnchorRef.current;
    const el = scrollRef.current;
    if (!anchor || !el || messages.length <= anchor.messageCount) return;

    const restoreAnchor = () => {
      const row = el.querySelector<HTMLElement>(`[data-message-id="${anchor.messageId}"]`);
      if (!row) return false;
      const delta = row.getBoundingClientRect().top - anchor.top;
      if (Math.abs(delta) > 1) {
        programmaticScrollUntilRef.current = Date.now() + 420;
        stopBottomLockForUserBrowse(1400);
        el.scrollTop += delta;
        lastScrollTopRef.current = el.scrollTop;
        updateScrollProgressFromElement(el);
      }
      return true;
    };

    if (restoreAnchor()) {
      loadMoreAnchorRef.current = null;
      window.requestAnimationFrame(() => restoreAnchor());
      window.setTimeout(restoreAnchor, 80);
    } else {
      const anchorIndex = messages.findIndex((message) => message.id === anchor.messageId);
      if (anchorIndex >= 0) {
        programmaticScrollUntilRef.current = Date.now() + 420;
        stopBottomLockForUserBrowse(1400);
        virtuosoRef.current?.scrollToIndex({ index: anchorIndex, align: "start", behavior: "auto" });
      }
      window.requestAnimationFrame(() => {
        restoreAnchor();
        loadMoreAnchorRef.current = null;
      });
    }
  }, [messages, stopBottomLockForUserBrowse, updateScrollProgressFromElement]);

  useEffect(() => {
    if (!isLoadingMore) {
      loadingMoreTriggeredRef.current = false;
      if (loadMoreAnchorRef.current && messages.length <= loadMoreAnchorRef.current.messageCount) {
        loadMoreAnchorRef.current = null;
      }
    }
  }, [isLoadingMore, messages.length]);

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode | null>(null);
  const selectMode = selectionMode !== null;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [shareSlug, setShareSlug] = useState<string | undefined>(undefined);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);
  const [textSelection, setTextSelection] = useState<TextSelectionFloatingBarState | null>(null);
  const exportCardRef = useRef<HTMLDivElement>(null);
  const exportPreviewCardRef = useRef<HTMLDivElement>(null);
  const handleScrollToBottomClick = useCallback(() => {
    userScrollOverrideUntilRef.current = 0;
    stickToBottomRef.current = true;
    atBottomRef.current = true;
    setAtBottom(true);
    scrollToBottom();
    lockBottomAfterLayout();
  }, [lockBottomAfterLayout, scrollToBottom]);

  const createVirtuosoComponents = useCallback(<T,>(): Components<T, unknown> => ({
    Header: () =>
      hasMoreMessages ? (
        <div className="flex justify-center py-2">
          {isLoadingMore ? (
            <div className="flex items-center gap-2 text-text-secondary text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              加载中...
            </div>
          ) : (
            <button
              onClick={onLoadMore}
              className="text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              加载更多历史消息
            </button>
          )}
        </div>
      ) : null,
    Footer: () => <div style={{ height: CHAT_BOTTOM_SPACER + (selectMode ? SELECT_MODE_EXTRA_SPACER : 0) }} aria-hidden="true" />,
  }), [hasMoreMessages, isLoadingMore, onLoadMore, selectMode]);
  const virtuosoComponents = useMemo(() => createVirtuosoComponents<Message>(), [createVirtuosoComponents]);
  const compareVirtuosoComponents = useMemo(() => createVirtuosoComponents<InferredGroup>(), [createVirtuosoComponents]);
  const groups = useMemo(() => inferGroups(messages), [messages]);
  const groupByMessageId = useMemo(() => {
    const map = new Map<string, InferredGroup>();
    groups.forEach((group) => {
      map.set(group.userMessage.id, group);
      group.assistantMessages.forEach((assistant) => map.set(assistant.id, group));
    });
    return map;
  }, [groups]);

  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const locatedTargetKeyRef = useRef<string>("");
  const loadingTargetKeyRef = useRef<string>("");
  const highlightTimerRef = useRef<number | null>(null);
  const highlightMessage = useCallback((messageId: string, duration = 2200) => {
    setHighlightedMessageId(messageId);
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMessageId((current) => current === messageId ? null : current);
      highlightTimerRef.current = null;
    }, duration);
  }, []);
  const [openAvatarDropdownGroupId, setOpenAvatarDropdownGroupId] = useState<number | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".avatar-dropdown") && !target.closest(".avatar-dropdown-trigger")) {
        setOpenAvatarDropdownGroupId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const visibleMessages = useMemo(() => {
    return messages.filter((msg) => {
      const group = groupByMessageId.get(msg.id);
      if (msg.role !== "user" && group && group.assistantMessages.length > 1) {
        const activeIndex = groupViews?.get(group.id) ?? 0;
        const activeMsg = group.assistantMessages[activeIndex] ?? group.assistantMessages[0];
        return msg.id === activeMsg?.id;
      }
      return true;
    });
  }, [messages, groupByMessageId, groupViews]);

  const userOverviewMessages = useMemo(() => {
    return messages
      .filter((msg) => msg.role === "user" && msg.content.trim().length > 0)
      .map((msg) => ({
        id: msg.id,
        label: normalizeExportPlainText(msg.content).replace(/\s+/g, " ").slice(0, 48) || "用户消息",
      }));
  }, [messages]);

  useEffect(() => {
    if (userOverviewMessages.length === 0) return;
    setActiveOverviewMessageId((current) => current ?? userOverviewMessages[userOverviewMessages.length - 1]?.id ?? null);
  }, [userOverviewMessages]);

  const overviewItems = useMemo<ChatMessageOverviewItem[]>(() => {
    const activeId = activeOverviewMessageId ?? userOverviewMessages[userOverviewMessages.length - 1]?.id ?? "";
    return userOverviewMessages.map((item) => ({
      ...item,
      active: item.id === activeId,
    }));
  }, [activeOverviewMessageId, userOverviewMessages]);

  const jumpToUserMessage = useCallback((messageId: string) => {
    const index = visibleMessages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    programmaticScrollUntilRef.current = Date.now() + 700;
    stopBottomLockForUserBrowse(1600);
    setActiveOverviewMessageId(messageId);
    highlightMessage(messageId, 2400);
    const scrollToTarget = () => {
      virtuosoRef.current?.scrollToIndex({ index, align: "center", behavior: "auto" });
    };
    scrollToTarget();
    window.requestAnimationFrame(() => window.requestAnimationFrame(scrollToTarget));
    window.setTimeout(scrollToTarget, 120);
  }, [highlightMessage, stopBottomLockForUserBrowse, visibleMessages]);

  const previousVisibleMessages = previousVisibleMessagesRef.current;
  if (previousVisibleMessages.length > 0 && visibleMessages.length > previousVisibleMessages.length) {
    const firstPreviousVisibleId = previousVisibleMessages[0]?.id;
    const firstPreviousVisibleIndex = firstPreviousVisibleId
      ? visibleMessages.findIndex((message) => message.id === firstPreviousVisibleId)
      : -1;
    if (firstPreviousVisibleIndex > 0) {
      firstItemIndexRef.current -= firstPreviousVisibleIndex;
      historyPrependUntilRef.current = Date.now() + 1600;
      stopBottomLockForUserBrowse(1600);
    }
  }
  previousVisibleMessagesRef.current = visibleMessages;
  const firstItemIndex = firstItemIndexRef.current;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollProgressFromElement(el);
    const raf = window.requestAnimationFrame(() => updateScrollProgressFromElement(el));
    const timer = window.setTimeout(() => updateScrollProgressFromElement(el), 180);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [messages.length, visibleMessages.length, isLoading, isLoadingMore, updateScrollProgressFromElement]);

  const modelById = useMemo(() => {
    const map = new Map<string, ChatModel>();
    models.forEach((model) => map.set(model.id, model));
    return map;
  }, [models]);
  useEffect(() => {
    if (!targetMessageId) return;
    const targetKey = `${conversationId || "new"}:${targetMessageId}`;
    if (locatedTargetKeyRef.current === targetKey || isLoadingHistory) return;

    const index = visibleMessages.findIndex((msg) => msg.serverMessageId === targetMessageId);
    if (index < 0) {
      if (hasMoreMessages && onLoadMore && !isLoadingMore && loadingTargetKeyRef.current !== targetKey) {
        loadingTargetKeyRef.current = targetKey;
        Promise.resolve(onLoadMore()).finally(() => {
          if (loadingTargetKeyRef.current === targetKey) {
            loadingTargetKeyRef.current = "";
          }
        });
      }
      return;
    }

    const msg = visibleMessages[index];
    locatedTargetKeyRef.current = targetKey;
    loadingTargetKeyRef.current = "";
    stickToBottomRef.current = false;
    programmaticScrollUntilRef.current = Date.now() + 700;
    highlightMessage(msg.id, 2600);

    const scrollToTarget = () => {
      virtuosoRef.current?.scrollToIndex({ index, align: "center", behavior: "auto" });
    };

    const raf = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(scrollToTarget);
    });
    const settleTimer = window.setTimeout(scrollToTarget, 120);

    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(settleTimer);
    };
  }, [conversationId, targetMessageId, visibleMessages, isLoadingHistory, isLoadingMore, hasMoreMessages, onLoadMore, highlightMessage]);

  useEffect(() => {
    if (!targetMessageId) {
      locatedTargetKeyRef.current = "";
      loadingTargetKeyRef.current = "";
    }
  }, [conversationId, targetMessageId]);

  const openedConversationBottomKeyRef = useRef("");
  useEffect(() => {
    if (targetMessageId || isLoadingHistory || messages.length === 0 || Date.now() < historyPrependUntilRef.current) return;
    const key = `${conversationId || "new"}:${messages[0]?.id || ""}:${messages[messages.length - 1]?.id || ""}`;
    if (openedConversationBottomKeyRef.current === key) return;
    openedConversationBottomKeyRef.current = key;

    stickToBottomRef.current = true;
    atBottomRef.current = true;
    userScrollOverrideUntilRef.current = 0;
    setAtBottom(true);
    lockBottomAfterLayout();
  }, [conversationId, targetMessageId, isLoadingHistory, messages, lockBottomAfterLayout]);

  const activeCompareModels = useMemo(() => {
    if (!isCompare) return [];
    return compareModels && compareModels.length > 0
      ? compareModels
      : Array.from(new Set(messages.filter((m) => m.role === "assistant" && m.model).map((m) => m.model!))).slice(0, 2);
  }, [compareModels, isCompare, messages]);
  const columnMessages = useMemo(() => {
    if (!isCompare) return [];
    return activeCompareModels.map((modelId) =>
      messages.filter((msg) => msg.role === "user" || msg.model === modelId)
    );
  }, [activeCompareModels, isCompare, messages]);

  // 收藏功能
  const { addFavorite, isFavorited, checkBatch, loading: favoriteLoading } = useFavorites();

  // 收藏状态只在用户进入收藏选择模式后批量检查，避免 /chat 首屏挂载时触发整页消息的收藏 API/状态扇出。
  useEffect(() => {
    if (selectionMode !== "favorite") return;
    const ids = messages
      .map((m) => m.serverMessageId)
      .filter((id): id is number => typeof id === "number" && id > 0);
    if (ids.length > 0) {
      checkBatch(ids);
    }
  }, [messages, checkBatch, selectionMode]);

  // 读取本地用户信息（必须在条件分支之前调用 Hook）
  const [userName, setUserName] = useState<string>("");
  useEffect(() => {
    try {
      const raw = localStorage.getItem("user");
      if (raw) {
        const parsed = JSON.parse(raw);
        setUserName(parsed.name || parsed.email || "");
      }
    } catch {}
  }, []);

  // 用户发送消息时强制 smooth 滚到底部（排除初始加载）
  const prevLengthRef = useRef(0);
  useEffect(() => {
    if (messages.length > prevLengthRef.current && prevLengthRef.current > 0 && Date.now() >= historyPrependUntilRef.current) {
      const newMessages = messages.slice(prevLengthRef.current);
      if (newMessages.some((m) => m.role === "user")) {
        stickToBottomRef.current = true;
        requestAnimationFrame(() => {
          scrollToBottom();
          requestAnimationFrame(scrollToBottom);
        });
      }
    }
    prevLengthRef.current = messages.length;
  }, [messages, scrollToBottom]);

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
  }, []);

  const copyText = useCallback(async (content: string, successMessage = "已复制") => {
    await navigator.clipboard.writeText(content);
    toast.success(successMessage);
  }, []);

  const formatQuoteText = useCallback((content: string) => {
    return content
      .trim()
      .split(/\r?\n/)
      .map((line) => `> ${line}`)
      .join("\n");
  }, []);

  const clearTextSelection = useCallback(() => {
    setTextSelection(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const handleCopySelectedText = useCallback(async () => {
    if (!textSelection?.text) return;
    await copyText(textSelection.text, "已复制选中文本");
    clearTextSelection();
  }, [clearTextSelection, copyText, textSelection]);

  const handleCopySelectedQuote = useCallback(async () => {
    if (!textSelection?.text) return;
    const quote = formatQuoteText(textSelection.text);
    if (onQuoteSelection) {
      onQuoteSelection(quote);
      toast.success("已插入引用");
    } else {
      await copyText(quote, "已复制为引用");
    }
    clearTextSelection();
  }, [clearTextSelection, copyText, formatQuoteText, onQuoteSelection, textSelection]);

  const updateTextSelection = useCallback(() => {
    const selection = window.getSelection();
    const rawText = selection?.toString().trim() || "";
    if (!selection || selection.rangeCount === 0 || rawText.length < 2 || selectMode) {
      setTextSelection(null);
      return;
    }

    const anchorNode = selection.anchorNode;
    const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement;
    if (!anchorElement?.closest('[data-chat-message-row="true"]')) {
      setTextSelection(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      setTextSelection(null);
      return;
    }

    setTextSelection({
      text: rawText.slice(0, 5000),
      top: Math.max(8, rect.top - 48),
      left: Math.min(window.innerWidth - 120, Math.max(120, rect.left + rect.width / 2)),
    });
  }, [selectMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-testid="chat-text-selection-bar"]')) return;
      setTextSelection(null);
    };
    document.addEventListener("selectionchange", updateTextSelection);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("selectionchange", updateTextSelection);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [updateTextSelection]);

  const getPairedMessageIds = useCallback((msgId: string) => {
    const ids = new Set<string>();
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return ids;

    const group = groupByMessageId.get(msg.id);
    if (group) {
      ids.add(group.userMessage.id);
      if (msg.role === "assistant") {
        ids.add(msg.id);
      } else {
        const activeIndex = groupViews?.get(group.id) ?? 0;
        const activeAssistant = group.assistantMessages[activeIndex] ?? group.assistantMessages[0];
        if (activeAssistant) ids.add(activeAssistant.id);
      }
      return ids;
    }

    const index = messages.findIndex((m) => m.id === msgId);
    ids.add(msg.id);
    if (msg.role === "user") {
      const pair = messages.slice(index + 1).find((m) => m.role === "assistant");
      if (pair) ids.add(pair.id);
    } else if (msg.role === "assistant") {
      const pair = [...messages.slice(0, index)].reverse().find((m) => m.role === "user");
      if (pair) ids.add(pair.id);
    }
    return ids;
  }, [messages, groupByMessageId, groupViews]);

  const selectedMessages = useMemo(
    () => messages.filter((m) => selectedIds.has(m.id)),
    [messages, selectedIds]
  );
  const allSelected = messages.length > 0 && messages.every((m) => selectedIds.has(m.id));

  const toggleSelectAll = useCallback(() => {
    const allIds = new Set(messages.map((m) => m.id));
    setSelectedIds(allSelected ? new Set() : allIds);
  }, [allSelected, messages]);

  const toggleSelect = (msgId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const index = messages.findIndex((m) => m.id === msgId);
      const msg = messages[index];
      if (!msg) return prev;

      // 切换当前消息
      if (next.has(msg.id)) next.delete(msg.id);
      else next.add(msg.id);

      // 连带切换配对消息（同一轮次的问题和回答）
      if (msg.role === "user" && index + 1 < messages.length) {
        const pair = messages[index + 1];
        if (pair?.role === "assistant") {
          if (next.has(msg.id)) next.add(pair.id);
          else next.delete(pair.id);
        }
      } else if (msg.role === "assistant" && index > 0) {
        const pair = messages[index - 1];
        if (pair?.role === "user") {
          if (next.has(msg.id)) next.add(pair.id);
          else next.delete(pair.id);
        }
      }

      return next;
    });
  };

  const enterSelectMode = (mode: SelectionMode, msgId?: string) => {
    setSelectionMode(mode);
    setSelectedIds(msgId ? getPairedMessageIds(msgId) : new Set());
    onSelectModeChange?.(true);
  };

  const exitSelectMode = () => {
    setSelectionMode(null);
    setSelectedIds(new Set());
    setExportPreviewOpen(false);
    onSelectModeChange?.(false);
  };

  const handleShareSelected = async () => {
    if (!conversationId || selectedIds.size === 0) return;
    const token = localStorage.getItem("token");
    if (!token) return;

    setSharing(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/share`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ selected_messages: Array.from(selectedIds) }),
      });
      if (res.ok) {
        const data = await res.json();
        setShareSlug(data.slug);
        setShareOpen(true);
      }
    } catch {}
    setSharing(false);
  };

  const handleFavoriteSelected = async () => {
    if (!conversationId || selectedIds.size === 0 || favoriteLoading) return;
    const token = localStorage.getItem("token");
    if (!token) {
      toast.warning("请先登录后收藏");
      return;
    }

    const selectedServerIds = messages
      .filter((m) => m.role === "assistant" && selectedIds.has(m.id))
      .map((m) => m.serverMessageId)
      .filter((id): id is number => typeof id === "number" && id > 0 && !isFavorited(id));

    const uniqueIds = Array.from(new Set(selectedServerIds));
    if (uniqueIds.length === 0) return;

    let successCount = 0;
    for (const messageId of uniqueIds) {
      const ok = await addFavorite(messageId, conversationId, { silent: true });
      if (ok) successCount += 1;
    }
    if (successCount > 0) {
      toast.success("已收藏");
    }
  };

  const handleExportImage = async () => {
    if (selectedIds.size === 0) return;
    setExportPreviewOpen(true);
  };

  const handleDownloadImage = async () => {
    const exportNode = exportPreviewCardRef.current || exportCardRef.current;
    if (selectedIds.size === 0 || !exportNode) return;
    setExporting(true);
    try {
      await document.fonts?.ready;
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(exportNode, {
        quality: 1.0,
        pixelRatio: 2,
        backgroundColor: "#0f172a",
        cacheBust: true,
      });
      const link = document.createElement("a");
      link.download = `AI-Space-share-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
      setExportPreviewOpen(false);
    } catch (e) {
      console.error("Export image failed:", e);
    }
    setExporting(false);
  };


  const handleExportText = () => {
    if (selectedIds.size === 0) return;
    const selectedMessages = messages.filter((m) => selectedIds.has(m.id));
    const exportedAt = new Date().toLocaleString("zh-CN", { hour12: false });
    const separator = "\n\n────────────────────────\n\n";
    const text = [
      "AI Space 对话导出",
      `导出时间：${exportedAt}`,
      `消息数量：${selectedMessages.length}`,
      "",
      selectedMessages.map((msg, index) => formatMessageForTextExport(msg, index, selectedMessages.length)).join(separator),
      "",
    ].join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `AI-Space-chat-${Date.now()}.txt`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  const lastVisibleMessage = visibleMessages[visibleMessages.length - 1];
  const lastVisibleIsStreaming = !!lastVisibleMessage && lastVisibleMessage.role === "assistant" && isMessageGenerating(lastVisibleMessage, isLoading && !lastVisibleMessage.completedAt);
  const streamingMessageId = lastVisibleIsStreaming ? lastVisibleMessage.id : "";
  const streamingText = useMessageStream(streamingMessageId, !!streamingMessageId);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !streamingMessageId) return;

    const observer = new MutationObserver(() => {
      if (!stickToBottomRef.current) return;
      lockBottomAfterLayout();
    });

    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [streamingMessageId, lockBottomAfterLayout]);

  // SSE 流式输出是同一条消息内容持续变高，不一定改变 messages 引用；
  // 用流式文本长度触发，并只在用户仍贴近底部时跟随。
  const rafRef = useRef<number>(0);
  useEffect(() => {
    if (!streamingMessageId || !stickToBottomRef.current) return;

    lockBottomAfterLayout();
    const timeout = window.setTimeout(lockBottomAfterLayout, 120);
    return () => {
      window.clearTimeout(timeout);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      if (bottomLockRafRef.current) {
        cancelAnimationFrame(bottomLockRafRef.current);
        bottomLockRafRef.current = 0;
      }
      bottomLockTimersRef.current.forEach(window.clearTimeout);
      bottomLockTimersRef.current = [];
    };
  }, [streamingMessageId, streamingText.length, lockBottomAfterLayout]);


  const renderCompareModelHeader = (modelId: string, index: number) => {
    const model = modelById.get(modelId);
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <div className="flex-1 min-w-0">
          {model ? (
            <ModelSelector
              models={models}
              selected={model}
              onSelect={(nextModel) => onCompareModelChange?.(index, nextModel.id)}
            />
          ) : (
            <div className="rounded-lg px-2 py-1 text-sm font-medium text-text-secondary">{modelId || `模型 ${index + 1}`}</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onExitCompare?.()}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-surface-card hover:text-text-primary"
          aria-label={t("chat.closeCompareColumn")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  };

  const renderCompareWelcome = (modelId: string, index: number) => (
    <div className="flex min-h-[360px] flex-col overflow-hidden">
      {renderCompareModelHeader(modelId, index)}
      <div className="flex-1 px-8 pb-10 pt-20">
        <h2 className="text-3xl font-semibold tracking-tight text-text-primary">{t("chat.helloComma")}</h2>
        <p className="mt-3 text-xl font-medium text-text-primary">{t("chat.howCanIHelp")}</p>
      </div>
    </div>
  );

  const renderCompareWelcomeContent = (modelId: string, index: number) => (
    <div className="flex min-h-[360px] flex-col">
      <div className="flex-1 px-8 pb-10 pt-20">
        <h2 className="text-3xl font-semibold tracking-tight text-text-primary">{t("chat.helloComma")}</h2>
        <p className="mt-3 text-xl font-medium text-text-primary">{t("chat.howCanIHelp")}</p>
      </div>
    </div>
  );

  const renderHistoryLoadingState = () => <ChatHistoryLoadingState />;

  const historyLoadingComponents = useMemo(() => ({
    Header: renderHistoryLoadingState,
    Footer: () => <div style={{ height: CHAT_BOTTOM_SPACER + (selectMode ? SELECT_MODE_EXTRA_SPACER : 0) }} aria-hidden="true" />,
  }), [selectMode]);

  if (isCompare) {
    const compareGroups = groups;
    const resolveCompareAssistant = (group: InferredGroup, colIndex: number, modelId: string) => {
      const hasSlotSnapshot = group.assistantMessages.some((m) => typeof m.groupIndex === "number");
      if (hasSlotSnapshot) {
        return group.assistantMessages.find((m) => m.groupIndex === colIndex);
      }

      return group.assistantMessages.find((m) => group.models[m.groupIndex ?? -1] === modelId)
        || group.assistantMessages.find((m) => m.model === modelId)
        || group.assistantMessages[colIndex];
    };


    return (
      <div className="relative flex-1 min-h-0 overflow-hidden flex flex-col">
        {/* 固定模型选择栏 */}
        <div className="flex w-full shrink-0">
          {(activeCompareModels.length ? activeCompareModels : compareModels).map((modelId, colIndex) => (
            <div key={modelId || colIndex} className="flex min-w-[320px] flex-1 flex-col">
              {renderCompareModelHeader(modelId, colIndex)}
            </div>
          ))}
        </div>
        {/* 滚动内容区域：对比模式也使用 Virtuoso，和单聊共享滚动/锁底体系 */}
        {messages.length === 0 ? (
          isLoadingHistory ? (
            <Virtuoso
              style={{ height: "100%", overflowAnchor: "none" }}
              data={[] as InferredGroup[]}
              ref={virtuosoRef}
              scrollerRef={handleVirtuosoScrollerRef}
              followOutput={false}
              computeItemKey={(_, group) => group.id}
              onScroll={handleVirtuosoScroll}
              components={historyLoadingComponents}
              itemContent={() => null}
            />
          ) : (
            <div className="flex-1 overflow-hidden px-3 py-3">
              <div className="mx-auto flex h-full max-w-[1440px]">
                {(activeCompareModels.length ? activeCompareModels : compareModels).map((modelId, index) => (
                  <div key={modelId || index} className="flex min-w-[320px] flex-1 flex-col border-r border-surface-border last:border-r-0">
                    {renderCompareWelcomeContent(modelId, index)}
                  </div>
                ))}
              </div>
            </div>
          )
        ) : (
          <Virtuoso
            style={{ height: "100%", overflowAnchor: userBrowsing ? "none" : "auto" }}
            data={compareGroups}
            ref={virtuosoRef}
            scrollerRef={handleVirtuosoScrollerRef}
            followOutput={false}
            atBottomThreshold={AT_BOTTOM_THRESHOLD}
            atBottomStateChange={(atBottom) => {
              atBottomRef.current = atBottom;
              if (atBottom && Date.now() >= userScrollOverrideUntilRef.current) stickToBottomRef.current = true;
              setAtBottom(atBottom);
            }}
            computeItemKey={(_, group) => group.id}
            onScroll={handleVirtuosoScroll}
            onWheel={(event) => handleUserScrollIntent(event.deltaY)}
            onTouchMove={() => stopBottomLockForUserBrowse(2500)}
            increaseViewportBy={{ top: 200, bottom: CHAT_BOTTOM_SPACER }}
            overscan={{ main: 2, reverse: 2 }}
            components={compareVirtuosoComponents}
            itemContent={(groupIndex, group) => (
              <ChatCompareGroupRow
                group={group}
                groupIndex={groupIndex}
                groupCount={compareGroups.length}
                compareModels={activeCompareModels.length ? activeCompareModels : compareModels}
                resolveAssistant={resolveCompareAssistant}
                modelById={modelById}
                isLoading={isLoading}
                isComplexTask={!!isComplexTask}
                conversationId={conversationId}
                deepReasoningLabel={t("chat.deepReasoning")}
                imageLoadFailedLabel={t("chat.imageLoadFailed")}
                MarkdownRenderer={LazyMarkdownRenderer}
                onCopy={handleCopy}
                onDelete={setDeleteTarget}
                onRegenerate={onRegenerate}
                onShareSelectMode={(id) => enterSelectMode("share", id)}
                onFavoriteSelectMode={(id) => enterSelectMode("favorite", id)}
                isFavorited={isFavorited}
                onForkCompare={onForkCompare}
              />
            )}
          />
        )}

        <ChatScrollProgress
          scrollRatio={scrollProgress.ratio}
          visible={scrollProgress.canScroll}
          onJumpToRatio={jumpToScrollRatio}
          onDragStateChange={setScrollProgressDragging}
        />
        <ChatScrollToBottomButton
          visible={!atBottom}
          bottomOffset={SCROLL_TO_BOTTOM_OFFSET + (selectMode ? SELECT_MODE_EXTRA_SPACER : 0)}
          onClick={handleScrollToBottomClick}
        />

        <ConfirmDialog
          isOpen={!!deleteTarget}
          title={t("chat.deleteMessageTitle")}
          description={t("chat.deleteMessageDesc")}
          confirmText={t("common.delete")}
          cancelText={t("common.cancel")}
          variant="danger"
          onConfirm={() => {
            if (deleteTarget && onDeleteMessage) onDeleteMessage(deleteTarget);
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
        <ShareDialog isOpen={shareOpen} slug={shareSlug} onClose={() => setShareOpen(false)} />
      </div>
    );
  }

  if (messages.length === 0) {
    if (isLoadingHistory) {
      return (
        <div className="relative flex-1 min-h-0 overflow-hidden">
          <Virtuoso
            style={{ height: "100%", overflowAnchor: "none" }}
            data={[] as Message[]}
            ref={virtuosoRef}
            scrollerRef={handleVirtuosoScrollerRef}
            followOutput={false}
            computeItemKey={(_, msg) => msg.id}
            onScroll={handleVirtuosoScroll}
            components={historyLoadingComponents}
            itemContent={() => null}
          />
        </div>
      );
    }
    return (
      <ChatEmptyState
        userName={userName}
        greeting={t("chat.greeting")}
        userGreetingTemplate={t("chat.userGreeting")}
        whatCanWeDoLabel={t("chat.whatCanWeDo")}
        welcomeTitle={welcomeTitle}
        welcomeSubtitle={welcomeSubtitle}
        welcomeExamples={welcomeExamples}
        bottomSpacer={CHAT_BOTTOM_SPACER}
      />
    );
  }

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden">
      <Virtuoso
        style={{ height: "100%", overflowAnchor: userBrowsing ? "none" : "auto" }}
        data={visibleMessages}
        firstItemIndex={firstItemIndex}
        ref={virtuosoRef}
        scrollerRef={handleVirtuosoScrollerRef}
        followOutput={false}
        atBottomThreshold={AT_BOTTOM_THRESHOLD}
        atBottomStateChange={(atBottom) => {
          atBottomRef.current = atBottom;
          if (atBottom && Date.now() >= userScrollOverrideUntilRef.current) stickToBottomRef.current = true;
          setAtBottom(atBottom);
        }}
        computeItemKey={(_, msg) => msg.id}
        onScroll={handleVirtuosoScroll}
        startReached={() => {
          const el = scrollRef.current;
          if (!el || isLoadingMore || !hasMoreMessages || loadingMoreTriggeredRef.current) return;
          loadingMoreTriggeredRef.current = true;
          const firstVisibleRow = Array.from(el.querySelectorAll<HTMLElement>('[data-chat-message-row="true"]'))
            .find((row) => row.getBoundingClientRect().bottom >= el.getBoundingClientRect().top + 8);
          const messageId = firstVisibleRow?.dataset.messageId;
          if (messageId && firstVisibleRow) {
            loadMoreAnchorRef.current = {
              messageId,
              top: firstVisibleRow.getBoundingClientRect().top,
              messageCount: messages.length,
            };
          }
          stopBottomLockForUserBrowse(1800);
          onLoadMore?.();
        }}
        onWheel={(event) => handleUserScrollIntent(event.deltaY)}
        onTouchMove={() => stopBottomLockForUserBrowse(2500)}
        increaseViewportBy={{ top: 200, bottom: CHAT_BOTTOM_SPACER }}
        overscan={{ main: 2, reverse: 2 }}
        components={virtuosoComponents}
        itemContent={(index, msg) => {
          const group = groupByMessageId.get(msg.id);
          const model = msg.model ? modelById.get(msg.model) : undefined;
          const isSelected = selectedIds.has(msg.id);
          const isHighlighted = highlightedMessageId === msg.id;

          return (
            <ChatMessageListItem
              index={index}
              message={msg}
              visibleMessageCount={visibleMessages.length}
              group={group}
              model={model}
              isLoading={isLoading}
              selectMode={selectMode}
              isSelected={isSelected}
              isHighlighted={isHighlighted}
              conversationId={conversationId}
              groupViews={groupViews}
              modelById={modelById}
              openAvatarDropdownGroupId={openAvatarDropdownGroupId}
              setOpenAvatarDropdownGroupId={setOpenAvatarDropdownGroupId}
              switchGroupModel={switchGroupModel}
              toggleSelect={toggleSelect}
              handleCopy={handleCopy}
              setDeleteTarget={setDeleteTarget}
              enterSelectMode={enterSelectMode}
              isFavorited={isFavorited}
              onRegenerate={onRegenerate}
              onContinueGenerate={onContinueGenerate}
              onForkCompare={onForkCompare}
              imageLoadFailedLabel={t("chat.imageLoadFailed")}
              MarkdownRenderer={LazyMarkdownRenderer}
            />
          );
        }}
      />

      <ChatMessageOverview
        items={overviewItems}
        visible={!selectMode && !isCompare && overviewItems.length >= 2}
        onJumpToMessage={jumpToUserMessage}
      />
      <ChatScrollProgress
        scrollRatio={scrollProgress.ratio}
        visible={scrollProgress.canScroll}
        onJumpToRatio={jumpToScrollRatio}
        onDragStateChange={setScrollProgressDragging}
      />
      <ChatScrollToBottomButton
        visible={!atBottom}
        bottomOffset={SCROLL_TO_BOTTOM_OFFSET + (selectMode ? SELECT_MODE_EXTRA_SPACER : 0)}
        onClick={handleScrollToBottomClick}
      />

      <ChatSelectionOverlays
        textSelection={textSelection}
        onCopySelectedText={handleCopySelectedText}
        onCopySelectedQuote={handleCopySelectedQuote}
        selectMode={selectMode}
        selectionMode={selectionMode}
        selectedCount={selectedIds.size}
        selectedMessages={selectedMessages}
        allSelected={allSelected}
        sharing={sharing}
        exporting={exporting}
        favoriteLoading={favoriteLoading}
        shareOpen={shareOpen}
        shareSlug={shareSlug}
        exportPreviewOpen={exportPreviewOpen}
        exportPreviewCardRef={exportPreviewCardRef}
        exportCardRef={exportCardRef}
        onCancelSelection={exitSelectMode}
        onToggleSelectAll={toggleSelectAll}
        onConfirmShare={handleShareSelected}
        onConfirmFavorite={handleFavoriteSelected}
        onExportImage={handleExportImage}
        onExportText={handleExportText}
        onCloseShare={() => setShareOpen(false)}
        onCloseExportPreview={() => setExportPreviewOpen(false)}
        onDownloadImage={handleDownloadImage}
      />

      {/* 删除消息确认弹窗 */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title={t("chat.deleteMessageTitle")}
        description={t("chat.deleteMessageDesc")}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        variant="danger"
        onConfirm={() => {
          if (deleteTarget && onDeleteMessage) onDeleteMessage(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

    </div>
  );
}

export default memo(MessageList);

