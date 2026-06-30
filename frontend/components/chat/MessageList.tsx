"use client";

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, memo, type ComponentType, type UIEvent } from "react";
import { cn } from "@/lib/utils";
import { Message, ChatModel } from "@/lib/chatTypes";
import { useFavorites } from "@/hooks/useFavorites";
import { toast } from "sonner";
import dynamic from "next/dynamic";
const ShareDialog = dynamic(() => import("@/components/ui/ShareDialog"), { ssr: false });
import { Virtuoso, VirtuosoHandle, type Components, type ListItem } from "react-virtuoso";
import { useMessageStream } from "@/hooks/useMessageStream";
import { dedupeAssistantsByModel, inferGroups, InferredGroup } from "@/lib/groups";
import { useI18n } from "@/lib/i18n";
import { DeferredMarkdownRenderer } from "./DeferredMarkdownRenderer";
import MarkdownPlainFallback from "./markdown/MarkdownPlainFallback";
import { preheatMarkdownTokens } from "@/lib/markdown/markdownTokenWorkerClient";
import { emitChatRenderProfileEvent } from "@/lib/chatRenderProfile";
import { getConversationScrollState, saveConversationScrollState } from "@/lib/chatConversationScrollState";

type MarkdownRendererProps = { content: string; isStreaming?: boolean; shouldHydrateRichText?: boolean; priorityHydrateRichText?: boolean; allowRichLiteFallback?: boolean; compactRichLitePreview?: boolean; messageId?: string | number };
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

  if (props.allowRichLiteFallback) {
    return <DeferredMarkdownRenderer {...props} />;
  }

  if (!Renderer) {
    if (props.priorityHydrateRichText) {
      return <DeferredMarkdownRenderer {...props} />;
    }
    return <MarkdownPlainFallback content={content} messageId={props.messageId} />;
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
import ChatActivityPanel from "./ChatActivityPanel";
import { useCompareActivityLayout, type CompareActivityLayout } from "./ChatCompareActivityLayoutControl";
import { CHAT_ACTIVITY_PANEL_MARGIN_CLASS, CHAT_ACTIVITY_PANEL_WIDTH_CLASS } from "./chatLayout";
import { parseThinkContent, sanitizeContent, isMessageGenerating } from "@/lib/chatContent";


const CHAT_BOTTOM_SPACER = 280;
const SCROLL_TO_BOTTOM_OFFSET = 238;
const AT_BOTTOM_THRESHOLD = 24;
const SELECT_MODE_EXTRA_SPACER = 80;
const LONG_MARKDOWN_LAZY_THRESHOLD = 0;
const HISTORY_PRELOAD_TOP_PX = 1200;
const HEAVY_HISTORY_PRELOAD_TOP_PX = 1800;
const HISTORY_PRELOAD_BOTTOM_PX = CHAT_BOTTOM_SPACER;
const FAST_SCROLL_PRELOAD_PX = 6000;
const RETURN_TO_BOTTOM_PRELOAD_BOTTOM_PX = 6000;
const HISTORY_OVERSCAN_REVERSE = 8;
const CHAT_VIRTUOSO_DEFAULT_ITEM_HEIGHT = 260;
const INITIAL_RENDERED_MESSAGE_WINDOW = 16;
const CONTENT_HEAVY_INITIAL_RENDERED_MESSAGE_WINDOW = 32;
const MAX_STABLE_RICH_LITE_ASSISTANTS_IN_RENDER_WINDOW = 16;
const MARKDOWN_TOKEN_PREHEAT_DELAY_MS = 2600;
const MARKDOWN_TOKEN_PREHEAT_MAX_ASSISTANTS = 4;
const MARKDOWN_TOKEN_PREHEAT_MIN_CONTENT_LENGTH = 500;
const MESSAGE_WINDOW_PAGE_SIZE = 8;
const MIN_HIDDEN_MESSAGES_TO_WINDOW = 8;
const CONTENT_HEAVY_TOTAL_CHARS_THRESHOLD = 24_000;
const CONTENT_HEAVY_CODE_BLOCK_THRESHOLD = 24;
const CONTENT_HEAVY_TABLE_LINE_THRESHOLD = 80;
type SelectionMode = "share" | "favorite";

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  isLoadingHistory?: boolean;
  isConversationShellLoading?: boolean;
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
  onSaveAssistantToNote?: (content: string) => void;
  onActivityOpenChange?: (open: boolean) => void;
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

function LazyMarkdownRenderer({ content, shouldHydrateRichText = true, priorityHydrateRichText = false, allowRichLiteFallback = false, compactRichLitePreview = true, messageId }: MarkdownRendererProps) {
  if (content.length < LONG_MARKDOWN_LAZY_THRESHOLD) {
    return <MemoMarkdownRenderer content={content} shouldHydrateRichText={shouldHydrateRichText} priorityHydrateRichText={priorityHydrateRichText} allowRichLiteFallback={allowRichLiteFallback} compactRichLitePreview={compactRichLitePreview} messageId={messageId} />;
  }

  return <DeferredMarkdownRenderer content={content} shouldHydrateRichText={shouldHydrateRichText} priorityHydrateRichText={priorityHydrateRichText} allowRichLiteFallback={allowRichLiteFallback} compactRichLitePreview={compactRichLitePreview} messageId={messageId} />;
}

function MessageList({
  messages,
  isLoading,
  isLoadingHistory,
  isConversationShellLoading = false,
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
  onSaveAssistantToNote,
  onActivityOpenChange,
}: MessageListProps) {
  const { t, language } = useI18n();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const loadingMoreTriggeredRef = useRef(false);
  const loadMoreAnchorRef = useRef<{ messageId: string; top: number; messageCount: number; source?: "local-window" | "remote-history"; scrollHeight?: number; scrollTop?: number } | null>(null);
  const localWindowReleaseAwaitingScrollAwayRef = useRef(false);
  const localWindowReleasedRef = useRef(false);
  const localWindowReleaseIntentUntilRef = useRef(0);
  const localWindowReleaseStateRef = useRef({
    hasHiddenLocalMessages: false,
    visibleMessageCount: 0,
    allVisibleMessageCount: 0,
    firstVisibleMessageId: "",
  });
  const visibleMessageCountRef = useRef(0);
  const programmaticScrollUntilRef = useRef(0);
  const userScrollOverrideUntilRef = useRef(0);
  const bottomLockIntentUntilRef = useRef(0);
  const bottomLockRafRef = useRef<number>(0);
  const bottomLockTimersRef = useRef<number[]>([]);
  const bottomSmoothRafRef = useRef<number>(0);
  const restoringConversationScrollUntilRef = useRef(0);
  const restoredConversationBrowseRef = useRef<{ conversationId?: number; distanceToBottom: number; until: number } | null>(null);
  const pendingConversationScrollRestoreRef = useRef<number | undefined>(undefined);
  const initialRangeRevealRafRef = useRef<number>(0);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const [userBrowsing, setUserBrowsing] = useState(false);
  const [hasRenderedInitialRange, setHasRenderedInitialRange] = useState(false);
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
  const [activeActivityMessageId, setActiveActivityMessageId] = useState<string | null>(null);
  const [compareActivityLayout, setCompareActivityLayout] = useCompareActivityLayout();
  const overviewJumpActiveRef = useRef<{ id: string; until: number } | null>(null);
  const overviewBottomLockUntilRef = useRef(0);
  const userOverviewRafRef = useRef<number>(0);
  const userOverviewMessagesRef = useRef<{ id: string; label: string }[]>([]);
  const firstItemIndexRef = useRef(100_000);
  const previousAllVisibleMessagesRef = useRef<Message[]>([]);
  const previousVisibleMessagesRef = useRef<Message[]>([]);
  const historyPrependUntilRef = useRef(0);
  const openedConversationBottomKeyRef = useRef("");
  const lastConversationIdRef = useRef<number | undefined>(conversationId);
  const runningAssistantDisplayIdsRef = useRef<{
    byGroup: Map<string, string>;
    byMessageId: Map<string, string>;
  }>({ byGroup: new Map(), byMessageId: new Map() });
  const renderStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();

  const getStableRunningAssistantDisplayId = useCallback((message: Message) => {
    if (message.role !== "assistant") return message.id;
    const registry = runningAssistantDisplayIdsRef.current;
    const messageKey = `${conversationId ?? "none"}:msg:${message.id}`;
    const taskOrServerId = message.generationTaskId || message.serverMessageId;
    const groupKey = taskOrServerId ? `${conversationId ?? "none"}:task:${taskOrServerId}` : undefined;
    const existingForMessage = registry.byMessageId.get(messageKey);
    if (groupKey) {
      const existingForGroup = registry.byGroup.get(groupKey);
      if (existingForGroup) {
        registry.byMessageId.set(messageKey, existingForGroup);
        return existingForGroup;
      }
      if (existingForMessage) {
        registry.byGroup.set(groupKey, existingForMessage);
        return existingForMessage;
      }
      const seededDisplayId = message.serverMessageId && message.id === String(message.serverMessageId) && !message.completedAt
        ? `assistant-task:${taskOrServerId}`
        : message.id;
      registry.byGroup.set(groupKey, seededDisplayId);
      registry.byMessageId.set(messageKey, seededDisplayId);
      return seededDisplayId;
    }
    if (existingForMessage) return existingForMessage;
    registry.byMessageId.set(messageKey, message.id);
    return message.id;
  }, [conversationId]);

  useEffect(() => {
    const registry = runningAssistantDisplayIdsRef.current;
    const liveMessageKeys = new Set(messages.map((message) => `${conversationId ?? "none"}:msg:${message.id}`));
    for (const key of Array.from(registry.byMessageId.keys())) {
      if (!key.startsWith(`${conversationId ?? "none"}:msg:`) || !liveMessageKeys.has(key)) registry.byMessageId.delete(key);
    }
    const liveGroupKeys = new Set(messages
      .filter((message) => message.role === "assistant" && (message.generationTaskId || message.serverMessageId))
      .map((message) => `${conversationId ?? "none"}:task:${message.generationTaskId || message.serverMessageId}`));
    for (const key of Array.from(registry.byGroup.keys())) {
      if (!key.startsWith(`${conversationId ?? "none"}:task:`) || !liveGroupKeys.has(key)) registry.byGroup.delete(key);
    }
  }, [conversationId, messages]);

  const stopBottomLockForUserBrowse = useCallback((duration = 2500) => {
    stickToBottomRef.current = false;
    userScrollOverrideUntilRef.current = Date.now() + duration;
    if (typeof window !== "undefined") {
      (window as Window & { __AI_SPACE_CHAT_USER_BROWSE_UNTIL?: number }).__AI_SPACE_CHAT_USER_BROWSE_UNTIL = userScrollOverrideUntilRef.current;
    }
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
    const scroller = scrollRef.current;
    if (scroller) {
      scroller.style.overflowAnchor = "none";
      window.setTimeout(() => {
        if (scrollRef.current === scroller && Date.now() >= userScrollOverrideUntilRef.current) {
          scroller.style.overflowAnchor = "auto";
        }
      }, duration + 80);
    }
    setReturnToBottomPreload(false);
  }, []);

  const scrollToBottom = useCallback((behavior: "auto" | "smooth" = "auto", force = false) => {
    if (!force && Date.now() < userScrollOverrideUntilRef.current) return;
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
      if (Date.now() < userScrollOverrideUntilRef.current || !stickToBottomRef.current) return;
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
    if (!isCompare) {
      programmaticScrollUntilRef.current = Date.now() + 1200;
      el.scrollTo({ top: initialTargetTop, behavior: "smooth" });
      window.setTimeout(() => {
        if (Date.now() < userScrollOverrideUntilRef.current) return;
        if (stickToBottomRef.current) {
          el.scrollTop = Math.ceil(el.scrollHeight - el.clientHeight);
          lastScrollTopRef.current = el.scrollTop;
        }
        setReturnToBottomPreload(false);
      }, 900);
      return;
    }
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
  }, [isCompare, scrollToBottom]);

  const updateScrollProgressFromElement = useCallback((el: HTMLElement | null) => {
    if (!el) {
      setScrollProgress({ ratio: 1, canScroll: false });
      return;
    }
    const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const ratio = maxScrollTop > 0 ? Math.min(1, Math.max(0, el.scrollTop / maxScrollTop)) : 1;
    setScrollProgress((prev) => {
      const canScroll = maxScrollTop > 4;
      if (prev.canScroll === canScroll && Math.abs(prev.ratio - ratio) < 0.008) return prev;
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

  const saveCurrentConversationScrollState = useCallback((conversationIdOverride?: number) => {
    const el = scrollRef.current;
    const targetConversationId = conversationIdOverride || conversationId;
    if (!el || !targetConversationId) return;
    const distanceToBottom = Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
    saveConversationScrollState({
      conversationId: targetConversationId,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      distanceToBottom,
      atBottom: distanceToBottom <= AT_BOTTOM_THRESHOLD,
      updatedAt: Date.now(),
    });
  }, [conversationId]);

  const shouldPreserveRestoredBrowsePosition = useCallback(() => {
    const restored = restoredConversationBrowseRef.current;
    return Boolean(restored && restored.conversationId === conversationId && Date.now() < restored.until);
  }, [conversationId]);

  const lockBottomAfterLayout = useCallback((extraSettling = false) => {
    if (Date.now() < restoringConversationScrollUntilRef.current || shouldPreserveRestoredBrowsePosition()) return;
    if (bottomLockRafRef.current) cancelAnimationFrame(bottomLockRafRef.current);
    bottomLockTimersRef.current.forEach(window.clearTimeout);
    bottomLockTimersRef.current = [];

    // Virtuoso/compare mode still needs a longer post-layout settling window.
    // Normal DOM chat keeps this short so it does not fight user scroll after history prepend.
    const delays = extraSettling
      ? (isCompare ? [50, 100, 180, 280, 400, 520, 620, 800, 1200, 1800, 2200, 2600, 3600, 5000] : [80, 180, 320, 600])
      : [80, 180];
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

    bottomLockTimersRef.current = delays.map((delay) => window.setTimeout(lock, delay));
  }, [isCompare, scrollToBottom, shouldPreserveRestoredBrowsePosition]);

  const handleVirtuosoScrollerRef = useCallback((ref: Window | HTMLElement | null) => {
    const el = ref instanceof HTMLElement ? (ref as HTMLDivElement) : null;
    scrollRef.current = el;
    if (el) {
      const savedScroll = pendingConversationScrollRestoreRef.current === conversationId ? getConversationScrollState(conversationId) : undefined;
      const shouldRestoreBrowsePosition = Boolean(savedScroll && !savedScroll.atBottom && !targetMessageId);
      if (shouldRestoreBrowsePosition) {
        const until = Date.now() + 6000;
        restoringConversationScrollUntilRef.current = until;
        restoredConversationBrowseRef.current = { conversationId, distanceToBottom: savedScroll!.distanceToBottom, until };
        stickToBottomRef.current = false;
        userScrollOverrideUntilRef.current = until;
      }
      if (!shouldRestoreBrowsePosition && !targetMessageId && (stickToBottomRef.current || !hasRenderedInitialRange)) {
        const lock = () => {
          if (scrollRef.current !== el || Date.now() < userScrollOverrideUntilRef.current || (!stickToBottomRef.current && hasRenderedInitialRange)) return;
          el.scrollTop = Math.ceil(el.scrollHeight - el.clientHeight);
          lastScrollTopRef.current = el.scrollTop;
          updateScrollProgressFromElement(el);
        };
        window.requestAnimationFrame(lock);
        window.setTimeout(lock, 80);
        window.setTimeout(lock, 180);
        window.setTimeout(lock, 600);
        window.setTimeout(lock, 1200);
      }
      lastScrollTopRef.current = el.scrollTop;
      updateScrollProgressFromElement(el);
    }
  }, [conversationId, hasRenderedInitialRange, targetMessageId, updateScrollProgressFromElement]);

  const lockBottomOnRenderedRange = useCallback(() => {
    if (targetMessageId || shouldPreserveRestoredBrowsePosition()) return;
    if (Date.now() >= bottomLockIntentUntilRef.current) return;
    if (Date.now() < userScrollOverrideUntilRef.current || !stickToBottomRef.current) return;
    scrollToBottom();
  }, [scrollToBottom, shouldPreserveRestoredBrowsePosition, targetMessageId]);

  const handleItemsRendered = useCallback((items: ListItem<Message>[]) => {
    if (items.length <= 0) return;
    lockBottomOnRenderedRange();
    if (hasRenderedInitialRange) return;
    if (initialRangeRevealRafRef.current) window.cancelAnimationFrame(initialRangeRevealRafRef.current);

    let attempts = 0;
    let stableHeightFrames = 0;
    let lastScrollHeight = -1;
    const waitForInitialBottomStability = () => {
      initialRangeRevealRafRef.current = 0;
      const el = scrollRef.current;
      if (!el || targetMessageId || !stickToBottomRef.current) {
        setHasRenderedInitialRange(true);
        return;
      }

      const distanceToBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
      const heightStable = Math.abs(el.scrollHeight - lastScrollHeight) <= 1;
      stableHeightFrames = heightStable ? stableHeightFrames + 1 : 0;
      lastScrollHeight = el.scrollHeight;
      attempts += 1;

      if (distanceToBottom > AT_BOTTOM_THRESHOLD) {
        scrollToBottom();
        stableHeightFrames = 0;
      }

      const atBottomAfterLock = el.scrollHeight - el.clientHeight - el.scrollTop <= AT_BOTTOM_THRESHOLD;
      if ((atBottomAfterLock && stableHeightFrames >= 2) || attempts >= 12) {
        if (!atBottomAfterLock && Date.now() < bottomLockIntentUntilRef.current && Date.now() >= userScrollOverrideUntilRef.current) scrollToBottom();
        setHasRenderedInitialRange(true);
        return;
      }

      initialRangeRevealRafRef.current = window.requestAnimationFrame(waitForInitialBottomStability);
    };

    initialRangeRevealRafRef.current = window.requestAnimationFrame(waitForInitialBottomStability);
  }, [hasRenderedInitialRange, lockBottomOnRenderedRange, scrollToBottom, targetMessageId]);

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
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
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
    if (!isScrollingUp && distanceToBottom <= AT_BOTTOM_THRESHOLD) {
      stickToBottomRef.current = true;
      userScrollOverrideUntilRef.current = 0;
    }
    lastScrollTopRef.current = el.scrollTop;
    if (conversationId) {
      const existingSaved = getConversationScrollState(conversationId);
      const isInitialBottomOverwrite = Boolean(
        existingSaved
        && !existingSaved.atBottom
        && distanceToBottom <= AT_BOTTOM_THRESHOLD
        && Date.now() < restoringConversationScrollUntilRef.current
      );
      if (!isInitialBottomOverwrite) {
        saveConversationScrollState({
          conversationId,
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          distanceToBottom: Math.max(0, distanceToBottom),
          atBottom: distanceToBottom <= AT_BOTTOM_THRESHOLD,
          updatedAt: Date.now(),
        });
      }
    }
    updateScrollProgressFromElement(el);
    const nextAtBottom = distanceToBottom <= AT_BOTTOM_THRESHOLD;
    atBottomRef.current = nextAtBottom;
    if (nextAtBottom && Date.now() >= userScrollOverrideUntilRef.current) {
      stickToBottomRef.current = true;
      overviewBottomLockUntilRef.current = Date.now() + 450;
    }
    setAtBottom((previous) => previous === nextAtBottom ? previous : nextAtBottom);

    const activeOverviewJump = overviewJumpActiveRef.current;
    if (activeOverviewJump && Date.now() < activeOverviewJump.until) {
      setActiveOverviewMessageId((previous) => previous === activeOverviewJump.id ? previous : activeOverviewJump.id);
      return;
    }
    if (activeOverviewJump) {
      overviewJumpActiveRef.current = null;
    }

    const scrollerRect = el.getBoundingClientRect();

    if (!hasRenderedInitialRange && stickToBottomRef.current && !targetMessageId && el.scrollTop <= 4) {
      return;
    }

    // Extreme positions: at very top -> earliest user message; at very bottom -> latest user message.
    if (el.scrollTop <= 4 && userOverviewMessagesRef.current.length > 0) {
      // Reaching the absolute top is an explicit browse-away signal, even if it
      // happens while an initial bottom-lock settling timer is still pending.
      // Otherwise the post-layout bottom lock can immediately pull the scroller
      // back to the bottom and leave the overview marker stuck on the latest item.
      stopBottomLockForUserBrowse(2500);
      setActiveOverviewMessageId((previous) => previous === userOverviewMessagesRef.current[0].id ? previous : userOverviewMessagesRef.current[0].id);
      localWindowReleaseIntentUntilRef.current = Date.now() + 1800;
      if (isCompare && releaseHiddenLocalMessages(el)) return;

      const firstVisibleRow = Array.from(el.querySelectorAll<HTMLElement>('[data-chat-message-row="true"]'))
        .find((row) => row.getBoundingClientRect().bottom >= el.getBoundingClientRect().top + 8);
      const messageId = firstVisibleRow?.dataset.messageId;
      if (
        messageId
        && firstVisibleRow
        && hasMoreMessages
        && onLoadMore
        && !isLoadingMore
        && !loadingMoreTriggeredRef.current
        && !(loadMoreAnchorRef.current && visibleMessageCountRef.current <= loadMoreAnchorRef.current.messageCount)
      ) {
        loadingMoreTriggeredRef.current = true;
        loadMoreAnchorRef.current = {
          messageId,
          top: firstVisibleRow.getBoundingClientRect().top,
          messageCount: visibleMessageCountRef.current,
          source: "remote-history",
          scrollHeight: el.scrollHeight,
          scrollTop: el.scrollTop,
        };
        stopBottomLockForUserBrowse(1800);
        onLoadMore();
      }
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

    const updateActiveOverviewFromRows = () => {
      userOverviewRafRef.current = 0;
      const currentEl = scrollRef.current;
      if (!currentEl) return;
      const currentScrollerRect = currentEl.getBoundingClientRect();
      const scrollerCenter = currentScrollerRect.top + currentScrollerRect.height / 2;
      const focusTop = currentScrollerRect.top + currentScrollerRect.height * 0.35;
      const focusBottom = currentScrollerRect.top + currentScrollerRect.height * 0.65;
      const centeredUserRows = Array.from(currentEl.querySelectorAll<HTMLElement>('[data-chat-message-row="true"][data-message-role="user"]'))
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
    };

    if (isCompare) {
      updateActiveOverviewFromRows();
    } else if (!userOverviewRafRef.current) {
      userOverviewRafRef.current = window.requestAnimationFrame(updateActiveOverviewFromRows);
    }

  }, [conversationId, hasMoreMessages, hasRenderedInitialRange, isCompare, isLoadingMore, onLoadMore, releaseHiddenLocalMessages, stopBottomLockForUserBrowse, targetMessageId, updateScrollProgressFromElement]);

  const markUserBrowsing = useCallback((duration = 2500) => {
    setUserBrowsing(true);
    if (userBrowsingTimerRef.current) window.clearTimeout(userBrowsingTimerRef.current);
    userBrowsingTimerRef.current = window.setTimeout(() => {
      userBrowsingTimerRef.current = 0;
      setUserBrowsing(false);
    }, duration);
  }, []);

  useEffect(() => {
    const saveBeforeRouteChange = () => saveCurrentConversationScrollState();
    window.addEventListener("chat-conversation-before-route-change", saveBeforeRouteChange);
    return () => {
      window.removeEventListener("chat-conversation-before-route-change", saveBeforeRouteChange);
      if (userBrowsingTimerRef.current) window.clearTimeout(userBrowsingTimerRef.current);
      if (fastScrollPreloadTimerRef.current) window.clearTimeout(fastScrollPreloadTimerRef.current);
      if (historyPrependSettlingTimerRef.current) window.clearTimeout(historyPrependSettlingTimerRef.current);
      if (historyRichLiteFallbackTimerRef.current) window.clearTimeout(historyRichLiteFallbackTimerRef.current);
      if (bottomSmoothRafRef.current) window.cancelAnimationFrame(bottomSmoothRafRef.current);
      if (userOverviewRafRef.current) window.cancelAnimationFrame(userOverviewRafRef.current);
    };
  }, [saveCurrentConversationScrollState]);

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

    if (isCompare && Math.abs(deltaY) >= 700) {
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
    if (isCompare && deltaY < 0 && el.scrollTop <= 4 && releaseHiddenLocalMessages(el)) {
      return;
    }
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceToBottom > 1) {
      stopBottomLockForUserBrowse(2500);
      markUserBrowsing(2500);
      atBottomRef.current = false;
      setAtBottom(false);
    }
  }, [isCompare, markUserBrowsing, releaseHiddenLocalMessages, stopBottomLockForUserBrowse]);

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
    if (bottomSmoothRafRef.current) {
      cancelAnimationFrame(bottomSmoothRafRef.current);
      bottomSmoothRafRef.current = 0;
    }
    stickToBottomRef.current = true;
    scrollToBottom("auto");
    lockBottomAfterSmoothScroll();
  }, [lockBottomAfterSmoothScroll, scrollToBottom]);

  const createVirtuosoComponents = useCallback(<T,>(): Components<T, unknown> => ({
    Footer: () => <div style={{ height: CHAT_BOTTOM_SPACER + (selectMode ? SELECT_MODE_EXTRA_SPACER : 0) }} aria-hidden="true" />,
  }), [selectMode]);
  const virtuosoComponents = useMemo(() => createVirtuosoComponents<Message>(), [createVirtuosoComponents]);
  const compareVirtuosoComponents = useMemo(() => createVirtuosoComponents<InferredGroup>(), [createVirtuosoComponents]);
  const groups = useMemo(() => inferGroups(messages), [messages]);
  const effectiveIsCompare = isCompare;
  const groupByMessageId = useMemo(() => {
    const map = new Map<string, InferredGroup>();
    groups.forEach((group) => {
      map.set(group.userMessage.id, group);
      group.assistantMessages.forEach((assistant) => map.set(assistant.id, group));
    });
    return map;
  }, [groups]);

  const aggregateGroupByUserId = useMemo(() => {
    const map = new Map<string, InferredGroup>();
    groups.forEach((group) => {
      const existing = map.get(group.userMessage.id);
      if (!existing) {
        map.set(group.userMessage.id, { ...group, assistantMessages: [...group.assistantMessages], models: [...group.models] });
        return;
      }
      const seenAssistantIds = new Set(existing.assistantMessages.map((assistant) => assistant.id));
      const assistantMessages = dedupeAssistantsByModel([
        ...existing.assistantMessages,
        ...group.assistantMessages.filter((assistant) => !seenAssistantIds.has(assistant.id)),
      ]);
      const models = [...existing.models];
      group.models.forEach((modelId) => {
        if (modelId && !models.includes(modelId)) models.push(modelId);
      });
      assistantMessages.forEach((assistant) => {
        if (assistant.model && !models.includes(assistant.model)) models.push(assistant.model);
      });
      map.set(group.userMessage.id, { ...existing, assistantMessages, models });
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
      if (msg.role === "user" && msg.content.startsWith("<!-- ai-space:hidden-user-message -->")) {
        return false;
      }
      const group = groupByMessageId.get(msg.id);
      if (msg.role !== "user" && group) {
        const aggregateGroup = aggregateGroupByUserId.get(group.userMessage.id) || group;
        if (aggregateGroup.assistantMessages.length > 1) {
          const activeIndex = groupViews?.get(aggregateGroup.id) ?? 0;
          const activeMsg = aggregateGroup.assistantMessages[activeIndex] ?? aggregateGroup.assistantMessages[0];
          return msg.id === activeMsg?.id;
        }
      }
      return true;
    });
  }, [messages, groupByMessageId, aggregateGroupByUserId, groupViews]);

  const targetGroup = targetMessageId
    ? groups.find((group) =>
      group.userMessage.serverMessageId === targetMessageId
      || String(group.userMessage.id) === String(targetMessageId)
      || group.assistantMessages.some((message) => message.serverMessageId === targetMessageId || String(message.id) === String(targetMessageId))
    )
    : undefined;
  const targetAnchorMessage = targetGroup?.userMessage
    ?? (targetMessageId
      ? allVisibleMessages.find((message) => message.serverMessageId === targetMessageId || String(message.id) === String(targetMessageId))
      : undefined);
  const targetMessageLocalIndex = targetAnchorMessage
    ? allVisibleMessages.findIndex((message) => message.id === targetAnchorMessage.id)
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
  // Normal and compare chat now share the same DOM scroller. Keep all loaded
  // messages/groups mounted so history prepend uses one stable scrollHeight
  // delta instead of a second local hidden-message window.
  const shouldWindowInitialMessages = false;
  const effectiveRenderedMessageWindow = shouldWindowInitialMessages
    ? Math.min(Math.max(effectiveRenderedMessageWindowState, targetMessageWindow, initialMessageWindow), allVisibleMessages.length)
    : allVisibleMessages.length;
  const visibleMessages = useMemo(() => {
    if (allVisibleMessages.length <= effectiveRenderedMessageWindow) return allVisibleMessages;
    return allVisibleMessages.slice(allVisibleMessages.length - effectiveRenderedMessageWindow);
  }, [allVisibleMessages, effectiveRenderedMessageWindow]);
  visibleMessageCountRef.current = visibleMessages.length;
  useEffect(() => {
    if (!isLoadingMore) {
      // Only clear the trigger guard when visible messages have actually been prepended.
      // Keep loadMoreAnchorRef until the layout-effect restores scrollTop.
      if (loadMoreAnchorRef.current && visibleMessages.length > loadMoreAnchorRef.current.messageCount) {
        loadingMoreTriggeredRef.current = false;
      }
    }
  }, [isLoadingMore, visibleMessages.length]);
  const latestAssistantMessageId = useMemo(() => {
    for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
      const message = visibleMessages[index];
      if (message?.role === "assistant") return String(message.id);
    }
    return undefined;
  }, [visibleMessages]);
  const activeActivityMessage = useMemo(() => {
    if (!activeActivityMessageId) return null;
    return messages.find((message) => String(message.id) === activeActivityMessageId) || visibleMessages.find((message) => String(message.id) === activeActivityMessageId) || null;
  }, [activeActivityMessageId, messages, visibleMessages]);
  const activeActivityModel = activeActivityMessage?.model ? models.find((model) => model.id === activeActivityMessage.model) : undefined;
  const handleCompareOpenActivity = useCallback((message: Message, layout: CompareActivityLayout) => {
    setActiveActivityMessageId((current) => current === String(message.id) && layout !== "dock" ? null : String(message.id));
  }, []);

  useEffect(() => {
    onActivityOpenChange?.(!isCompare && Boolean(activeActivityMessage));
  }, [activeActivityMessage, isCompare, onActivityOpenChange]);

  useEffect(() => {
    return () => onActivityOpenChange?.(false);
  }, [onActivityOpenChange]);

  useEffect(() => {
    if (targetMessageId || isLoadingHistory || visibleMessages.length === 0) return;
    const candidates = visibleMessages
      .filter((message) => message.role === "assistant" && (message.content?.length || 0) >= MARKDOWN_TOKEN_PREHEAT_MIN_CONTENT_LENGTH)
      .slice(-MARKDOWN_TOKEN_PREHEAT_MAX_ASSISTANTS);
    if (candidates.length === 0) return;
    const timer = window.setTimeout(() => {
      const scroller = scrollRef.current;
      const distanceToBottom = scroller
        ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
        : 0;
      if (!stickToBottomRef.current || Date.now() < userScrollOverrideUntilRef.current || distanceToBottom > 48) {
        return;
      }
      candidates.forEach((message) => {
        preheatMarkdownTokens({ content: message.content || "", compactPreview: false });
      });
      emitChatRenderProfileEvent("markdown-token-preheat", {
        conversationId,
        messageCount: candidates.length,
        visibleMessageCount: visibleMessages.length,
      });
    }, MARKDOWN_TOKEN_PREHEAT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [conversationId, isLoadingHistory, targetMessageId, visibleMessages]);

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
  const useWindowedRowMeasurementHints = isCompare && allVisibleMessages.length > INITIAL_RENDERED_MESSAGE_WINDOW;
  const useRowContentVisibility = useWindowedRowMeasurementHints;
  const deferOffscreenRichTextHydration = isCompare && !useWindowedRowMeasurementHints && !targetMessageId;
  const shouldDeferRowsForActiveBrowse = isCompare && userBrowsing;
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

  useEffect(() => {
    if (isCompare || hasRenderedInitialRange || visibleMessages.length === 0 || targetMessageId) return;
    const lock = () => {
      const el = scrollRef.current
        ?? document.querySelector<HTMLElement>('[data-testid="chat-history-scroll-container"]');
      if (!el || Date.now() < userScrollOverrideUntilRef.current || !stickToBottomRef.current) return;
      scrollRef.current = el as HTMLDivElement;
      el.scrollTop = Math.ceil(el.scrollHeight - el.clientHeight);
      lastScrollTopRef.current = el.scrollTop;
      updateScrollProgressFromElement(el);
    };
    lock();
    const raf = window.requestAnimationFrame(lock);
    const timers = [0, 80, 180, 600, 1200, 2200].map((delay) => window.setTimeout(lock, delay));
    return () => {
      window.cancelAnimationFrame(raf);
      timers.forEach(window.clearTimeout);
    };
  }, [hasRenderedInitialRange, isCompare, targetMessageId, updateScrollProgressFromElement, visibleMessages.length]);

  useLayoutEffect(() => {
    if (isCompare || hasRenderedInitialRange || visibleMessages.length === 0) return;
    let cancelled = false;
    let raf = 0;
    let attempts = 0;
    let stableHeightFrames = 0;
    let lastScrollHeight = -1;

    const waitForInitialBottomStability = () => {
      if (cancelled) return;
      const el = scrollRef.current;
      if (!el || targetMessageId || !stickToBottomRef.current) {
        setHasRenderedInitialRange(true);
        return;
      }

      const distanceToBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
      const heightStable = Math.abs(el.scrollHeight - lastScrollHeight) <= 1;
      stableHeightFrames = heightStable ? stableHeightFrames + 1 : 0;
      lastScrollHeight = el.scrollHeight;
      attempts += 1;

      if (distanceToBottom > AT_BOTTOM_THRESHOLD) {
        scrollToBottom();
        stableHeightFrames = 0;
      }

      const atBottomAfterLock = el.scrollHeight - el.clientHeight - el.scrollTop <= AT_BOTTOM_THRESHOLD;
      if ((atBottomAfterLock && stableHeightFrames >= 2) || attempts >= 12) {
        if (!atBottomAfterLock && Date.now() < bottomLockIntentUntilRef.current && Date.now() >= userScrollOverrideUntilRef.current) scrollToBottom();
        setHasRenderedInitialRange(true);
        return;
      }

      raf = window.requestAnimationFrame(waitForInitialBottomStability);
    };

    const lockInitialBottom = () => {
      const el = scrollRef.current;
      if (!el || targetMessageId || Date.now() < userScrollOverrideUntilRef.current || (!stickToBottomRef.current && hasRenderedInitialRange)) return;
      el.scrollTop = Math.ceil(el.scrollHeight - el.clientHeight);
      lastScrollTopRef.current = el.scrollTop;
      updateScrollProgressFromElement(el);
    };
    scrollToBottom();
    lockInitialBottom();
    window.setTimeout(lockInitialBottom, 80);
    window.setTimeout(lockInitialBottom, 180);
    window.setTimeout(lockInitialBottom, 600);
    window.setTimeout(lockInitialBottom, 1200);
    raf = window.requestAnimationFrame(waitForInitialBottomStability);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
    };
  }, [hasRenderedInitialRange, isCompare, scrollToBottom, targetMessageId, visibleMessages.length]);

  useLayoutEffect(() => {
    const anchor = loadMoreAnchorRef.current;
    const el = scrollRef.current;
    if (!anchor || !el || visibleMessages.length <= anchor.messageCount) return;
    if (isCompare) {
      markHistoryPrependSettling(1600);
    } else {
      historyPrependUntilRef.current = Math.max(historyPrependUntilRef.current, Date.now() + 900);
    }
    stopBottomLockForUserBrowse(1600);

    let cancelled = false;
    let raf = 0;
    const startedAt = Date.now();
    const restoreAnchor = () => {
      if (cancelled) return;
      if (anchor.source === "remote-history" && typeof anchor.scrollHeight === "number" && typeof anchor.scrollTop === "number") {
        // DOM prepend is best anchored by total height delta. Do this before
        // looking up the old row: real conversations can group/filter messages, so
        // the pre-prepend anchor row may be temporarily absent even though height
        // has already changed and the viewport needs compensation immediately.
        const nextTop = Math.max(0, anchor.scrollTop + (el.scrollHeight - anchor.scrollHeight));
        if (Math.abs(el.scrollTop - nextTop) > 1) {
          el.scrollTop = nextTop;
          lastScrollTopRef.current = el.scrollTop;
          updateScrollProgressFromElement(el);
        }
        if (Date.now() - startedAt < 500) {
          raf = window.requestAnimationFrame(restoreAnchor);
          return;
        }
        if (loadMoreAnchorRef.current?.messageId === anchor.messageId) {
          loadMoreAnchorRef.current = null;
        }
        return;
      }
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
        // visible stuck-row/back-and-forth flicker.
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
      if (!isCompare) {
        if (loadMoreAnchorRef.current?.messageId === anchor.messageId) {
          loadMoreAnchorRef.current = null;
        }
        return;
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
  }, [isCompare, markHistoryPrependSettling, messages.length, stopBottomLockForUserBrowse, updateScrollProgressFromElement, visibleMessages.length]);

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
      allVisibleMessageCount: allVisibleMessages.length,
      visibleMessageCount: visibleMessages.length,
      hiddenLocalMessageCount,
      renderedMessageWindow,
      effectiveRenderedMessageWindow,
      initialMessageWindow,
      targetMessageWindow,
      isContentHeavyConversation,
      contentWeight,
      durationMs: commitAt - renderStartedAt,
    });
  }, [allVisibleMessages.length, contentWeight, conversationId, effectiveRenderedMessageWindow, hiddenLocalMessageCount, initialMessageWindow, isContentHeavyConversation, messages.length, renderedMessageWindow, renderStartedAt, targetMessageWindow, visibleMessages.length]);

  useEffect(() => {
    setRenderedMessageWindow(INITIAL_RENDERED_MESSAGE_WINDOW);
    setHasRenderedInitialRange(false);
  }, [conversationId, targetMessageId]);

  useEffect(() => {
    if (!isCompare || hasRenderedInitialRange || visibleMessages.length === 0) return;
    const markReady = window.setTimeout(() => setHasRenderedInitialRange(true), 240);
    return () => window.clearTimeout(markReady);
  }, [hasRenderedInitialRange, isCompare, visibleMessages.length]);

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
      pendingConversationScrollRestoreRef.current = conversationId;
      const savedScroll = getConversationScrollState(conversationId);
      const shouldRestoreBrowsePosition = Boolean(savedScroll && !savedScroll.atBottom && !targetMessageId);
      stickToBottomRef.current = !shouldRestoreBrowsePosition;
      atBottomRef.current = !shouldRestoreBrowsePosition;
      userScrollOverrideUntilRef.current = shouldRestoreBrowsePosition ? Date.now() + 1800 : 0;
      setAtBottom(!shouldRestoreBrowsePosition);
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
  }, [allVisibleMessages, conversationId, didSwitchConversation, didPrependVisibleMessages, markHistoryPrependSettling, pendingFirstItemIndex, saveCurrentConversationScrollState, targetMessageId, visibleMessages, stopBottomLockForUserBrowse]);

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
  }, [messages.length, updateScrollProgressFromElement]);

  useEffect(() => {
    if (!conversationId || targetMessageId || messages.length === 0 || pendingConversationScrollRestoreRef.current !== conversationId) return;
    const saved = getConversationScrollState(conversationId);
    pendingConversationScrollRestoreRef.current = undefined;
    if (!saved || saved.atBottom) return;
    const until = Date.now() + 6000;
    restoringConversationScrollUntilRef.current = until;
    userScrollOverrideUntilRef.current = until;
    restoredConversationBrowseRef.current = { conversationId, distanceToBottom: saved.distanceToBottom, until };
    stickToBottomRef.current = false;
    const restore = () => {
      const el = scrollRef.current;
      if (!el) return;
      const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
      const desiredTop = Math.max(0, Math.min(maxTop, el.scrollHeight - el.clientHeight - saved.distanceToBottom));
      programmaticScrollUntilRef.current = Date.now() + 360;
      el.scrollTop = desiredTop;
      lastScrollTopRef.current = el.scrollTop;
      updateScrollProgressFromElement(el);
    };
    window.requestAnimationFrame(() => {
      restore();
      window.requestAnimationFrame(restore);
    });
    const timer = window.setTimeout(restore, 220);
    return () => window.clearTimeout(timer);
  }, [conversationId, messages.length, targetMessageId, updateScrollProgressFromElement]);

  const modelById = useMemo(() => {
    const map = new Map<string, ChatModel>();
    models.forEach((model) => map.set(model.id, model));
    return map;
  }, [models]);
  useEffect(() => {
    if (!targetMessageId) return;
    const targetKey = `${conversationId || "new"}:${targetMessageId}`;
    if (locatedTargetKeyRef.current === targetKey || isLoadingHistory) return;

    const anchorMessage = targetAnchorMessage;
    if (!anchorMessage) {
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

    const index = visibleMessages.findIndex((msg) => msg.id === anchorMessage.id);
    if (index < 0) {
      const allIndex = allVisibleMessages.findIndex((msg) => msg.id === anchorMessage.id);
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

    const scrollIndex = effectiveIsCompare
      ? Math.max(0, groups.findIndex((group) => group.userMessage.id === anchorMessage.id))
      : index;
    locatedTargetKeyRef.current = targetKey;
    loadingTargetKeyRef.current = "";
    stickToBottomRef.current = false;
    programmaticScrollUntilRef.current = Date.now() + 700;
    setActiveOverviewMessageId(anchorMessage.id);
    highlightMessage(anchorMessage.id, 2600);

    const scrollToTarget = () => {
      virtuosoRef.current?.scrollToIndex({ index: scrollIndex, align: "center", behavior: "auto" });
      window.requestAnimationFrame(() => centerMessageRowInScroller(anchorMessage.id));
    };

    const raf = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(scrollToTarget);
    });
    const settleTimer = window.setTimeout(scrollToTarget, 120);

    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(settleTimer);
    };
  }, [allVisibleMessages, centerMessageRowInScroller, conversationId, targetMessageId, targetAnchorMessage, visibleMessages, isLoadingHistory, isLoadingMore, hasMoreMessages, onLoadMore, highlightMessage, groups, effectiveIsCompare]);

  useEffect(() => {
    if (!targetMessageId) {
      locatedTargetKeyRef.current = "";
      loadingTargetKeyRef.current = "";
    }
  }, [conversationId, targetMessageId]);

  useEffect(() => {
    const savedScroll = pendingConversationScrollRestoreRef.current === conversationId ? getConversationScrollState(conversationId) : undefined;
    if (savedScroll && !savedScroll.atBottom && !targetMessageId) return;
    if (targetMessageId || isLoadingHistory || messages.length === 0 || Date.now() < historyPrependUntilRef.current || Date.now() < userScrollOverrideUntilRef.current || !stickToBottomRef.current) return;
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

  const lastMessageGrowthKey = useMemo(() => {
    const last = messages[messages.length - 1];
    return `${conversationId || "new"}:${last?.id || ""}:${last?.content?.length || 0}:${last?.reasoningContent?.length || 0}:${last?.activityStatus?.status || ""}`;
  }, [conversationId, messages]);

  useEffect(() => {
    if (targetMessageId || isLoadingHistory || messages.length === 0 || shouldPreserveRestoredBrowsePosition()) return;
    const savedScroll = pendingConversationScrollRestoreRef.current === conversationId ? getConversationScrollState(conversationId) : undefined;
    if (savedScroll && !savedScroll.atBottom) return;
    if (!stickToBottomRef.current) return;
    if (Date.now() < userScrollOverrideUntilRef.current) return;
    programmaticScrollUntilRef.current = Date.now() + 700;
    scrollToBottom("auto", true);
    lockBottomAfterLayout(false);
  }, [conversationId, isLoadingHistory, lastMessageGrowthKey, lockBottomAfterLayout, messages.length, scrollToBottom, shouldPreserveRestoredBrowsePosition, targetMessageId]);

  const activeCompareModels = useMemo(() => {
    if (!effectiveIsCompare) return [];
    const availableModelIds = new Set(models.map((model) => model.id));
    const dedupeValid = (ids: string[]) => Array.from(new Set(ids.filter((id) => availableModelIds.has(id)))).slice(0, 2);
    const latestGroupedModels = [...groups]
      .reverse()
      .find((group) => group.assistantMessages.length > 1)
      ?.models || [];
    const groupModels = dedupeValid(latestGroupedModels);
    const explicitModels = dedupeValid(compareModels || []);

    // Existing normal conversations can enter compare mode from a persisted
    // message group whose models are authoritative. Prefer that group metadata
    // over stale local compare-model selections; otherwise duplicated local
    // state like [gpt-5.4, gpt-5.4] makes both columns resolve to the same
    // assistant.
    if (groupModels.length >= 2) return groupModels;
    if (explicitModels.length >= 2) return explicitModels;
    return dedupeValid(messages.filter((m) => m.role === "assistant" && m.model).map((m) => m.model!));
  }, [compareModels, groups, effectiveIsCompare, messages, models]);
  const columnMessages = useMemo(() => {
    if (!effectiveIsCompare) return [];
    return activeCompareModels.map((modelId) =>
      messages.filter((msg) => msg.role === "user" || msg.model === modelId)
    );
  }, [activeCompareModels, effectiveIsCompare, messages]);

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
          scrollToBottom("auto", true);
          requestAnimationFrame(() => scrollToBottom("auto", true));
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
      if (Date.now() < userScrollOverrideUntilRef.current) return;
      lockBottomAfterLayout();
    });

    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [streamingMessageId, lockBottomAfterLayout]);

  // SSE 流式输出是同一条消息内容持续变高，不一定改变 messages 引用；
  // 用流式文本长度触发，并只在用户仍贴近底部时跟随。
  const rafRef = useRef<number>(0);
  useEffect(() => {
    if (!streamingMessageId || !stickToBottomRef.current || Date.now() < userScrollOverrideUntilRef.current) return;

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

  if (effectiveIsCompare) {
    const compareGroups = Array.from(aggregateGroupByUserId.values())
      .sort((a, b) => (a.userMessage.createdAt || 0) - (b.userMessage.createdAt || 0));
    const resolveCompareAssistant = (group: InferredGroup, colIndex: number, modelId: string) => {
      return group.assistantMessages.find((m) => m.model === modelId)
        || group.assistantMessages.find((m) => group.models[m.groupIndex ?? -1] === modelId)
        || group.assistantMessages.find((m) => m.groupIndex === colIndex)
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
          activityLayout={compareActivityLayout}
          onActivityLayoutChange={setCompareActivityLayout}
        />
        {/* 滚动内容区域：对比模式和普通聊天共享普通 DOM scroller */}
        {messages.length === 0 ? (
          (isLoadingHistory || isConversationShellLoading) ? (
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
          <div
            ref={(el) => handleVirtuosoScrollerRef(el)}
            className={cn("chat-history-scroll-container transition-[margin-right] duration-200 ease-out", activeActivityMessage && compareActivityLayout === "dock" && CHAT_ACTIVITY_PANEL_MARGIN_CLASS)}
            style={{
              height: "100%",
              overflowY: "auto",
              overflowX: "hidden",
              overflowAnchor: userBrowsing ? "none" : "auto",
            }}
            onScroll={handleVirtuosoScroll}
            onWheel={(event) => handleUserScrollIntent(event.deltaY)}
            onTouchMove={() => stopBottomLockForUserBrowse(2500)}
            data-testid="chat-history-scroll-container"
          >
            <div data-testid="chat-history-container" className="min-h-full">
              {hasMoreMessages && (
                <div
                  className="flex justify-center py-3 text-xs text-muted-foreground"
                  data-testid="chat-history-top-sentinel"
                >
                  {t("chat.history.loading")}
                </div>
              )}
              {compareGroups.map((group, groupIndex) => (
                <ChatCompareGroupRow
                  key={group.id}
                  group={group}
                  aggregateGroup={aggregateGroupByUserId.get(group.userMessage.id)}
                  groupIndex={groupIndex}
                  groupCount={compareGroups.length}
                  compareModels={group.models.length >= 2 ? group.models : (activeCompareModels.length ? activeCompareModels : compareModels)}
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
                  onContinueGenerate={onContinueGenerate}
                  onShareSelectMode={(id) => enterSelectMode("share", id)}
                  onFavoriteSelectMode={(id) => enterSelectMode("favorite", id)}
                  isFavorited={isFavorited}
                  onForkCompare={onForkCompare}
                  onSaveToNote={onSaveAssistantToNote}
                  onAssistantViewed={handleAssistantViewed}
                  onOpenActivity={handleCompareOpenActivity}
                  activeActivityMessageId={activeActivityMessageId}
                  activityLayout={compareActivityLayout}
                  initialReadingAssistantIds={renderedWindowStableAssistantIds}
                  viewedAssistantIds={viewedAssistantIds}
                  historyPrependSettling={historyPrependSettling}
                  useContentVisibility={useRowContentVisibility}
                  deferRichTextHydration={shouldDeferRowsForActiveBrowse}
                  deferOffscreenRichTextHydration={deferOffscreenRichTextHydration}
                  allowRichLiteFallback={historyRichLiteFallbackMessageIds.has(group.userMessage.id)}
                  stabilizeInitialRichText={!hasRenderedInitialRange}
                />
              ))}
              <div style={{ height: CHAT_BOTTOM_SPACER + (selectMode ? SELECT_MODE_EXTRA_SPACER : 0) }} aria-hidden="true" />
            </div>
          </div>
        )}

        {activeActivityMessage && compareActivityLayout === "dock" && (
          <div className="absolute bottom-0 right-0 top-28 z-20 hidden w-[384px] lg:block">
            <ChatActivityPanel
              message={activeActivityMessage}
              model={activeActivityModel}
              onClose={() => setActiveActivityMessageId(null)}
              variant="embedded"
            />
          </div>
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

  if (messages.length === 0) {
    if (isLoadingHistory || isConversationShellLoading) {
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
      {isCompare && !hasRenderedInitialRange && (
        <div data-testid="chat-initial-range-stability-overlay" className="pointer-events-none absolute inset-0 z-10 bg-surface/80 backdrop-blur-[1px]">
          {(isLoadingHistory || visibleMessages.length === 0) && <ChatHistoryLoadingState />}
        </div>
      )}
      <div
        ref={(el) => handleVirtuosoScrollerRef(el)}
        className={cn("chat-history-scroll-container right-0 transition-[right] duration-200 ease-out", !isCompare && activeActivityMessage && CHAT_ACTIVITY_PANEL_WIDTH_CLASS)}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          overflowY: "auto",
          overflowX: "hidden",
          overflowAnchor: userBrowsing ? "none" : "auto",
        }}
        onScroll={handleVirtuosoScroll}
        onWheel={(event) => handleUserScrollIntent(event.deltaY)}
        onTouchMove={() => stopBottomLockForUserBrowse(2500)}
        data-testid="chat-history-scroll-container"
      >
        <div data-testid="chat-history-container" className="min-h-full">
          {(hasHiddenLocalMessages || hasMoreMessages) && (
            <div
              className="flex justify-center py-3 text-xs text-muted-foreground"
              data-testid="chat-history-top-sentinel"
            >
              {t("chat.history.loading")}
            </div>
          )}
          {visibleMessages.map((msg, index) => {
            const group = groupByMessageId.get(msg.id);
            const displayGroup = msg.role !== "user" && group
              ? aggregateGroupByUserId.get(group.userMessage.id) || group
              : group;
            const model = msg.model ? modelById.get(msg.model) : undefined;
            const isSelected = selectedIds.has(msg.id);
            const isHighlighted = highlightedMessageId === msg.id;
            const stableAssistantDisplayId = getStableRunningAssistantDisplayId(msg);

            return (
              <ChatMessageListItem
                key={stableAssistantDisplayId}
                displayMessageId={stableAssistantDisplayId}
                index={index}
                message={msg}
                visibleMessageCount={visibleMessages.length}
                latestAssistantMessageId={latestAssistantMessageId}
                initialReadingAssistantIds={renderedWindowStableAssistantIds}
                viewedAssistantIds={viewedAssistantIds}
                group={displayGroup}
                model={model}
                isLoading={isLoading}
                selectMode={selectMode}
                isSelected={isSelected}
                isHighlighted={isHighlighted}
                historyPrependSettling={isCompare ? historyPrependSettling : false}
                deferRichTextHydration={shouldDeferRowsForActiveBrowse}
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
                onSaveAssistantToNote={onSaveAssistantToNote}
                onAssistantViewed={handleAssistantViewed}
                onOpenActivity={(message) => setActiveActivityMessageId(String(message.id))}
                imageLoadFailedLabel={t("chat.imageLoadFailed")}
                MarkdownRenderer={LazyMarkdownRenderer}
                useContentVisibility={useRowContentVisibility}
                deferOffscreenRichTextHydration={deferOffscreenRichTextHydration}
                stabilizeInitialRichText={!hasRenderedInitialRange}
              />
            );
          })}
          <div
            ref={(el) => {
              if (!el || isCompare || hasRenderedInitialRange || targetMessageId) return;
              const lock = () => {
                if (hasRenderedInitialRange || Date.now() < userScrollOverrideUntilRef.current || !stickToBottomRef.current) return;
                el.scrollIntoView({ block: "end", behavior: "auto" });
                const scroller = scrollRef.current;
                if (scroller) {
                  lastScrollTopRef.current = scroller.scrollTop;
                  updateScrollProgressFromElement(scroller);
                }
              };
              lock();
              window.requestAnimationFrame(lock);
              window.setTimeout(lock, 80);
              window.setTimeout(lock, 180);
              window.setTimeout(lock, 600);
              window.setTimeout(lock, 1200);
            }}
            style={{ height: CHAT_BOTTOM_SPACER + (selectMode ? SELECT_MODE_EXTRA_SPACER : 0) }}
            aria-hidden="true"
          />
        </div>
      </div>

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
      {!isCompare && activeActivityMessage && (
        <ChatActivityPanel
          message={activeActivityMessage}
          model={activeActivityModel}
          onClose={() => setActiveActivityMessageId(null)}
        />
      )}

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

