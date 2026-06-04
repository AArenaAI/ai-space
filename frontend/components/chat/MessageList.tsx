"use client";

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, memo, type ComponentType, type UIEvent } from "react";
import { cn } from "@/lib/utils";
import { Message, ChatModel } from "@/lib/chatTypes";
import { useFavorites } from "@/hooks/useFavorites";
import { toast } from "sonner";
import dynamic from "next/dynamic";
const ShareDialog = dynamic(() => import("@/components/ui/ShareDialog"), { ssr: false });
import { Virtuoso, VirtuosoHandle, type Components } from "react-virtuoso";
import { useMessageStream } from "@/hooks/useMessageStream";
import { inferGroups, InferredGroup } from "@/lib/groups";
import { useI18n } from "@/lib/i18n";
import { DeferredMarkdownRenderer } from "./DeferredMarkdownRenderer";
import MarkdownPlainFallback from "./markdown/MarkdownPlainFallback";

type MarkdownRendererProps = { content: string; isStreaming?: boolean; shouldHydrateRichText?: boolean; priorityHydrateRichText?: boolean; allowRichLiteFallback?: boolean; compactRichLitePreview?: boolean };
let markdownRendererPromise: Promise<{ default: ComponentType<MarkdownRendererProps> }> | null = null;
let MarkdownRendererModule: ComponentType<MarkdownRendererProps> | null = null;

function loadMarkdownRenderer() {
  if (!markdownRendererPromise) {
    markdownRendererPromise = import("./MarkdownRenderer").then((module) => {
      MarkdownRendererModule = module.default;
      return { default: module.default as ComponentType<MarkdownRendererProps> };
    });
  }
  return markdownRendererPromise;
}

function LoadableMarkdownRenderer(props: MarkdownRendererProps) {
  const { content } = props;
  const [Renderer, setRenderer] = useState(() => MarkdownRendererModule);

  useEffect(() => {
    if (Renderer) return;
    let cancelled = false;
    loadMarkdownRenderer().then((module) => {
      if (!cancelled) setRenderer(() => module.default);
    });
    return () => {
      cancelled = true;
    };
  }, [Renderer]);

  if (!Renderer) {
    return <MarkdownPlainFallback content={content} />;
  }

  return <Renderer {...props} />;
}
import ChatMessageListItem from "./ChatMessageListItem";
import ChatCompareGroupRow from "./ChatCompareGroupRow";
import ChatCompareHeader from "./ChatCompareHeader";
import ChatCompareWelcomeColumns from "./ChatCompareWelcomeColumns";
import { type TextSelectionFloatingBarState } from "./TextSelectionFloatingBar";
import ChatScrollProgress from "./ChatScrollProgress";
import ChatMessageOverview, { type ChatMessageOverviewItem } from "./ChatMessageOverview";
import ChatSelectionOverlays from "./ChatSelectionOverlays";
import ChatScrollToBottomButton from "./ChatScrollToBottomButton";
import ChatHistoryLoadingState from "./ChatHistoryLoadingState";
import ChatHistoryLoadingVirtuoso from "./ChatHistoryLoadingVirtuoso";
import ChatEmptyState from "./ChatEmptyState";
import ChatDeleteMessageDialog from "./ChatDeleteMessageDialog";
import { parseThinkContent, sanitizeContent, isMessageGenerating } from "@/lib/chatContent";


const CHAT_BOTTOM_SPACER = 280;
const SCROLL_TO_BOTTOM_OFFSET = 238;
const AT_BOTTOM_THRESHOLD = 24;
const SELECT_MODE_EXTRA_SPACER = 80;
const LONG_MARKDOWN_LAZY_THRESHOLD = 0;
const HISTORY_PRELOAD_TOP_PX = 1200;
const HISTORY_PRELOAD_BOTTOM_PX = CHAT_BOTTOM_SPACER;
const FAST_SCROLL_PRELOAD_PX = 6000;
const RETURN_TO_BOTTOM_PRELOAD_BOTTOM_PX = 6000;
const HISTORY_OVERSCAN_REVERSE = 8;
const INITIAL_RENDERED_MESSAGE_WINDOW = 16;
const CONTENT_HEAVY_INITIAL_RENDERED_MESSAGE_WINDOW = 32;
const MAX_STABLE_RICH_LITE_ASSISTANTS_IN_RENDER_WINDOW = 16;
const MESSAGE_WINDOW_PAGE_SIZE = 8;
const MIN_HIDDEN_MESSAGES_TO_WINDOW = 8;
const CONTENT_HEAVY_TOTAL_CHARS_THRESHOLD = 24_000;
const CONTENT_HEAVY_CODE_BLOCK_THRESHOLD = 24;
const CONTENT_HEAVY_TABLE_LINE_THRESHOLD = 80;
type SelectionMode = "share" | "favorite";

function emitChatRenderProfileEvent(
  phase: string,
  detail: { conversationId?: number; messageCount?: number; visibleMessageCount?: number; durationMs?: number } = {}
) {
  if (typeof window === "undefined") return;
  const at = typeof performance !== "undefined" ? performance.now() : Date.now();
  window.dispatchEvent(new CustomEvent("chat-render-profile", { detail: { phase, at, ...detail } }));
}


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

