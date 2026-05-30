"use client";

import type { ComponentType } from "react";
import { Message } from "@/lib/chatTypes";
import { cn } from "@/lib/utils";
import { isMessageGenerating, parseThinkContent, sanitizeContent } from "@/lib/chatContent";
import { DeferredMarkdownRenderer } from "./DeferredMarkdownRenderer";
import { StreamingText } from "./StreamingText";
import { ThinkBlock } from "./ThinkBlock";

type MarkdownRendererComponent = ComponentType<{ content: string }>;

function mayStillRecoverMessage(msg: Message) {
  return !msg.completedAt && !msg.stopped && !!(
    msg.activityStatus ||
    msg.serverMessageId ||
    msg.generationTaskId ||
    msg.backgroundTaskId ||
    msg.useBackground ||
    msg.isComplexTask
  );
}

export function AssistantMessageContent({
  message,
  isStreaming,
  className,
  MarkdownRenderer = DeferredMarkdownRenderer,
  recoverEmptyContent = false,
}: {
  message: Message;
  isStreaming: boolean;
  className?: string;
  MarkdownRenderer?: MarkdownRendererComponent;
  recoverEmptyContent?: boolean;
}) {
  const generating = isMessageGenerating(message, isStreaming);

  if (generating || (!message.content && recoverEmptyContent && mayStillRecoverMessage(message))) {
    return (
      <StreamingText
        messageId={message.id}
        content={message.content || ""}
        isStreaming={true}
        className="text-[15px] leading-relaxed text-text-primary"
      />
    );
  }

  if (!message.content) {
    return <div className="text-[15px] leading-relaxed text-text-secondary">生成中断，可点击重新生成</div>;
  }

  const { reasoning, answer, isThinking } = parseThinkContent(message.content);
  const cleanAnswer = sanitizeContent(answer);

  return (
    <div className={cn("prose prose-sm max-w-none", className)}>
      {reasoning && <ThinkBlock content={reasoning} isThinking={isThinking} />}
      <MarkdownRenderer content={cleanAnswer} />
    </div>
  );
}
