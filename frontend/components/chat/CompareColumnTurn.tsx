"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type UIEvent } from "react";
import { Bot, Check, Play } from "lucide-react";
import type { ChatModel, Message } from "@/lib/chatTypes";
import type { InferredGroup } from "@/lib/groups";
import { isMessageGenerating } from "@/lib/chatContent";
import { isTerminalMessage } from "@/lib/chatMessageRuntimeState";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { ModelAvatar } from "./ModelAvatar";
import { getModelAvatarMeta } from "@/lib/models/modelAvatars";
import { AssistantMessageMeta } from "./AssistantMessageMeta";
import { AssistantMessageContent } from "./AssistantMessageContent";
import MessageActions from "./MessageActions";
import ChatActivityPanel from "./ChatActivityPanel";
import type { CompareActivityLayout } from "./ChatCompareActivityLayoutControl";
import CompareEmptySlot from "./CompareEmptySlot";
import CompareLoadingSlot from "./CompareLoadingSlot";
import CompareUserMessageBubble from "./CompareUserMessageBubble";
import { emitChatRenderProfileEvent } from "@/lib/chatRenderProfile";

type MarkdownRendererComponent = Parameters<typeof AssistantMessageContent>[0]["MarkdownRenderer"];

const COMPARE_COLUMN_CONTENT_VISIBILITY_STYLE: CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "auto 180px",
};
const COMPARE_COLUMN_SCROLL_STYLE: CSSProperties = {
  maxHeight: "min(72vh, calc(100vh - 280px))",
  overscrollBehavior: "contain",
};
const COMPARE_COLUMN_FADE_TOP_PX = 44;
const COMPARE_COLUMN_FADE_BOTTOM_PX = 56;
const MARKDOWN_HYDRATE_ROOT_MARGIN = "1800px 0px";
const SIMPLE_ASSISTANT_VIEWPORT_OBSERVER_SKIP_LENGTH = 500;

type ScrollEdgeState = {
  canScroll: boolean;
  atTop: boolean;
  atBottom: boolean;
};

function getVisibleChatHistoryScroller(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return Array.from(document.querySelectorAll('[data-testid="chat-history-scroll-container"]'))
    .find((node): node is HTMLElement => node instanceof HTMLElement && node.offsetParent !== null && node.clientHeight > 0) || null;
}


function getCompareColumnScrollStorageKey(conversationId: number | undefined, messageId: string | number | undefined) {
  return `ai-space:chat:compare-column-scroll:${conversationId ?? "new"}:${messageId ?? "none"}`;
}

function getScrollEdgeState(el: HTMLElement): ScrollEdgeState {
  const canScroll = el.scrollHeight > el.clientHeight + 1;
  return {
    canScroll,
    atTop: el.scrollTop <= 1,
    atBottom: !canScroll || el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
  };
}

