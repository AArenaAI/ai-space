"use client";

import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { User, Check, Play, SquareCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { ChatModel, Message } from "@/lib/chatTypes";
import { getModelAvatarMeta } from "@/lib/models/modelAvatars";
import type { InferredGroup } from "@/lib/groups";
import { isMessageGenerating } from "@/lib/chatContent";
import { isTerminalMessage, resolveChatMessageRuntimeState } from "@/lib/chatMessageRuntimeState";
import { isAssistantFailureState } from "@/lib/chatErrorState";
import { CHAT_MESSAGE_ROW_CLASS } from "./chatLayout";
import { useMessageRealtime } from "@/hooks/useMessageRealtime";
import { AssistantMessageMeta } from "./AssistantMessageMeta";
import MessageActions from "./MessageActions";
import UserMessageContent from "./UserMessageContent";
import { AssistantMessageContent } from "./AssistantMessageContent";
import { ModelAvatar } from "./ModelAvatar";
import { emitChatRenderProfileEvent } from "@/lib/chatRenderProfile";

type MarkdownRendererComponent = Parameters<typeof AssistantMessageContent>[0]["MarkdownRenderer"];

const MESSAGE_ROW_CONTENT_VISIBILITY_STYLE: CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "auto 180px",
};
const MARKDOWN_HYDRATE_ROOT_MARGIN = "1800px 0px";
const SIMPLE_ASSISTANT_VIEWPORT_OBSERVER_SKIP_LENGTH = 500;

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

export type MessageRowProps = {
  message: Message;
  displayMessageId?: string;
  group?: InferredGroup;
  model?: ChatModel;
  isLast: boolean;
  isLatestAssistant: boolean;
  isInitialReadingAssistant: boolean;
  isViewedAssistant: boolean;
  isLoading: boolean;
  selectMode: boolean;
  isSelected: boolean;
  isHighlighted: boolean;
  historyPrependSettling: boolean;
  deferRichTextHydration: boolean;
  allowRichLiteFallback: boolean;
  conversationId?: number;
  groupViews?: Map<number, number>;
  modelById: Map<string, ChatModel>;
  openAvatarDropdownGroupId: number | null;
  setOpenAvatarDropdownGroupId: (value: number | null | ((previous: number | null) => number | null)) => void;
  switchGroupModel?: (groupId: number, activeIndex: number) => void;
  toggleSelect: (id: string) => void;
  handleCopy: (content: string) => void;
  setDeleteTarget: (id: string) => void;
  enterSelectMode: (mode: "share" | "favorite", id: string) => void;
  isFavorited: (serverMessageId: number) => boolean;
  onRegenerate?: () => void;
  onContinueGenerate?: () => void;
  onForkCompare?: (messageId: number) => void;
  onSaveAssistantToNote?: (content: string) => void;
  imageLoadFailedLabel: string;
  MarkdownRenderer: MarkdownRendererComponent;
  onAssistantViewed?: (messageId: string) => void;
  onOpenActivity?: (message: Message) => void;
  useContentVisibility?: boolean;
  deferOffscreenRichTextHydration?: boolean;
  stabilizeInitialRichText?: boolean;
};

