"use client";

import { memo } from "react";
import { Bot } from "lucide-react";
import type { ChatModel, Message } from "@/lib/chatTypes";
import { isMessageGenerating } from "@/lib/chatContent";
import { AssistantMessageMeta } from "./AssistantMessageMeta";
import { AssistantMessageContent } from "./AssistantMessageContent";
import MessageActions from "./MessageActions";
import CompareEmptySlot from "./CompareEmptySlot";
import CompareLoadingSlot from "./CompareLoadingSlot";
import CompareUserMessageBubble from "./CompareUserMessageBubble";

type MarkdownRendererComponent = Parameters<typeof AssistantMessageContent>[0]["MarkdownRenderer"];

type CompareColumnTurnProps = {
  userMessage: Message;
  assistantMessage?: Message;
  model?: ChatModel;
  isLastGroup: boolean;
  isSingleChat: boolean;
  isLoading: boolean;
  isComplexTask: boolean;
  conversationId?: number;
  deepReasoningLabel: string;
  imageLoadFailedLabel: string;
  MarkdownRenderer: MarkdownRendererComponent;
  onCopy: (content: string) => void;
  onDelete: (id: string) => void;
  onRegenerate?: () => void;
  onShareSelectMode: (id: string) => void;
  onFavoriteSelectMode: (id: string) => void;
  isFavorited: (serverMessageId: number) => boolean;
  onForkCompare?: (messageId: number) => void;
};

function CompareColumnTurn({
  userMessage,
  assistantMessage: msg,
  model,
  isLastGroup,
  isSingleChat,
  isLoading,
  isComplexTask,
  conversationId,
  deepReasoningLabel,
  imageLoadFailedLabel,
  MarkdownRenderer,
  onCopy,
  onDelete,
  onRegenerate,
  onShareSelectMode,
  onFavoriteSelectMode,
  isFavorited,
  onForkCompare,
}: CompareColumnTurnProps) {
  const hasLiveGenerationSignal = !!msg && !msg.completedAt && !msg.stopped && !!(
    msg.activityStatus ||
    msg.serverMessageId ||
    msg.generationTaskId ||
    msg.backgroundTaskId ||
    msg.useBackground ||
    msg.isComplexTask
  );
  const isStreaming = !!msg && isLastGroup && (isLoading || hasLiveGenerationSignal) && isMessageGenerating(msg, true);
  const isGenerating = !!msg && isMessageGenerating(msg, isStreaming);
  const canRegenerate = !!msg && isLastGroup && !isStreaming && !isGenerating;

  return (
    <div data-chat-message-row="true" className="flex h-full flex-col gap-3">
      <CompareUserMessageBubble message={userMessage} imageLoadFailedLabel={imageLoadFailedLabel} />
      <div className="flex flex-1 flex-col">
        {msg ? (
          <div className="group flex gap-3 animate-message-appear">
            <div className="mt-1 w-7 shrink-0">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-surface-border bg-surface-card">
                <Bot className="h-4 w-4 text-text-secondary" />
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="w-fit max-w-full rounded-2xl rounded-bl-sm bg-surface-elevated px-4 py-3">
                {model && <AssistantMessageMeta msg={msg} isStreaming={isStreaming} model={model} />}
                <AssistantMessageContent message={msg} isStreaming={isStreaming} MarkdownRenderer={MarkdownRenderer} recoverEmptyContent />
              </div>
              {!isStreaming && (
                <div className="flex items-center gap-2 px-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <MessageActions
                    onCopy={() => onCopy(msg.content)}
                    onDelete={() => onDelete(msg.id)}
                    onRegenerate={onRegenerate}
                    onShareSelectMode={() => onShareSelectMode(msg.id)}
                    onFavoriteSelectMode={msg.serverMessageId && conversationId ? () => onFavoriteSelectMode(msg.id) : undefined}
                    isFavorited={msg.serverMessageId ? isFavorited(msg.serverMessageId) : false}
                    showRegenerate={canRegenerate}
                    align="left"
                    visible={isLastGroup}
                    createdAt={msg.createdAt}
                    completedAt={msg.completedAt}
                    onForkCompare={msg.serverMessageId ? () => onForkCompare?.(msg.serverMessageId!) : undefined}
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