function normalizeExportPlainText(content: string, t: (key: string, params?: Record<string, string>) => string): string {
  return content
    .replace(/```([\w-]+)?\n([\s\S]*?)```/g, (_match, lang, code) => {
      const label = lang ? t("chat.export.codeWithLanguage", { language: String(lang) }) : t("chat.export.code");
      return `\n【${label}】\n${String(code).trim()}\n【${t("chat.export.codeEnd")}】\n`;
    })
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1（$2）")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, t("chat.export.quotePrefix"))
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

function formatMessageForTextExport(
  msg: Message,
  index: number,
  total: number,
  t: (key: string, params?: Record<string, string>) => string,
): string {
  const roleLabel = msg.role === "user" ? t("chat.export.userRole") : t("chat.export.assistantRole");
  const title = `【${index + 1}/${total} ${roleLabel}】`;

  if (msg.role === "user") {
    const content = normalizeExportPlainText(msg.content || "", t);
    return `${title}\n${content || t("chat.export.emptyMessage")}`;
  }

  const { reasoning, answer, isThinking } = parseThinkContent(msg.content || "");
  const cleanAnswer = normalizeExportPlainText(sanitizeContent(answer), t);
  const cleanReasoning = reasoning ? normalizeExportPlainText(reasoning, t) : "";
  const sections: string[] = [title];

  if (cleanReasoning) {
    sections.push(`【${isThinking ? t("chat.export.reasoningInProgress") : t("chat.export.reasoning")}】\n${cleanReasoning}`);
  }

  sections.push(`【${t("chat.export.answer")}】\n${cleanAnswer || t("chat.export.emptyAnswer")}`);
  return sections.join("\n\n");
}

function getMessageContentWeight(messages: Message[]) {
  let totalChars = 0;
  let codeBlocks = 0;
  let tableLines = 0;
  messages.forEach((message) => {
    const content = message.content || "";
    totalChars += content.length;
    codeBlocks += Math.floor((content.match(/```/g)?.length || 0) / 2);
    tableLines += content.split("\n").filter((line) => /^\s*\|.+\|\s*$/.test(line)).length;
  });
  return { codeBlocks, tableLines, totalChars };
}

const MemoMarkdownRenderer = memo(function MemoMarkdownRenderer(props: MarkdownRendererProps) {
  return <LoadableMarkdownRenderer {...props} />;
});

function LazyMarkdownRenderer({ content, shouldHydrateRichText = true, priorityHydrateRichText = false, allowRichLiteFallback = false, compactRichLitePreview = true }: MarkdownRendererProps) {
  if (content.length < LONG_MARKDOWN_LAZY_THRESHOLD) {
    return <MemoMarkdownRenderer content={content} shouldHydrateRichText={shouldHydrateRichText} priorityHydrateRichText={priorityHydrateRichText} allowRichLiteFallback={allowRichLiteFallback} compactRichLitePreview={compactRichLitePreview} />;
  }

  return <DeferredMarkdownRenderer content={content} shouldHydrateRichText={shouldHydrateRichText} priorityHydrateRichText={priorityHydrateRichText} allowRichLiteFallback={allowRichLiteFallback} compactRichLitePreview={compactRichLitePreview} />;
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
  const { t, language } = useI18n();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const loadingMoreTriggeredRef = useRef(false);
  const loadMoreAnchorRef = useRef<{ messageId: string; top: number; messageCount: number; source?: "local-window" | "remote-history" } | null>(null);
  const localWindowReleaseAwaitingScrollAwayRef = useRef(false);
  const localWindowReleasedRef = useRef(false);
  const localWindowReleaseIntentUntilRef = useRef(0);
  const localWindowReleaseStateRef = useRef({
    hasHiddenLocalMessages: false,
    visibleMessageCount: 0,
    allVisibleMessageCount: 0,
    firstVisibleMessageId: "",
  });
  const programmaticScrollUntilRef = useRef(0);
  const userScrollOverrideUntilRef = useRef(0);
  const bottomLockIntentUntilRef = useRef(0);
  const bottomLockRafRef = useRef<number>(0);
  const bottomLockTimersRef = useRef<number[]>([]);
  const bottomSmoothRafRef = useRef<number>(0);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const [userBrowsing, setUserBrowsing] = useState(false);
  const userBrowsingTimerRef = useRef<number>(0);
  const [scrollProgress, setScrollProgress] = useState({ ratio: 1, canScroll: false });
  const [, setScrollProgressDragging] = useState(false);
  const [returnToBottomPreload, setReturnToBottomPreload] = useState(false);
  const [fastScrollPreload, setFastScrollPreload] = useState(false);
  const [renderedMessageWindow, setRenderedMessageWindow] = useState(INITIAL_RENDERED_MESSAGE_WINDOW);
  const [historyPrependSettling, setHistoryPrependSettling] = useState(false);
  const [historyRichLiteFallbackMessageIds, setHistoryRichLiteFallbackMessageIds] = useState<Set<string>>(() => new Set());
  const fastScrollPreloadTimerRef = useRef<number>(0);
  const historyPrependSettlingTimerRef = useRef<number>(0);
  const historyRichLiteFallbackTimerRef = useRef<number>(0);
  const [activeOverviewMessageId, setActiveOverviewMessageId] = useState<string | null>(null);
  const overviewJumpActiveRef = useRef<{ id: string; until: number } | null>(null);
  const overviewBottomLockUntilRef = useRef(0);
  const userOverviewMessagesRef = useRef<{ id: string; label: string }[]>([]);
  const firstItemIndexRef = useRef(100_000);
  const previousAllVisibleMessagesRef = useRef<Message[]>([]);
  const previousVisibleMessagesRef = useRef<Message[]>([]);
  const historyPrependUntilRef = useRef(0);
  const openedConversationBottomKeyRef = useRef("");
  const lastConversationIdRef = useRef<number | string | undefined>(conversationId);
  const renderStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();

  const stopBottomLockForUserBrowse = useCallback((duration = 2500) => {
    stickToBottomRef.current = false;
    userScrollOverrideUntilRef.current = Date.now() + duration;
    bottomLockIntentUntilRef.current = 0;
    if (bottomLockRafRef.current) {
      cancelAnimationFrame(bottomLockRafRef.current);
      bottomLockRafRef.current = 0;
    }
    if (bottomSmoothRafRef.current) {
      cancelAnimationFrame(bottomSmoothRafRef.current);
      bottomSmoothRafRef.current = 0;
    }
    bottomLockTimersRef.current.forEach(window.clearTimeout);
    bottomLockTimersRef.current = [];
    setReturnToBottomPreload(false);
  }, []);

  const scrollToBottom = useCallback((behavior: "auto" | "smooth" = "auto") => {
    programmaticScrollUntilRef.current = Date.now() + 320;
    const el = scrollRef.current;
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior });
    if (el) {
      const nextTop = Math.ceil(el.scrollHeight - el.clientHeight);
      if (behavior === "smooth") {
        el.scrollTo({ top: nextTop, behavior: "smooth" });
      } else {
        el.scrollTop = nextTop;
      }
      lastScrollTopRef.current = el.scrollTop;
    }
  }, []);

  const lockBottomAfterSmoothScroll = useCallback(() => {
    bottomLockTimersRef.current.forEach(window.clearTimeout);
    bottomLockTimersRef.current = [2600].map((delay) => window.setTimeout(() => {
      if (Date.now() < userScrollOverrideUntilRef.current) return;
      const el = scrollRef.current;
      if (!el || !stickToBottomRef.current) return;
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distanceToBottom > 8) {
        setReturnToBottomPreload(false);
        return;
      }
      const nextTop = Math.ceil(el.scrollHeight - el.clientHeight);
      el.scrollTop = nextTop;
      lastScrollTopRef.current = el.scrollTop;
      setReturnToBottomPreload(false);
    }, delay));
  }, []);

  const smoothScrollScrollerToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      scrollToBottom("smooth");
      return;
    }
    if (bottomSmoothRafRef.current) {
      cancelAnimationFrame(bottomSmoothRafRef.current);
      bottomSmoothRafRef.current = 0;
    }
    const startTop = el.scrollTop;
    const initialTargetTop = Math.ceil(el.scrollHeight - el.clientHeight);
    const initialDistance = Math.max(0, initialTargetTop - startTop);
    const duration = Math.min(4200, Math.max(900, initialDistance / 3));
    const maxDuration = duration + 2200;
    const startedAt = performance.now();
    programmaticScrollUntilRef.current = Date.now() + maxDuration + 400;

    const step = (now: number) => {
      const elapsed = now - startedAt;
      const targetTop = Math.ceil(el.scrollHeight - el.clientHeight);
      const remaining = targetTop - el.scrollTop;

      if (remaining <= 1) {
        el.scrollTop = targetTop;
        lastScrollTopRef.current = el.scrollTop;
        bottomSmoothRafRef.current = 0;
        setReturnToBottomPreload(false);
        return;
      }

      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const desiredTop = Math.min(targetTop, startTop + Math.max(0, targetTop - startTop) * eased);
      const currentTop = el.scrollTop;
      // Keep the programmatic button scroll slow enough for Virtuoso to
      // continuously remeasure/re-window. Larger per-frame jumps can leave a
      // transient frame where mounted rows exist but none intersect the viewport,
      // which reads as a message flash even though the list is not blank.
      const maxFrameDelta = 60;
      const cappedTop = Math.abs(desiredTop - currentTop) > maxFrameDelta
        ? currentTop + Math.sign(desiredTop - currentTop) * maxFrameDelta
        : desiredTop;
      el.scrollTop = Math.min(targetTop, Math.round(cappedTop));
      lastScrollTopRef.current = el.scrollTop;

      const nextRemaining = Math.ceil(el.scrollHeight - el.clientHeight) - el.scrollTop;
      if ((progress < 1 || nextRemaining > 1) && elapsed < maxDuration) {
        bottomSmoothRafRef.current = requestAnimationFrame(step);
      } else {
        const finalTargetTop = Math.ceil(el.scrollHeight - el.clientHeight);
        const finalRemaining = finalTargetTop - el.scrollTop;
        if (finalRemaining > 1 && finalRemaining <= maxFrameDelta) {
          el.scrollTop = finalTargetTop;
        }
        lastScrollTopRef.current = el.scrollTop;
        bottomSmoothRafRef.current = 0;
        if (finalTargetTop - el.scrollTop <= 8) setReturnToBottomPreload(false);
      }
    };

    bottomSmoothRafRef.current = requestAnimationFrame(step);
  }, [scrollToBottom]);

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

  const lockBottomAfterLayout = useCallback((extraSettling = false) => {
    if (bottomLockRafRef.current) cancelAnimationFrame(bottomLockRafRef.current);
    bottomLockTimersRef.current.forEach(window.clearTimeout);
    bottomLockTimersRef.current = [];

    // During conversation open/switch, keep the "programmatic bottom lock" intent
    // alive for the whole settling window. Virtuoso can emit internal scroll events
    // while tall rich-lite rows are being measured; those must not be interpreted
    // as a user browsing upward and cancel the pending bottom alignment.
    const delays = extraSettling ? [50, 100, 180, 280, 400, 520, 620, 800, 1200, 1800, 2600, 3600, 5000] : [80, 180];
    if (extraSettling) {
      bottomLockIntentUntilRef.current = Date.now() + Math.max(...delays) + 250;
    }

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

    // Virtuoso 对最后一项换行后的高度测量可能晚于 RAF，补 post-layout 锁底。
    // 切换会话/恢复历史时，Markdown、图片和虚拟列表测量可能更晚完成。
    // Heavy Markdown 的自动 hydrate 会延后到秒级发生；只要用户没有主动上滑，继续补偿到底部。
    bottomLockTimersRef.current = delays.map((delay) => window.setTimeout(lock, delay));
  }, [scrollToBottom]);

  const handleVirtuosoScrollerRef = useCallback((ref: Window | HTMLElement | null) => {
    const el = ref instanceof HTMLElement ? (ref as HTMLDivElement) : null;
    scrollRef.current = el;
    if (el) {
      lastScrollTopRef.current = el.scrollTop;
      updateScrollProgressFromElement(el);
    }
  }, [updateScrollProgressFromElement]);

  const lockBottomOnRenderedRange = useCallback(() => {
    if (targetMessageId) return;
    if (Date.now() >= bottomLockIntentUntilRef.current) return;
    if (Date.now() < userScrollOverrideUntilRef.current || !stickToBottomRef.current) return;
    scrollToBottom();
  }, [scrollToBottom, targetMessageId]);

  const centerMessageRowInScroller = useCallback((messageId: string) => {
    const el = scrollRef.current;
    if (!el) return false;
    const row = el.querySelector<HTMLElement>(`[data-chat-message-row="true"][data-message-id="${CSS.escape(messageId)}"]`);
    if (!row) return false;

    const scrollerRect = el.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const rowCenter = rowRect.top + rowRect.height / 2;
    const scrollerCenter = scrollerRect.top + scrollerRect.height / 2;
    const delta = rowCenter - scrollerCenter;
    if (Math.abs(delta) <= 2) return true;

    const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTop = Math.min(maxScrollTop, Math.max(0, el.scrollTop + delta));
    lastScrollTopRef.current = el.scrollTop;
    updateScrollProgressFromElement(el);
    return true;
  }, [updateScrollProgressFromElement]);

  const releaseHiddenLocalMessages = useCallback((el: HTMLElement) => {
    const state = localWindowReleaseStateRef.current;
    if (Date.now() > localWindowReleaseIntentUntilRef.current) return false;
    if (!state.hasHiddenLocalMessages || localWindowReleaseAwaitingScrollAwayRef.current) return false;
    const firstVisibleRow = Array.from(el.querySelectorAll<HTMLElement>('[data-chat-message-row="true"]'))
      .find((row) => row.getBoundingClientRect().bottom >= el.getBoundingClientRect().top + 8);
    const messageId = firstVisibleRow?.dataset.messageId || state.firstVisibleMessageId;
    if (!messageId) return false;

    loadMoreAnchorRef.current = {
      messageId,
      top: firstVisibleRow?.getBoundingClientRect().top ?? el.getBoundingClientRect().top,
      messageCount: state.visibleMessageCount,
      source: "local-window",
    };
    localWindowReleaseAwaitingScrollAwayRef.current = true;
    localWindowReleasedRef.current = true;
    setRenderedMessageWindow(() =>
      Math.min(state.visibleMessageCount + MESSAGE_WINDOW_PAGE_SIZE, state.allVisibleMessageCount)
    );
    stopBottomLockForUserBrowse(1800);
    return true;
  }, [stopBottomLockForUserBrowse]);

  const handleVirtuosoScroll = useCallback((event: UIEvent<HTMLElement>) => {
    const el = event.currentTarget;
    scrollRef.current = el as HTMLDivElement;

    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isScrollingUp = el.scrollTop < lastScrollTopRef.current;

    // stickToBottom 表示用户意图，只在明确上滑离开底部时关闭；
    // 用户主动上滑时立即打断补偿锁底，避免流式内容继续增长时把视图吸回底部。
    const isProgrammaticScroll = Date.now() < programmaticScrollUntilRef.current || Date.now() < bottomLockIntentUntilRef.current;
    if (!isProgrammaticScroll && isScrollingUp && distanceToBottom > 1) {
      stopBottomLockForUserBrowse(isProgrammaticScroll ? 1200 : 2500);
    }
    if (distanceToBottom <= 24) {
      stickToBottomRef.current = true;
      userScrollOverrideUntilRef.current = 0;
    }
    lastScrollTopRef.current = el.scrollTop;
    updateScrollProgressFromElement(el);

    const activeOverviewJump = overviewJumpActiveRef.current;
    if (activeOverviewJump && Date.now() < activeOverviewJump.until) {
      setActiveOverviewMessageId((previous) => previous === activeOverviewJump.id ? previous : activeOverviewJump.id);
      return;
    }
    if (activeOverviewJump) {
      overviewJumpActiveRef.current = null;
    }

    const scrollerRect = el.getBoundingClientRect();

    if (el.scrollTop <= 4 && releaseHiddenLocalMessages(el)) {
      return;
    }

    // Extreme positions: at very top -> earliest user message; at very bottom -> latest user message.
    if (el.scrollTop <= 4 && userOverviewMessagesRef.current.length > 0) {
      setActiveOverviewMessageId((previous) => previous === userOverviewMessagesRef.current[0].id ? previous : userOverviewMessagesRef.current[0].id);
      return;
    }
    if (distanceToBottom <= 4 && userOverviewMessagesRef.current.length > 0) {
      const lastId = userOverviewMessagesRef.current[userOverviewMessagesRef.current.length - 1].id;
      overviewBottomLockUntilRef.current = Date.now() + 450;
      setActiveOverviewMessageId((previous) => previous === lastId ? previous : lastId);
      return;
    }
    if (Date.now() < overviewBottomLockUntilRef.current && userOverviewMessagesRef.current.length > 0) {
      const lastId = userOverviewMessagesRef.current[userOverviewMessagesRef.current.length - 1].id;
      setActiveOverviewMessageId((previous) => previous === lastId ? previous : lastId);
      return;
    }

    const scrollerCenter = scrollerRect.top + scrollerRect.height / 2;
    const focusTop = scrollerRect.top + scrollerRect.height * 0.35;
    const focusBottom = scrollerRect.top + scrollerRect.height * 0.65;
    const centeredUserRows = Array.from(el.querySelectorAll<HTMLElement>('[data-chat-message-row="true"][data-message-role="user"]'))
      .map((row) => {
        const rect = row.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        const crossesCenter = rect.top <= scrollerCenter && rect.bottom >= scrollerCenter;
        const inFocusBand = center >= focusTop && center <= focusBottom;
        return {
          row,
          centered: crossesCenter || inFocusBand,
          distance: Math.abs(center - scrollerCenter),
        };
      })
      .filter((entry) => entry.centered)
      .sort((a, b) => a.distance - b.distance);
    const centeredUserRow = centeredUserRows[0]?.row;
    if (centeredUserRow?.dataset.messageId) {
      setActiveOverviewMessageId((previous) => previous === centeredUserRow.dataset.messageId ? previous : centeredUserRow.dataset.messageId || null);
    }

  }, [releaseHiddenLocalMessages, stopBottomLockForUserBrowse, updateScrollProgressFromElement]);

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
    if (fastScrollPreloadTimerRef.current) window.clearTimeout(fastScrollPreloadTimerRef.current);
    if (historyPrependSettlingTimerRef.current) window.clearTimeout(historyPrependSettlingTimerRef.current);
    if (historyRichLiteFallbackTimerRef.current) window.clearTimeout(historyRichLiteFallbackTimerRef.current);
    if (bottomSmoothRafRef.current) window.cancelAnimationFrame(bottomSmoothRafRef.current);
  }, []);

  const markHistoryPrependSettling = useCallback((duration = 1600, richLiteFallbackIds: string[] = []) => {
    historyPrependUntilRef.current = Math.max(historyPrependUntilRef.current, Date.now() + duration);
    setHistoryPrependSettling(true);
    if (richLiteFallbackIds.length > 0) {
      setHistoryRichLiteFallbackMessageIds(new Set(richLiteFallbackIds));
    }
    if (historyPrependSettlingTimerRef.current) window.clearTimeout(historyPrependSettlingTimerRef.current);
    historyPrependSettlingTimerRef.current = window.setTimeout(() => {
      historyPrependSettlingTimerRef.current = 0;
      setHistoryPrependSettling(false);
    }, duration);
    if (historyRichLiteFallbackTimerRef.current) window.clearTimeout(historyRichLiteFallbackTimerRef.current);
    historyRichLiteFallbackTimerRef.current = window.setTimeout(() => {
      historyRichLiteFallbackTimerRef.current = 0;
      setHistoryRichLiteFallbackMessageIds(new Set());
    }, duration + 1200);
  }, []);

  const handleUserScrollIntent = useCallback((deltaY: number) => {
    const el = scrollRef.current;
    if (!el) return;

    if (Math.abs(deltaY) >= 700) {
      setFastScrollPreload(true);
      if (fastScrollPreloadTimerRef.current) window.clearTimeout(fastScrollPreloadTimerRef.current);
      fastScrollPreloadTimerRef.current = window.setTimeout(() => {
        fastScrollPreloadTimerRef.current = 0;
        setFastScrollPreload(false);
      }, 900);
    }

    if (deltaY > 0) {
      localWindowReleaseAwaitingScrollAwayRef.current = false;
      return;
    }
    if (deltaY === 0) return;
    localWindowReleaseIntentUntilRef.current = Date.now() + 1800;
    if (deltaY < 0) {
      stopBottomLockForUserBrowse(2500);
      markUserBrowsing(2500);
      atBottomRef.current = false;
      setAtBottom(false);
    }
    if (deltaY < 0 && el.scrollTop <= 4 && releaseHiddenLocalMessages(el)) {
      return;
    }
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceToBottom > 1) {
      stopBottomLockForUserBrowse(2500);
      markUserBrowsing(2500);
      atBottomRef.current = false;
      setAtBottom(false);
    }
  }, [markUserBrowsing, releaseHiddenLocalMessages, stopBottomLockForUserBrowse]);

  useLayoutEffect(() => {
    const anchor = loadMoreAnchorRef.current;
    if (!anchor || messages.length <= anchor.messageCount) return;
    // Virtuoso's prepend model keeps the viewport anchored through firstItemIndex.
    // Do not also mutate scrollTop here: with tall/late-measured rows the two anchoring systems fight,
    // producing the visible flash/stuck-row behavior when loading older history.
    markHistoryPrependSettling(1600);
    stopBottomLockForUserBrowse(1600);
    const timer = window.setTimeout(() => {
      if (loadMoreAnchorRef.current?.messageId === anchor.messageId) {
        loadMoreAnchorRef.current = null;
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [markHistoryPrependSettling, messages, stopBottomLockForUserBrowse]);


  useEffect(() => {
    if (!isLoadingMore) {
      // Only clear the trigger guard when messages have actually been prepended.
      // If isLoadingMore flips to false before messages arrive, keep the guard
      // so startReached does not fire again while the parent is still processing.
      if (loadMoreAnchorRef.current && messages.length > loadMoreAnchorRef.current.messageCount) {
        loadingMoreTriggeredRef.current = false;
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
    setReturnToBottomPreload(true);
    programmaticScrollUntilRef.current = Date.now() + 3200;
    smoothScrollScrollerToBottom();
    lockBottomAfterSmoothScroll();
  }, [lockBottomAfterSmoothScroll, smoothScrollScrollerToBottom]);

  const createVirtuosoComponents = useCallback(<T,>(): Components<T, unknown> => ({
    Footer: () => <div style={{ height: CHAT_BOTTOM_SPACER + (selectMode ? SELECT_MODE_EXTRA_SPACER : 0) }} aria-hidden="true" />,
  }), [selectMode]);
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

  const allVisibleMessages = useMemo(() => {
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

  const targetMessageLocalIndex = targetMessageId
    ? allVisibleMessages.findIndex((message) => String(message.id) === String(targetMessageId))
    : -1;
  const targetMessageWindow = targetMessageLocalIndex >= 0
    ? allVisibleMessages.length - targetMessageLocalIndex
    : 0;
  const contentWeight = useMemo(() => getMessageContentWeight(allVisibleMessages), [allVisibleMessages]);
  const isContentHeavyConversation =
    contentWeight.totalChars >= CONTENT_HEAVY_TOTAL_CHARS_THRESHOLD ||
    contentWeight.codeBlocks >= CONTENT_HEAVY_CODE_BLOCK_THRESHOLD ||
    contentWeight.tableLines >= CONTENT_HEAVY_TABLE_LINE_THRESHOLD;
  const initialMessageWindow = isContentHeavyConversation
    ? CONTENT_HEAVY_INITIAL_RENDERED_MESSAGE_WINDOW
    : INITIAL_RENDERED_MESSAGE_WINDOW;
  const effectiveRenderedMessageWindowState =
    isContentHeavyConversation && !localWindowReleasedRef.current && renderedMessageWindow === INITIAL_RENDERED_MESSAGE_WINDOW
      ? CONTENT_HEAVY_INITIAL_RENDERED_MESSAGE_WINDOW
      : renderedMessageWindow;
  const shouldWindowInitialMessages =
    isContentHeavyConversation || allVisibleMessages.length - initialMessageWindow >= MIN_HIDDEN_MESSAGES_TO_WINDOW;
  const effectiveRenderedMessageWindow = shouldWindowInitialMessages
    ? Math.min(Math.max(effectiveRenderedMessageWindowState, targetMessageWindow, initialMessageWindow), allVisibleMessages.length)
    : allVisibleMessages.length;
  const visibleMessages = useMemo(() => {
    if (allVisibleMessages.length <= effectiveRenderedMessageWindow) return allVisibleMessages;
    return allVisibleMessages.slice(allVisibleMessages.length - effectiveRenderedMessageWindow);
  }, [allVisibleMessages, effectiveRenderedMessageWindow]);
  const latestAssistantMessageId = useMemo(() => {
    for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
      const message = visibleMessages[index];
      if (message?.role === "assistant") return String(message.id);
    }
    return undefined;
  }, [visibleMessages]);
  const renderedWindowStableAssistantIds = useMemo(() => {
    const ids = new Set<string>();
    for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
      const message = visibleMessages[index];
      if (message?.role === "assistant") {
        ids.add(String(message.id));
        if (ids.size >= MAX_STABLE_RICH_LITE_ASSISTANTS_IN_RENDER_WINDOW) break;
      }
    }
    return ids;
  }, [visibleMessages]);
  const [viewedAssistantIds, setViewedAssistantIds] = useState<Set<string>>(() => new Set());
  const handleAssistantViewed = useCallback((messageId: string) => {
    setViewedAssistantIds((previous) => {
      if (previous.has(messageId)) return previous;
      const next = new Set(previous);
      next.add(messageId);
      return next;
    });
  }, []);
  useEffect(() => {
    setViewedAssistantIds(new Set());
  }, [conversationId]);
  const hiddenLocalMessageCount = allVisibleMessages.length - visibleMessages.length;
  const hasHiddenLocalMessages = hiddenLocalMessageCount > 0;
  localWindowReleaseStateRef.current = {
    hasHiddenLocalMessages,
    visibleMessageCount: visibleMessages.length,
    allVisibleMessageCount: allVisibleMessages.length,
    firstVisibleMessageId: visibleMessages[0]?.id ?? "",
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const userIsBrowsingHistory = !stickToBottomRef.current || Date.now() < userScrollOverrideUntilRef.current;
    if (el && userIsBrowsingHistory && el.scrollTop <= 4 && el.scrollHeight - el.clientHeight > 4 && hasHiddenLocalMessages) {
      releaseHiddenLocalMessages(el);
    }
  }, [hasHiddenLocalMessages, releaseHiddenLocalMessages, visibleMessages.length]);

  useLayoutEffect(() => {
    const anchor = loadMoreAnchorRef.current;
    const el = scrollRef.current;
    if (!anchor || !el || visibleMessages.length <= anchor.messageCount) return;
    markHistoryPrependSettling(1600);
    stopBottomLockForUserBrowse(1600);

    let cancelled = false;
    let raf = 0;
    const startedAt = Date.now();
    const restoreAnchor = () => {
      if (cancelled) return;
      const row = el.querySelector<HTMLElement>(`[data-chat-message-row="true"][data-message-id="${CSS.escape(anchor.messageId)}"]`);
      if (!row) {
        if (Date.now() - startedAt < 800) {
          raf = window.requestAnimationFrame(restoreAnchor);
        }
        return;
      }
      if (anchor.source === "local-window") {
        // Local window release happens while the user is actively browsing upward.
        // Do not compensate scrollTop in the opposite direction; that creates the
        // visible stuck-row/back-and-forth flicker. Remote history prepend still
        // uses anchor restoration below.
        if (loadMoreAnchorRef.current?.messageId === anchor.messageId) {
          loadMoreAnchorRef.current = null;
        }
        return;
      }
      const delta = row.getBoundingClientRect().top - anchor.top;
      if (Math.abs(delta) > 4) {
        el.scrollTop += delta;
        lastScrollTopRef.current = el.scrollTop;
        updateScrollProgressFromElement(el);
      }
      if (Date.now() - startedAt < 800) {
        raf = window.requestAnimationFrame(restoreAnchor);
        return;
      }
      if (loadMoreAnchorRef.current?.messageId === anchor.messageId) {
        loadMoreAnchorRef.current = null;
      }
    };

    raf = window.requestAnimationFrame(restoreAnchor);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
    };
  }, [markHistoryPrependSettling, messages.length, stopBottomLockForUserBrowse, updateScrollProgressFromElement, visibleMessages.length]);

  useEffect(() => {
    const previousAllVisibleMessages = previousAllVisibleMessagesRef.current;
    const hasUserHistoryAnchor = Boolean(loadMoreAnchorRef.current) || Date.now() < historyPrependUntilRef.current;
    if (hasUserHistoryAnchor && previousAllVisibleMessages.length > 0 && allVisibleMessages.length > previousAllVisibleMessages.length) {
      const firstPreviousId = previousAllVisibleMessages[0]?.id;
      const firstPreviousIndex = firstPreviousId
        ? allVisibleMessages.findIndex((message) => message.id === firstPreviousId)
        : -1;
      const isPurePrepend = firstPreviousIndex > 0 && previousAllVisibleMessages.every((message, index) => allVisibleMessages[firstPreviousIndex + index]?.id === message.id);
      const wasFullyExpanded = previousVisibleMessagesRef.current.length >= previousAllVisibleMessages.length;
      if (isPurePrepend && wasFullyExpanded) {
        setRenderedMessageWindow((current) => Math.max(current + firstPreviousIndex, allVisibleMessages.length));
      }
    }
    previousAllVisibleMessagesRef.current = allVisibleMessages;
  }, [allVisibleMessages]);

  useEffect(() => {
    const commitAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    emitChatRenderProfileEvent("message-list-commit", {
      conversationId,
      messageCount: messages.length,
      visibleMessageCount: visibleMessages.length,
      durationMs: commitAt - renderStartedAt,
    });
  }, [conversationId, messages.length, renderStartedAt, visibleMessages.length]);

  useEffect(() => {
    setRenderedMessageWindow(INITIAL_RENDERED_MESSAGE_WINDOW);
  }, [conversationId, targetMessageId]);

  const userOverviewMessages = useMemo(() => {
    return allVisibleMessages
      .filter((msg) => msg.role === "user" && msg.content.trim().length > 0)
      .map((msg) => ({
        id: msg.id,
        label: normalizeExportPlainText(msg.content, t).replace(/\s+/g, " ").slice(0, 48) || t("chat.export.userRole"),
      }));
  }, [allVisibleMessages, t]);

  userOverviewMessagesRef.current = userOverviewMessages;

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
    if (index < 0) {
      const allIndex = allVisibleMessages.findIndex((message) => message.id === messageId);
      if (allIndex < 0) return;
      const neededWindow = allVisibleMessages.length - allIndex;
      setRenderedMessageWindow((current) => Math.max(current, neededWindow));
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => jumpToUserMessage(messageId));
      });
      return;
    }
    programmaticScrollUntilRef.current = Date.now() + 900;
    overviewJumpActiveRef.current = { id: messageId, until: Date.now() + 900 };
    stopBottomLockForUserBrowse(1600);
    setActiveOverviewMessageId(messageId);
    highlightMessage(messageId, 2400);
    const scrollToTarget = () => {
      virtuosoRef.current?.scrollToIndex({ index, align: "center", behavior: "auto" });
      window.requestAnimationFrame(() => centerMessageRowInScroller(messageId));
    };
    const centerTarget = () => centerMessageRowInScroller(messageId);
    scrollToTarget();
    window.requestAnimationFrame(() => window.requestAnimationFrame(scrollToTarget));
    window.setTimeout(scrollToTarget, 120);
    window.setTimeout(centerTarget, 260);
  }, [allVisibleMessages, centerMessageRowInScroller, highlightMessage, stopBottomLockForUserBrowse, visibleMessages]);

  const pendingFirstItemIndex = useMemo(() => {
    if (lastConversationIdRef.current !== conversationId) {
      return 100_000;
    }

    const prev = previousVisibleMessagesRef.current;
    if (prev.length > 0 && visibleMessages.length > prev.length) {
      const firstPrevId = prev[0]?.id;
      const firstPrevIndex = firstPrevId
        ? visibleMessages.findIndex((m) => m.id === firstPrevId)
        : -1;
      const isPurePrepend = firstPrevIndex > 0 && prev.every((message, index) => visibleMessages[firstPrevIndex + index]?.id === message.id);
      if (isPurePrepend) {
        return firstItemIndexRef.current - firstPrevIndex;
      }
    }
    return firstItemIndexRef.current;
  }, [conversationId, visibleMessages]);

  const didSwitchConversation = lastConversationIdRef.current !== conversationId;
  const didPrependVisibleMessages = !didSwitchConversation && pendingFirstItemIndex !== firstItemIndexRef.current;
  const firstItemIndex = pendingFirstItemIndex;

  useLayoutEffect(() => {
    if (didSwitchConversation) {
      lastConversationIdRef.current = conversationId;
      firstItemIndexRef.current = 100_000;
      historyPrependUntilRef.current = 0;
      bottomLockIntentUntilRef.current = 0;
      loadMoreAnchorRef.current = null;
      loadingMoreTriggeredRef.current = false;
      localWindowReleaseAwaitingScrollAwayRef.current = false;
      localWindowReleasedRef.current = false;
      localWindowReleaseIntentUntilRef.current = 0;
      openedConversationBottomKeyRef.current = "";
      stickToBottomRef.current = true;
      atBottomRef.current = true;
      userScrollOverrideUntilRef.current = 0;
      setAtBottom(true);
      setUserBrowsing(false);
      setHistoryRichLiteFallbackMessageIds(new Set());
      previousAllVisibleMessagesRef.current = allVisibleMessages;
    } else if (didPrependVisibleMessages) {
      const prev = previousVisibleMessagesRef.current;
      const firstPrevId = prev[0]?.id;
      const firstPrevIndex = firstPrevId
        ? visibleMessages.findIndex((message) => message.id === firstPrevId)
        : -1;
      const prependedVisibleIds = firstPrevIndex > 0
        ? visibleMessages.slice(0, firstPrevIndex).map((message) => message.id)
        : [];
      firstItemIndexRef.current = pendingFirstItemIndex;
      markHistoryPrependSettling(1600, prependedVisibleIds);
      stopBottomLockForUserBrowse(1600);
    }
    previousVisibleMessagesRef.current = visibleMessages;
  }, [allVisibleMessages, conversationId, didSwitchConversation, didPrependVisibleMessages, markHistoryPrependSettling, pendingFirstItemIndex, visibleMessages, stopBottomLockForUserBrowse]);

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
      const allIndex = allVisibleMessages.findIndex((msg) => msg.serverMessageId === targetMessageId);
      if (allIndex >= 0) {
        const neededWindow = allVisibleMessages.length - allIndex;
        setRenderedMessageWindow((current) => Math.max(current, neededWindow));
        return;
      }

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
  }, [allVisibleMessages, conversationId, targetMessageId, visibleMessages, isLoadingHistory, isLoadingMore, hasMoreMessages, onLoadMore, highlightMessage]);

  useEffect(() => {
    if (!targetMessageId) {
      locatedTargetKeyRef.current = "";
      loadingTargetKeyRef.current = "";
    }
  }, [conversationId, targetMessageId]);

  useEffect(() => {
    if (targetMessageId || isLoadingHistory || messages.length === 0 || Date.now() < historyPrependUntilRef.current || !stickToBottomRef.current) return;
    const key = `${conversationId || "new"}:${messages[0]?.id || ""}:${messages[messages.length - 1]?.id || ""}`;
    if (openedConversationBottomKeyRef.current === key) return;
    openedConversationBottomKeyRef.current = key;

    stickToBottomRef.current = true;
    atBottomRef.current = true;
    userScrollOverrideUntilRef.current = 0;
    programmaticScrollUntilRef.current = Date.now() + 900;
    overviewJumpActiveRef.current = null;
    setAtBottom(true);
    setUserBrowsing(false);
    const lastUserId = userOverviewMessagesRef.current[userOverviewMessagesRef.current.length - 1]?.id;
    if (lastUserId) {
      setActiveOverviewMessageId((previous) => previous === lastUserId ? previous : lastUserId);
    }
    lockBottomAfterLayout(true);
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

  // 用户发送新消息时强制滚到底部；向上加载历史是 prepend，不能按长度增加误判为新发送。
  const previousMessageEdgeRef = useRef<{ length: number; firstId: string; lastId: string }>({ length: 0, firstId: "", lastId: "" });
  useEffect(() => {
    const previous = previousMessageEdgeRef.current;
    const firstId = messages[0]?.id || "";
    const lastId = messages[messages.length - 1]?.id || "";
    const isAppendAtTail =
      previous.length > 0 &&
      messages.length > previous.length &&
      previous.firstId === firstId &&
      previous.lastId !== lastId;

    if (isAppendAtTail && Date.now() >= historyPrependUntilRef.current) {
      const newMessages = messages.slice(previous.length);
      if (newMessages.some((m) => m.role === "user")) {
        stickToBottomRef.current = true;
        requestAnimationFrame(() => {
          scrollToBottom();
          requestAnimationFrame(() => scrollToBottom());
        });
      }
    }
    previousMessageEdgeRef.current = { length: messages.length, firstId, lastId };
  }, [messages, scrollToBottom]);

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
  }, []);

  const copyText = useCallback(async (content: string, successMessage = t("chat.toast.copied")) => {
    await navigator.clipboard.writeText(content);
    toast.success(successMessage);
  }, [t]);

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
    await copyText(textSelection.text, t("chat.toast.copiedSelection"));
    clearTextSelection();
  }, [clearTextSelection, copyText, t, textSelection]);

  const handleCopySelectedQuote = useCallback(async () => {
    if (!textSelection?.text) return;
    const quote = formatQuoteText(textSelection.text);
    if (onQuoteSelection) {
      onQuoteSelection(quote);
      toast.success(t("chat.toast.quoteInserted"));
    } else {
      await copyText(quote, t("chat.toast.quoteCopied"));
    }
    clearTextSelection();
  }, [clearTextSelection, copyText, formatQuoteText, onQuoteSelection, t, textSelection]);

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
      toast.warning(t("chat.toast.favoriteLoginRequired"));
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
      toast.success(t("chat.toast.favorited"));
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
    const exportedAt = new Date().toLocaleString(language, { hour12: false });
    const separator = "\n\n────────────────────────\n\n";
    const text = [
      t("chat.export.title"),
      `${t("chat.export.exportedAt")}：${exportedAt}`,
      `${t("chat.export.messageCount")}：${selectedMessages.length}`,
      "",
      selectedMessages.map((msg, index) => formatMessageForTextExport(msg, index, selectedMessages.length, t)).join(separator),
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
        <ChatCompareHeader
          compareModels={activeCompareModels.length ? activeCompareModels : compareModels}
          models={models}
          modelById={modelById}
          closeLabel={t("chat.closeCompareColumn")}
          onModelChange={onCompareModelChange}
          onExitCompare={onExitCompare}
        />
        {/* 滚动内容区域：对比模式也使用 Virtuoso，和单聊共享滚动/锁底体系 */}
        {messages.length === 0 ? (
          isLoadingHistory ? (
            <ChatHistoryLoadingVirtuoso<InferredGroup>
              data={[]}
              virtuosoRef={virtuosoRef}
              scrollerRef={handleVirtuosoScrollerRef}
              onScroll={handleVirtuosoScroll}
              components={historyLoadingComponents}
              computeItemKey={(_, group) => String(group.id)}
            />
          ) : (
            <ChatCompareWelcomeColumns
              compareModels={activeCompareModels.length ? activeCompareModels : compareModels}
              greeting={t("chat.helloComma")}
              prompt={t("chat.howCanIHelp")}
            />
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
            itemsRendered={lockBottomOnRenderedRange}
            onScroll={handleVirtuosoScroll}
            onWheel={(event) => handleUserScrollIntent(event.deltaY)}
            onTouchMove={() => stopBottomLockForUserBrowse(2500)}
            increaseViewportBy={{
          top: fastScrollPreload ? FAST_SCROLL_PRELOAD_PX : HISTORY_PRELOAD_TOP_PX,
          bottom: (returnToBottomPreload || fastScrollPreload) ? RETURN_TO_BOTTOM_PRELOAD_BOTTOM_PX : HISTORY_PRELOAD_BOTTOM_PX,
        }}
            overscan={{ main: 2, reverse: HISTORY_OVERSCAN_REVERSE }}
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

        <ChatDeleteMessageDialog
          targetId={deleteTarget}
          title={t("chat.deleteMessageTitle")}
          description={t("chat.deleteMessageDesc")}
          confirmText={t("common.delete")}
          cancelText={t("common.cancel")}
          onDelete={onDeleteMessage}
          onClose={() => setDeleteTarget(null)}
        />
        <ShareDialog isOpen={shareOpen} slug={shareSlug} onClose={() => setShareOpen(false)} />
      </div>
    );
  }

  if (messages.length === 0) {
    if (isLoadingHistory) {
      return (
        <ChatHistoryLoadingVirtuoso<Message>
          data={[]}
          virtuosoRef={virtuosoRef}
          scrollerRef={handleVirtuosoScrollerRef}
          onScroll={handleVirtuosoScroll}
          components={historyLoadingComponents}
          computeItemKey={(_, msg) => msg.id}
          className="relative flex-1 min-h-0 overflow-hidden"
        />
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
    <div
      className="relative flex-1 min-h-0 overflow-hidden"
      data-testid="chat-message-list"
      data-visible-message-count={visibleMessages.length}
      data-all-visible-message-count={allVisibleMessages.length}
      data-hidden-local-message-count={hiddenLocalMessageCount}
    >
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
          if (atBottom && Date.now() >= userScrollOverrideUntilRef.current) {
            stickToBottomRef.current = true;
            overviewBottomLockUntilRef.current = Date.now() + 450;
            const lastUserId = userOverviewMessagesRef.current[userOverviewMessagesRef.current.length - 1]?.id;
            if (lastUserId) {
              setActiveOverviewMessageId((previous) => previous === lastUserId ? previous : lastUserId);
            }
          }
          setAtBottom(atBottom);
        }}
        computeItemKey={(_, msg) => msg.id}
        itemsRendered={lockBottomOnRenderedRange}
        onScroll={handleVirtuosoScroll}
        onWheel={(event) => handleUserScrollIntent(event.deltaY)}
        onTouchMove={() => stopBottomLockForUserBrowse(2500)}
        startReached={() => {
          const el = scrollRef.current;
          if (!el || loadingMoreTriggeredRef.current) return;
          const firstVisibleRow = Array.from(el.querySelectorAll<HTMLElement>('[data-chat-message-row="true"]'))
            .find((row) => row.getBoundingClientRect().bottom >= el.getBoundingClientRect().top + 8);
          const messageId = firstVisibleRow?.dataset.messageId;
          if (!messageId || !firstVisibleRow) return;

          if (hasHiddenLocalMessages) {
            // Virtuoso can report startReached early while scrolling through a very tall row.
            // Releasing the local window at that point prepends items above the anchor and
            // causes a visible opposite-direction scroll compensation. Only release local
            // hidden messages when the real scroller is actually at the top edge.
            if (el.scrollTop <= 24) {
              releaseHiddenLocalMessages(el);
            }
            return;
          }

          if (isLoadingMore || !hasMoreMessages) return;
          // Guard against duplicate triggers while the parent is still prepending messages.
          if (loadMoreAnchorRef.current && messages.length <= loadMoreAnchorRef.current.messageCount) return;
          loadingMoreTriggeredRef.current = true;
          loadMoreAnchorRef.current = {
            messageId,
            top: firstVisibleRow.getBoundingClientRect().top,
            messageCount: messages.length,
            source: "remote-history",
          };
          stopBottomLockForUserBrowse(1800);
          onLoadMore?.();
        }}
        increaseViewportBy={{
          top: fastScrollPreload ? FAST_SCROLL_PRELOAD_PX : HISTORY_PRELOAD_TOP_PX,
          bottom: (returnToBottomPreload || fastScrollPreload) ? RETURN_TO_BOTTOM_PRELOAD_BOTTOM_PX : HISTORY_PRELOAD_BOTTOM_PX,
        }}
        overscan={{ main: 2, reverse: HISTORY_OVERSCAN_REVERSE }}
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
              latestAssistantMessageId={latestAssistantMessageId}
              initialReadingAssistantIds={renderedWindowStableAssistantIds}
              viewedAssistantIds={viewedAssistantIds}
              group={group}
              model={model}
              isLoading={isLoading}
              selectMode={selectMode}
              isSelected={isSelected}
              isHighlighted={isHighlighted}
              historyPrependSettling={historyPrependSettling}
              deferRichTextHydration={userBrowsing}
              allowRichLiteFallback={historyRichLiteFallbackMessageIds.has(msg.id)}
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
              onAssistantViewed={handleAssistantViewed}
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

      <ChatDeleteMessageDialog
        targetId={deleteTarget}
        title={t("chat.deleteMessageTitle")}
        description={t("chat.deleteMessageDesc")}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        onDelete={onDeleteMessage}
        onClose={() => setDeleteTarget(null)}
      />

    </div>
  );
}

export default memo(MessageList);