function MessageRow({
  message: msg,
  displayMessageId,
  group,
  model,
  isLast,
  isLatestAssistant,
  isInitialReadingAssistant,
  isViewedAssistant,
  isLoading,
  selectMode,
  isSelected,
  isHighlighted,
  historyPrependSettling,
  deferRichTextHydration,
  allowRichLiteFallback,
  conversationId,
  groupViews,
  modelById,
  openAvatarDropdownGroupId,
  setOpenAvatarDropdownGroupId,
  switchGroupModel,
  toggleSelect,
  handleCopy,
  setDeleteTarget,
  enterSelectMode,
  isFavorited,
  onRegenerate,
  onContinueGenerate,
  onForkCompare,
  onSaveAssistantToNote,
  imageLoadFailedLabel,
  MarkdownRenderer,
  onAssistantViewed,
  onOpenActivity,
  useContentVisibility = true,
  deferOffscreenRichTextHydration = false,
  stabilizeInitialRichText = false,
}: MessageRowProps) {
  const { t } = useI18n();
  const renderStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const profileSnapshotRef = useRef<Record<string, unknown> | null>(null);
  const isUser = msg.role === "user";
  const forceHydrateRichText = isLatestAssistant || isHighlighted;
  const skipViewportObservers = !deferOffscreenRichTextHydration && !isUser && shouldSkipViewportObserversForAssistant(msg.content);
  const initialViewportState = forceHydrateRichText || skipViewportObservers;
  const [isNearViewport, setIsNearViewport] = useState(initialViewportState);
  const [isInViewport, setIsInViewport] = useState(initialViewportState);
  const terminalMessage = isTerminalMessage(msg);
  const hasAssistantGenerationTask = Boolean(msg.generationTaskId || msg.backgroundTaskId || msg.activityStatus);
  const isStreaming = isLoading && msg.role === "assistant" && !terminalMessage && isLatestAssistant && hasAssistantGenerationTask;
  const realtime = useMessageRealtime(msg.id, isStreaming);
  const runtimeState = resolveChatMessageRuntimeState({ message: msg, realtime });
  const realtimeHasVisiblePayload = Boolean(
    runtimeState.content?.trim() ||
    runtimeState.answerContent?.trim() ||
    runtimeState.reasoningContent?.trim()
  );
  const canBypassBrowsingHydrationDefer = forceHydrateRichText && !isStreaming;
  const blockRichTextHydration = historyPrependSettling || (deferRichTextHydration && !canBypassBrowsingHydrationDefer);
  const forceStableRichLiteFallback = blockRichTextHydration || stabilizeInitialRichText || (forceHydrateRichText && !isInViewport);
  const isGenerating = !isUser && isMessageGenerating({ ...msg, ...runtimeState }, isStreaming);
  const assistantFailureMessage = { ...msg, content: runtimeState.content || msg.content, errorCode: runtimeState.errorCode || msg.errorCode, phase: runtimeState.phase };
  const isAssistantFailure = !isUser && isAssistantFailureState(assistantFailureMessage);
  const isEmptyPendingAssistant = !isUser && isGenerating && !realtimeHasVisiblePayload && !msg.content?.trim() && !msg.reasoningContent?.trim() && !runtimeState.terminal;
  const canRegenerate = !isUser && !isAssistantFailure && !msg.stopped && (isLast || !msg.content) && !isLoading && !isGenerating;
  const suppressAppearAnimation = historyPrependSettling || deferRichTextHydration || isGenerating || (!isUser && !msg.content?.trim() && !runtimeState.terminal);
  const assistantAvatarMeta = getModelAvatarMeta(model || msg.model || "AI");
  const rowProfileDetailEnabled = typeof window !== "undefined" && Boolean((window as Window & { __AI_SPACE_CHAT_ROW_PROFILE_DETAIL?: boolean }).__AI_SPACE_CHAT_ROW_PROFILE_DETAIL);
  const markdownWeight = rowProfileDetailEnabled ? getMarkdownWeight(msg.content) : null;
  const groupActiveIndex = group ? groupViews?.get(group.id) ?? 0 : undefined;
  const groupActiveMessageId = group && groupActiveIndex !== undefined ? group.assistantMessages[groupActiveIndex]?.id : undefined;
  const isGroupedAssistantMessage = !isUser && Boolean(group && group.assistantMessages.length > 1);
  const profileSnapshot = rowProfileDetailEnabled ? {
    allowRichLiteFallback,
    blockRichTextHydration,
    canBypassBrowsingHydrationDefer,
    canRegenerate,
    codeFenceCount: markdownWeight?.codeFenceCount || 0,
    contentLength: msg.content?.length || 0,
    deferRichTextHydration,
    forceHydrateRichText,
    forceStableRichLiteFallback,
    groupActiveIndex: groupActiveIndex ?? null,
    groupId: group?.id ?? null,
    groupSize: group?.assistantMessages.length || 0,
    hasCodeFence: markdownWeight?.hasCodeFence || false,
    hasTableLine: markdownWeight?.hasTableLine || false,
    historyPrependSettling,
    groupActiveState: isGroupedAssistantMessage ? (String(groupActiveMessageId) === String(msg.id) ? "active" : "inactive") : "na",
    isActiveGroupMessage: isGroupedAssistantMessage ? String(groupActiveMessageId) === String(msg.id) : true,
    isGenerating,
    isHighlighted,
    isInViewport,
    isInitialReadingAssistant,
    isLast,
    isLatestAssistant,
    isLoading,
    isNearViewport,
    isSelected,
    isStreaming,
    isViewedAssistant,
    openAvatarDropdown: openAvatarDropdownGroupId === group?.id,
    selectMode,
    skipViewportObservers,
    tableLineCount: markdownWeight?.tableLineCount || 0,
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
  useEffect(() => {
    const commitAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    emitChatRenderProfileEvent("message-row-commit", {
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
    if (isUser) return;
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
        emitChatRenderProfileEvent("message-row-markdown-near-viewport", {
          conversationId,
          messageId: msg.id,
          contentLength: msg.content?.length || 0,
        });
        observer.disconnect();
      }
    }, { root, rootMargin: deferOffscreenRichTextHydration ? "0px" : MARKDOWN_HYDRATE_ROOT_MARGIN });
    observer.observe(row);
    return () => observer.disconnect();
  }, [conversationId, deferOffscreenRichTextHydration, forceHydrateRichText, isNearViewport, isUser, msg.content, msg.id, skipViewportObservers]);

  useEffect(() => {
    if (isUser) return;
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
        emitChatRenderProfileEvent("message-row-markdown-in-viewport", {
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
  }, [conversationId, forceHydrateRichText, forceStableRichLiteFallback, isInitialReadingAssistant, isUser, isViewedAssistant, msg.content, msg.id, onAssistantViewed, skipViewportObservers]);

  return (
    <div
      ref={rowRef}
      data-chat-message-row="true"
      data-message-id={displayMessageId || msg.id}
      data-server-message-id={msg.serverMessageId ? String(msg.serverMessageId) : undefined}
      data-generation-task-id={msg.generationTaskId ? String(msg.generationTaskId) : undefined}
      data-message-role={msg.role}
      style={!isUser && useContentVisibility && !isGenerating && Boolean(msg.content?.trim() || msg.completedAt) && (msg.content?.length || 0) > 2000 ? MESSAGE_ROW_CONTENT_VISIBILITY_STYLE : undefined}
      className={cn(CHAT_MESSAGE_ROW_CLASS, "py-4 rounded-2xl", isHighlighted && "bg-brand/10")}
    >
      <div className={cn("flex gap-3 group", !suppressAppearAnimation && "animate-message-appear", isUser ? "justify-end" : "justify-start")}>
        <div className={cn("mt-1 shrink-0", isUser && !selectMode ? "w-7 invisible" : "w-7")}>
          {!isUser && !selectMode && (
            <div className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (group && group.assistantMessages.length > 1) {
                    setOpenAvatarDropdownGroupId((prev) => (prev === group.id ? null : group.id));
                  }
                }}
                className={cn(
                  "w-7 h-7 rounded-lg bg-surface-card border border-surface-border flex items-center justify-center relative avatar-dropdown-trigger transition-all duration-300",
                  group && group.assistantMessages.length > 1 && "cursor-pointer hover:bg-surface-elevated"
                )}
              >
                <ModelAvatar meta={assistantAvatarMeta} size="lg" className="h-full w-full rounded-lg" />
                {group && group.assistantMessages.length > 1 && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-brand text-[8px] font-bold text-white flex items-center justify-center border border-white dark:border-[#1F1F1F]">
                    {group.assistantMessages.length}
                  </span>
                )}
              </button>
              {openAvatarDropdownGroupId === group?.id && group && (
                <div className="avatar-dropdown absolute top-full left-0 mt-1.5 z-50 w-44 rounded-xl border border-surface-border bg-surface-elevated shadow-xl py-1.5 px-1.5 flex flex-col gap-0.5">
                  {group.assistantMessages.map((a, idx) => {
                    const avatarModel = a.model ? modelById.get(a.model) : undefined;
                    const avatarMeta = getModelAvatarMeta(avatarModel || a.model || "AI");
                    const isActive = (groupViews?.get(group.id) ?? 0) === idx;
                    return (
                      <button
                        key={a.id}
                        onClick={() => {
                          switchGroupModel?.(group.id, idx);
                          setOpenAvatarDropdownGroupId(null);
                        }}
                        className={cn(
                          "flex items-center gap-2 w-full px-2.5 py-2 text-left transition-colors rounded-lg",
                          isActive ? "bg-surface-card text-text-primary font-medium shadow-sm" : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                        )}
                      >
                        <ModelAvatar meta={avatarMeta} size="xs" />
                        <span className="text-xs truncate">{avatarModel?.name || a.model || t("chat.model.fallback", { index: String(idx + 1) })}</span>
                        {isActive && <Check className="w-3 h-3 text-text-primary shrink-0 ml-auto" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {isUser && selectMode && (
            <button
              onClick={() => toggleSelect(msg.id)}
              className={cn(
                "w-5 h-5 rounded-md border flex items-center justify-center transition-colors",
                isSelected
                  ? "border-slate-900 bg-slate-900 text-white shadow-sm dark:border-text-primary dark:bg-text-primary dark:text-surface"
                  : "border-surface-border text-transparent hover:border-text-tertiary/50"
              )}
            >
              {isSelected && <SquareCheck className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        <div className={cn("flex-1 flex min-w-0", isUser ? "justify-end" : "justify-start")}>
          <div className={cn("flex flex-col gap-1 min-w-0", isUser ? "items-end" : "items-start")}>
            <div
              className={cn(
                "relative max-w-full",
                isUser ? "w-fit px-4 py-3 rounded-2xl rounded-br-sm bg-surface-elevated shadow-sm" : "w-full px-0 py-1 rounded-none bg-transparent",
                isHighlighted && isUser && "ring-2 ring-brand/40 shadow-lg shadow-brand/10"
              )}
            >
              {!isUser && model && !selectMode && <AssistantMessageMeta msg={msg} isStreaming={isStreaming} model={model} compact={isEmptyPendingAssistant} inlineStatus onOpenActivity={() => onOpenActivity?.(msg)} />}
              {isUser ? (
                <UserMessageContent message={msg} imageLoadFailedLabel={imageLoadFailedLabel} />
              ) : (
                <>
                  <AssistantMessageContent message={msg} isStreaming={isStreaming} MarkdownRenderer={MarkdownRenderer} shouldHydrateRichText={!blockRichTextHydration && (isNearViewport || forceHydrateRichText)} priorityHydrateRichText={!blockRichTextHydration && (forceHydrateRichText || stabilizeInitialRichText || deferOffscreenRichTextHydration)} allowRichLiteFallback={allowRichLiteFallback || forceStableRichLiteFallback || isInitialReadingAssistant || isViewedAssistant} compactRichLitePreview={!historyPrependSettling && !forceStableRichLiteFallback && !isInitialReadingAssistant && !isViewedAssistant} recoverEmptyContent={isLast} onRegenerate={onRegenerate} onOpenActivity={() => onOpenActivity?.(msg)} />
                  {msg.stopped && !isAssistantFailure && msg.content?.trim() && onContinueGenerate && (
                    <button
                      onClick={onContinueGenerate}
                      className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-card border border-surface-border transition-colors"
                    >
                      <Play className="w-3.5 h-3.5" />
                      {t("chat.action.continueGenerate")}
                    </button>
                  )}
                </>
              )}
            </div>
            {!selectMode && !isStreaming && !isGenerating && (isUser || msg.content?.trim() || msg.completedAt || msg.stopped || msg.errorCode) && (
              <MessageActions
                onCopy={() => handleCopy(msg.content)}
                onDelete={() => setDeleteTarget(msg.id)}
                onRegenerate={onRegenerate}
                onShareSelectMode={() => enterSelectMode("share", msg.id)}
                onFavoriteSelectMode={msg.serverMessageId && conversationId ? () => enterSelectMode("favorite", msg.id) : undefined}
                isFavorited={msg.serverMessageId ? isFavorited(msg.serverMessageId) : false}
                showRegenerate={canRegenerate}
                align={isUser ? "right" : "left"}
                visible={isLast}
                createdAt={msg.createdAt}
                completedAt={msg.completedAt}
                onForkCompare={!isUser && msg.serverMessageId && conversationId ? () => onForkCompare?.(msg.serverMessageId!) : undefined}
                onSaveToNote={!isUser && msg.content && onSaveAssistantToNote ? () => onSaveAssistantToNote(msg.content) : undefined}
              />
            )}
          </div>
        </div>

        <div className="mt-1 w-7 shrink-0">
          {isUser && !selectMode && (
            <div className="w-7 h-7 rounded-lg bg-surface-card border border-surface-border flex items-center justify-center">
              <User className="w-4 h-4 text-text-secondary" />
            </div>
          )}
          {!isUser && selectMode && (
            <button
              onClick={() => toggleSelect(msg.id)}
              className={cn(
                "w-5 h-5 rounded-md border flex items-center justify-center transition-colors",
                isSelected
                  ? "border-slate-900 bg-slate-900 text-white shadow-sm dark:border-text-primary dark:bg-text-primary dark:text-surface"
                  : "border-surface-border text-transparent hover:border-text-tertiary/50"
              )}
            >
              {isSelected && <SquareCheck className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(MessageRow);
