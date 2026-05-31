"use client";

import { memo } from "react";
import { User, Bot, Check, Play, SquareCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatModel, Message } from "@/lib/chatTypes";
import type { InferredGroup } from "@/lib/groups";
import { isMessageGenerating } from "@/lib/chatContent";
import { AssistantMessageMeta } from "./AssistantMessageMeta";
import MessageActions from "./MessageActions";
import UserMessageContent from "./UserMessageContent";
import { AssistantMessageContent } from "./AssistantMessageContent";

type MarkdownRendererComponent = Parameters<typeof AssistantMessageContent>[0]["MarkdownRenderer"];

export type MessageRowProps = {
  message: Message;
  group?: InferredGroup;
  model?: ChatModel;
  isLast: boolean;
  isLoading: boolean;
  selectMode: boolean;
  isSelected: boolean;
  isHighlighted: boolean;
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
  imageLoadFailedLabel: string;
  MarkdownRenderer: MarkdownRendererComponent;
};

function MessageRow({
  message: msg,
  group,
  model,
  isLast,
  isLoading,
  selectMode,
  isSelected,
  isHighlighted,
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
  imageLoadFailedLabel,
  MarkdownRenderer,
}: MessageRowProps) {
  const isUser = msg.role === "user";
  const isStreaming = isLoading && msg.role === "assistant" && !msg.completedAt && isLast;
  const isGenerating = !isUser && isMessageGenerating(msg, isStreaming);
  const canRegenerate = !isUser && (isLast || !msg.content) && !isLoading && !isGenerating;

  return (
    <div className={cn("max-w-[800px] mx-auto px-4 py-4 rounded-2xl transition-colors duration-500", isHighlighted && "bg-brand/10")}>
      <div key={msg.id} className={cn("flex gap-3 animate-message-appear group", isUser ? "justify-end" : "justify-start")}>
        <div className={cn("mt-1 shrink-0", isUser && !selectMode ? "hidden" : "w-7")}>
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
                  "w-7 h-7 rounded-lg bg-surface-card border border-surface-border flex items-center justify-center relative avatar-dropdown-trigger",
                  group && group.assistantMessages.length > 1 && "cursor-pointer hover:bg-surface-elevated"
                )}
              >
                <Bot className="w-4 h-4 text-text-secondary" />
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
                        <div className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0" style={{ backgroundColor: avatarModel?.color }}>
                          {(avatarModel?.name || a.model || `模型${idx + 1}`).slice(0, 1).toUpperCase()}
                        </div>
                        <span className="text-xs truncate">{avatarModel?.name || a.model || `模型 ${idx + 1}`}</span>
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
                "px-4 py-3 relative w-fit max-w-full transition-shadow duration-500",
                isUser ? "rounded-2xl rounded-br-sm bg-[#EFF6FF] dark:bg-[#1E293B]" : "rounded-2xl rounded-bl-sm bg-[#F5F4F2] dark:bg-[#1F1F1F]",
                isHighlighted && "ring-2 ring-brand/40 shadow-lg shadow-brand/10"
              )}
            >
              {!isUser && model && !selectMode && <AssistantMessageMeta msg={msg} isStreaming={isStreaming} model={model} />}
              {isUser ? (
                <UserMessageContent message={msg} imageLoadFailedLabel={imageLoadFailedLabel} />
              ) : (
                <>
                  <AssistantMessageContent message={msg} isStreaming={isStreaming} MarkdownRenderer={MarkdownRenderer} recoverEmptyContent />
                  {msg.stopped && onContinueGenerate && (
                    <button
                      onClick={onContinueGenerate}
                      className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-card border border-surface-border transition-colors"
                    >
                      <Play className="w-3.5 h-3.5" />
                      继续生成
                    </button>
                  )}
                </>
              )}
            </div>
            {!selectMode && !isStreaming && (
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
                onForkCompare={isUser && msg.serverMessageId ? () => onForkCompare?.(msg.serverMessageId!) : undefined}
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