function getMarkdownWeight(content?: string) {
  const text = content || "";
  const codeFenceCount = (text.match(/```/g) || []).length;
  const tableLineCount = text.split("\n").filter((line) => /^\s*\|.+\|\s*$/.test(line)).length;
  return {
    codeFenceCount,
    tableLineCount,
    hasCodeFence: codeFenceCount > 0,
    hasTableLine: tableLineCount > 0,
  };
}

function shouldSkipViewportObserversForAssistant(content?: string) {
  if (!content || content.length > SIMPLE_ASSISTANT_VIEWPORT_OBSERVER_SKIP_LENGTH) return false;
  const weight = getMarkdownWeight(content);
  return !weight.hasCodeFence && !weight.hasTableLine;
}

type CompareColumnTurnProps = {
  userMessage: Message;
  assistantMessage?: Message;
  model?: ChatModel;
  badgeGroup?: InferredGroup;
  activeAssistantId?: string;
  columnIndex?: number;
  onSelectAssistant?: (assistantId: string) => void;
  modelById: Map<string, ChatModel>;
  isLastGroup: boolean;
  isSingleChat: boolean;
  isLoading: boolean;
  isComplexTask: boolean;
  conversationId?: number;
  deepReasoningLabel: string;
  imageLoadFailedLabel: string;
  MarkdownRenderer: MarkdownRendererComponent;
  onCopy: (content: string) => void;
  onRegenerate?: () => void;
  onRetryColumn?: () => void;
  onContinueGenerate?: () => void;
  onShareSelectMode: (id: string) => void;
  onFavoriteSelectMode: (id: string) => void;
  isFavorited: (serverMessageId: number) => boolean;
  onForkCompare?: (messageId: number) => void;
  onSaveToNote?: (content: string) => void;
  onAssistantViewed?: (messageId: string) => void;
  onOpenActivity?: (message: Message, layout: CompareActivityLayout) => void;
  isActivityOpen?: boolean;
  activityLayout?: CompareActivityLayout;
  isInitialReadingAssistant?: boolean;
  isViewedAssistant?: boolean;
  historyPrependSettling?: boolean;
  useContentVisibility?: boolean;
  deferRichTextHydration?: boolean;
  deferOffscreenRichTextHydration?: boolean;
  allowRichLiteFallback?: boolean;
  stabilizeInitialRichText?: boolean;
  suppressRowMarker?: boolean;
  showUserMessage?: boolean;
};

function CompareColumnTurn({
  userMessage,
  assistantMessage: msg,
  model,
  badgeGroup,
  activeAssistantId,
  columnIndex = 0,
  onSelectAssistant,
  modelById,
  isLastGroup,
  isSingleChat,
  isLoading,
  isComplexTask,
  conversationId,
  deepReasoningLabel,
  imageLoadFailedLabel,
  MarkdownRenderer,
  onCopy,
  onRegenerate,
  onRetryColumn,
  onContinueGenerate,
  onShareSelectMode,
  onFavoriteSelectMode,
  isFavorited,
  onForkCompare,
  onSaveToNote,
  onAssistantViewed,
  onOpenActivity,
  isActivityOpen = false,
  activityLayout = "inline",
  isInitialReadingAssistant = false,
  isViewedAssistant = false,
  historyPrependSettling = false,
  useContentVisibility = true,
  deferRichTextHydration = false,
  deferOffscreenRichTextHydration = false,
  allowRichLiteFallback = false,
  stabilizeInitialRichText = false,
  suppressRowMarker = false,
  showUserMessage = true,
}: CompareColumnTurnProps) {
  const { t } = useI18n();
  const renderStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const columnScrollRef = useRef<HTMLDivElement | null>(null);
  const profileSnapshotRef = useRef<Record<string, unknown> | null>(null);
  const [openBadgeMenu, setOpenBadgeMenu] = useState(false);
  const [scrollEdgeState, setScrollEdgeState] = useState<ScrollEdgeState>({ canScroll: false, atTop: true, atBottom: true });
  const [rightHalfFocused, setRightHalfFocused] = useState(false);
  const showBadgeSwitcher = !!badgeGroup && badgeGroup.assistantMessages.length > 2 && !!onSelectAssistant;
  const ownerLabel = columnIndex === 0 ? "左列" : columnIndex === 1 ? "右列" : `第 ${columnIndex + 1} 列`;
  const terminalMessage = !!msg && isTerminalMessage(msg);
  const columnScrollMaskStyle = scrollEdgeState.canScroll
    ? {
        WebkitMaskImage: `linear-gradient(to bottom, ${scrollEdgeState.atTop ? "#000 0" : "transparent 0, #000 " + COMPARE_COLUMN_FADE_TOP_PX + "px"}, #000 calc(100% - ${scrollEdgeState.atBottom ? 0 : COMPARE_COLUMN_FADE_BOTTOM_PX}px), ${scrollEdgeState.atBottom ? "#000 100%" : "transparent 100%"})`,
        maskImage: `linear-gradient(to bottom, ${scrollEdgeState.atTop ? "#000 0" : "transparent 0, #000 " + COMPARE_COLUMN_FADE_TOP_PX + "px"}, #000 calc(100% - ${scrollEdgeState.atBottom ? 0 : COMPARE_COLUMN_FADE_BOTTOM_PX}px), ${scrollEdgeState.atBottom ? "#000 100%" : "transparent 100%"})`,
      } satisfies CSSProperties
    : undefined;
  const hasLiveGenerationSignal = !!msg && !terminalMessage && !!(
    msg.activityStatus ||
    msg.serverMessageId ||
    msg.generationTaskId ||
    msg.backgroundTaskId ||
    msg.useBackground ||
    msg.isComplexTask
  );
  const isStreaming = !!msg && isLastGroup && !terminalMessage && (isLoading || hasLiveGenerationSignal) && isMessageGenerating(msg, true);
  const isGenerating = !!msg && isMessageGenerating(msg, isStreaming);
  const hasReasoningEntry = Boolean(msg?.reasoningContent?.trim() || /<think>[\s\S]*?<\/think>/i.test(msg?.content || ""));
  const canRegenerate = !!msg && !!onRetryColumn && terminalMessage && !isGenerating;
  const forceHydrateRichText = !!msg && (isLastGroup || isInitialReadingAssistant);
  const skipViewportObservers = !!msg && !deferOffscreenRichTextHydration && shouldSkipViewportObserversForAssistant(msg.content);
  const initialViewportState = forceHydrateRichText || skipViewportObservers;
  const [isNearViewport, setIsNearViewport] = useState(initialViewportState);
  const [isInViewport, setIsInViewport] = useState(initialViewportState);
  const canBypassBrowsingHydrationDefer = forceHydrateRichText && !isStreaming;
  const blockRichTextHydration = historyPrependSettling || (deferRichTextHydration && !canBypassBrowsingHydrationDefer);
  const forceStableRichLiteFallback = blockRichTextHydration || stabilizeInitialRichText || (forceHydrateRichText && !isInViewport);
  const markdownWeight = getMarkdownWeight(msg?.content);
  const profileSnapshot = msg ? {
    allowRichLiteFallback,
    blockRichTextHydration,
    canBypassBrowsingHydrationDefer,
    canRegenerate,
    codeFenceCount: markdownWeight.codeFenceCount,
    contentLength: msg.content?.length || 0,
    deferRichTextHydration,
    forceHydrateRichText,
    forceStableRichLiteFallback,
    hasCodeFence: markdownWeight.hasCodeFence,
    hasTableLine: markdownWeight.hasTableLine,
    historyPrependSettling,
    isGenerating,
    isInViewport,
    isInitialReadingAssistant,
    isLastGroup,
    isLoading,
    isNearViewport,
    isStreaming,
    isViewedAssistant,
    skipViewportObservers,
    tableLineCount: markdownWeight.tableLineCount,
  } : null;
  const previousProfileSnapshot = profileSnapshotRef.current;
  const changedProfileKeys = profileSnapshot
    ? previousProfileSnapshot
      ? Object.entries(profileSnapshot)
        .filter(([key, value]) => previousProfileSnapshot[key] !== value)
        .map(([key]) => key)
      : ["mount"]
    : undefined;
  if (profileSnapshot) profileSnapshotRef.current = profileSnapshot;
  const columnScrollStorageKey = getCompareColumnScrollStorageKey(conversationId, msg?.id);
  const updateColumnScrollEdgeState = useCallback(() => {
    const el = columnScrollRef.current;
    if (!el) return;
    setScrollEdgeState(getScrollEdgeState(el));
  }, []);
  const persistColumnScrollTop = useCallback((el: HTMLElement) => {
    setScrollEdgeState(getScrollEdgeState(el));
    try {
      window.sessionStorage.setItem(columnScrollStorageKey, String(Math.round(el.scrollTop)));
    } catch {}
  }, [columnScrollStorageKey]);
  const handleColumnScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    persistColumnScrollTop(event.currentTarget);
  }, [persistColumnScrollTop]);
  const isPointerInRightHalf = useCallback((event: { clientX: number; currentTarget: HTMLElement }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX >= rect.left + rect.width / 2;
  }, []);

  const handleColumnMouseMove = useCallback((event: MouseEvent<HTMLDivElement>) => {
    setRightHalfFocused(isPointerInRightHalf(event));
  }, [isPointerInRightHalf]);

  const handleColumnMouseLeave = useCallback(() => {
    setRightHalfFocused(false);
  }, []);


  useEffect(() => {
    const el = columnScrollRef.current;
    if (!el) return;
    const handleNativeWheel = (event: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      const inRightHalf = event.clientX >= rect.left + rect.width / 2;
      if (inRightHalf) {
        const nestedActivityScroll = event.target instanceof Element
          ? event.target.closest('[data-chat-activity-scroll="true"]')
          : null;
        const atTop = el.scrollTop <= 1;
        const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
        const canScrollUp = event.deltaY < 0 && !atTop;
        const canScrollDown = event.deltaY > 0 && !atBottom;
        if (nestedActivityScroll instanceof HTMLElement && el.contains(nestedActivityScroll)) {
          const activityAtTop = nestedActivityScroll.scrollTop <= 1;
          const activityAtBottom = nestedActivityScroll.scrollTop + nestedActivityScroll.clientHeight >= nestedActivityScroll.scrollHeight - 1;
          const canActivityScrollUp = event.deltaY < 0 && !activityAtTop;
          const canActivityScrollDown = event.deltaY > 0 && !activityAtBottom;
          if (canActivityScrollUp || canActivityScrollDown) {
            event.stopPropagation();
            return;
          }
          if (canScrollUp || canScrollDown) {
            event.preventDefault();
            event.stopPropagation();
            el.scrollTop += event.deltaY;
            window.requestAnimationFrame(() => persistColumnScrollTop(el));
            return;
          }
        }
        if (canScrollUp || canScrollDown) event.stopPropagation();
        return;
      }
      const outer = getVisibleChatHistoryScroller();
      if (!outer) return;
      event.preventDefault();
      event.stopPropagation();
      outer.scrollTop += event.deltaY;
    };
    el.addEventListener('wheel', handleNativeWheel, { capture: true, passive: false });
    return () => el.removeEventListener('wheel', handleNativeWheel, { capture: true });
  }, [persistColumnScrollTop]);

  useLayoutEffect(() => {
    const el = columnScrollRef.current;
    if (!el || !msg) return;
    let restoredTop = 0;
    try {
      restoredTop = Number(window.sessionStorage.getItem(columnScrollStorageKey) || 0);
    } catch {}
    if (Number.isFinite(restoredTop) && restoredTop > 0) {
      el.scrollTop = Math.min(restoredTop, Math.max(0, el.scrollHeight - el.clientHeight));
    }
    updateColumnScrollEdgeState();
    const raf = window.requestAnimationFrame(updateColumnScrollEdgeState);
    const timer = window.setTimeout(updateColumnScrollEdgeState, 180);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [activityLayout, columnScrollStorageKey, isActivityOpen, msg?.content?.length, msg?.id, msg?.reasoningContent?.length, updateColumnScrollEdgeState]);

  useEffect(() => {
    if (!msg) return;
    const commitAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    emitChatRenderProfileEvent("compare-column-commit", {
      conversationId,
      messageId: msg.id,
      role: msg.role,
      ...(changedProfileKeys ? { changedKeys: changedProfileKeys } : {}),
      contentLength: msg.content?.length || 0,
      durationMs: commitAt - renderStartedAt,
      ...(profileSnapshot || {}),
    });
  });

  useEffect(() => {
    if (!msg) return;
    setIsNearViewport(initialViewportState);
    setIsInViewport(initialViewportState);
  }, [initialViewportState, msg?.id]);

  useEffect(() => {
    if (!msg) return;
    if (skipViewportObservers) {
      setIsNearViewport(true);
      return;
    }
    if (forceHydrateRichText) {
      setIsNearViewport(true);
      return;
    }
    if (isNearViewport) return;
    const row = rowRef.current;
    if (!row || !("IntersectionObserver" in window)) {
      setIsNearViewport(true);
      return;
    }
    const root = row.closest('[data-testid="chat-history-scroll-container"], [data-testid="chat-history-scroll-container"]') as Element | null;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setIsNearViewport(true);
        emitChatRenderProfileEvent("compare-column-markdown-near-viewport", {
          conversationId,
          messageId: msg.id,
          contentLength: msg.content?.length || 0,
        });
        observer.disconnect();
      }
    }, { root, rootMargin: deferOffscreenRichTextHydration ? "0px" : MARKDOWN_HYDRATE_ROOT_MARGIN });
    observer.observe(row);
    return () => observer.disconnect();
  }, [conversationId, deferOffscreenRichTextHydration, forceHydrateRichText, isNearViewport, msg, skipViewportObservers]);

  useEffect(() => {
    if (!msg) return;
    if (skipViewportObservers) {
      setIsInViewport(true);
      return;
    }
    if (forceHydrateRichText) {
      setIsInViewport(true);
      return;
    }
    const row = rowRef.current;
    if (!row || !("IntersectionObserver" in window)) {
      setIsInViewport(true);
      return;
    }
    const root = row.closest('[data-testid="chat-history-scroll-container"], [data-testid="chat-history-scroll-container"]') as Element | null;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      setIsInViewport(visible);
      if (visible) {
        onAssistantViewed?.(String(msg.id));
        emitChatRenderProfileEvent("compare-column-markdown-in-viewport", {
          conversationId,
          messageId: msg.id,
          forceStableRichLiteFallback,
          isInitialReadingAssistant,
          isViewedAssistant,
          contentLength: msg.content?.length || 0,
        });
      }
    }, { root, rootMargin: "0px" });
    observer.observe(row);
    return () => observer.disconnect();
  }, [conversationId, forceHydrateRichText, forceStableRichLiteFallback, isInitialReadingAssistant, isViewedAssistant, msg, onAssistantViewed, skipViewportObservers]);

  return (
    <div
      ref={rowRef}
      data-chat-message-row={suppressRowMarker ? undefined : "true"}
      data-chat-compare-column-turn="true"
      data-message-id={suppressRowMarker ? undefined : userMessage.id}
      data-message-role={suppressRowMarker ? undefined : "user"}
      style={useContentVisibility ? COMPARE_COLUMN_CONTENT_VISIBILITY_STYLE : undefined}
      className="flex h-full flex-col gap-3"
    >
      {showUserMessage && <CompareUserMessageBubble message={userMessage} imageLoadFailedLabel={imageLoadFailedLabel} />}
      <div className="flex flex-1 flex-col">
        {msg ? (
          <div
            className={cn(
              "group flex gap-3 animate-message-appear rounded-3xl px-2 py-2 -mx-2 -my-2 transition-colors duration-200",
              rightHalfFocused && "bg-slate-500/[0.055] dark:bg-white/[0.06] green:bg-black/[0.045]"
            )}
            data-compare-column-focus-zone={rightHalfFocused ? "right" : "page"}
            onMouseMove={handleColumnMouseMove}
            onMouseLeave={handleColumnMouseLeave}
          >
            <div className="mt-1 w-7 shrink-0">
              <div className="relative">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (showBadgeSwitcher) setOpenBadgeMenu((open) => !open);
                  }}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg border border-surface-border bg-surface-card",
                    showBadgeSwitcher && "cursor-pointer hover:bg-surface-elevated"
                  )}
                >
                  {model ? (
                    <ModelAvatar meta={getModelAvatarMeta(model)} size="lg" className="h-full w-full rounded-lg" />
                  ) : (
                    <Bot className="h-4 w-4 text-text-secondary" />
                  )}
                  {showBadgeSwitcher && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full border border-white bg-brand text-[8px] font-bold text-white dark:border-[#1F1F1F]">
                      {badgeGroup.assistantMessages.length}
                    </span>
                  )}
                </button>
                {showBadgeSwitcher && openBadgeMenu && (
                  <div className="absolute left-0 top-full z-50 mt-1.5 flex w-44 flex-col gap-0.5 rounded-xl border border-surface-border bg-surface-elevated px-1.5 py-1.5 shadow-xl">
                    {badgeGroup.assistantMessages.map((assistant, idx) => {
                      const avatarModel = assistant.model ? modelById.get(assistant.model) : undefined;
                      const avatarMeta = getModelAvatarMeta(avatarModel || assistant.model || "AI");
                      const isActive = activeAssistantId === assistant.id;
                      return (
                        <button
                          key={assistant.id}
                          type="button"
                          onClick={() => {
                            onSelectAssistant?.(assistant.id);
                            setOpenBadgeMenu(false);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                            isActive ? "bg-surface-card font-medium text-text-primary shadow-sm" : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                          )}
                        >
                          <ModelAvatar meta={avatarMeta} size="xs" />
                          <span className="truncate text-xs">{avatarModel?.name || assistant.model || t("chat.model.fallback", { index: String(idx + 1) })}</span>
                          {isActive && <Check className="ml-auto h-3 w-3 shrink-0 text-text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="w-full max-w-full bg-transparent px-0 py-1">
                <div>
                  <div className="min-w-0">
                    <div className="mb-2 flex items-center gap-2">
                      {model && <AssistantMessageMeta msg={msg} isStreaming={isStreaming} model={model} compact inlineStatus />}
                    </div>
                    <div className="relative rounded-2xl border border-transparent bg-transparent" data-compare-column-scroll-frame="true">
                      <div
                        ref={columnScrollRef}
                        data-compare-column-scroll-container="true"
                        data-compare-column-model={model?.id || msg.model || ""}
                        data-compare-column-can-scroll={scrollEdgeState.canScroll ? "true" : "false"}
                        data-compare-column-at-top={scrollEdgeState.atTop ? "true" : "false"}
                        data-compare-column-at-bottom={scrollEdgeState.atBottom ? "true" : "false"}
                        className="compare-column-scroll-container overflow-y-auto overflow-x-hidden px-3 py-2 pr-3 [scrollbar-gutter:stable]"
                        style={{ ...COMPARE_COLUMN_SCROLL_STYLE, ...columnScrollMaskStyle }}
                        onScroll={handleColumnScroll}
                      >
                        <div className={cn("pb-5", isActivityOpen && activityLayout === "split" && "grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.72fr)]") }>
                          <div className="min-w-0">
                          <AssistantMessageContent
                            message={msg}
                            isStreaming={isStreaming}
                            MarkdownRenderer={MarkdownRenderer}
                            recoverEmptyContent
                            onRegenerate={onRegenerate}
                            onOpenActivity={() => onOpenActivity?.(msg, activityLayout)}
                            inlineActivity={isActivityOpen && activityLayout === "inline" ? <ChatActivityPanel message={msg} model={model} onClose={() => onOpenActivity?.(msg, activityLayout)} variant="inline" ownerLabel={ownerLabel} /> : undefined}
                            shouldHydrateRichText={!blockRichTextHydration && (isNearViewport || forceHydrateRichText)}
                            priorityHydrateRichText={!blockRichTextHydration && (forceHydrateRichText || stabilizeInitialRichText || deferOffscreenRichTextHydration)}
                            allowRichLiteFallback={allowRichLiteFallback || forceStableRichLiteFallback || isInitialReadingAssistant || isViewedAssistant}
                            compactRichLitePreview={!historyPrependSettling && !forceStableRichLiteFallback && !isInitialReadingAssistant && !isViewedAssistant}
                          />
                          {msg.stopped && onContinueGenerate && (
                            <button
                              onClick={onContinueGenerate}
                              className="mt-3 flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-surface-card hover:text-text-primary"
                            >
                              <Play className="h-3.5 w-3.5" />
                              {t("chat.action.continueGenerate")}
                            </button>
                          )}
                        </div>
                        {isActivityOpen && activityLayout === "split" && (
                          <div className="min-w-0">
                            <ChatActivityPanel message={msg} model={model} onClose={() => onOpenActivity?.(msg, activityLayout)} variant="embedded" ownerLabel={ownerLabel} />
                          </div>
                        )}
                      </div>
                      </div>
                      {scrollEdgeState.canScroll && (
                        <>
                          <div
                            data-compare-column-scroll-shadow="top"
                            className={cn("pointer-events-none absolute inset-x-px top-0 h-14 rounded-t-2xl transition-opacity duration-150", scrollEdgeState.atTop ? "opacity-0" : "opacity-100")}
                            aria-hidden="true"
                          />
                          <div
                            data-compare-column-scroll-shadow="bottom"
                            className={cn("pointer-events-none absolute inset-x-px bottom-0 h-16 rounded-b-2xl transition-opacity duration-150", scrollEdgeState.atBottom ? "opacity-0" : "opacity-100")}
                            aria-hidden="true"
                          />
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              {!isStreaming && (
                <div className="sticky bottom-1 z-[2] mt-1 flex items-center gap-2 rounded-xl bg-surface/80 px-2 py-1 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <MessageActions
                    onCopy={() => onCopy(msg.content)}
                    onRegenerate={onRetryColumn || onRegenerate}
                    onShareSelectMode={() => onShareSelectMode(msg.id)}
                    onFavoriteSelectMode={msg.serverMessageId && conversationId ? () => onFavoriteSelectMode(msg.id) : undefined}
                    isFavorited={msg.serverMessageId ? isFavorited(msg.serverMessageId) : false}
                    showRegenerate={canRegenerate}
                    align="left"
                    visible={isLastGroup}
                    createdAt={msg.createdAt}
                    completedAt={msg.completedAt}
                    onForkCompare={undefined}
                    onSaveToNote={msg.content && onSaveToNote ? () => onSaveToNote(msg.content) : undefined}
                  />
                </div>
              )}
            </div>
          </div>
        ) : isLoading && isLastGroup ? (
          <CompareLoadingSlot isComplexTask={isComplexTask} deepReasoningLabel={deepReasoningLabel} />
        ) : (
          <CompareEmptySlot isSingleChat={isSingleChat} />
        )}
      </div>
    </div>
  );
}

export default memo(CompareColumnTurn);
