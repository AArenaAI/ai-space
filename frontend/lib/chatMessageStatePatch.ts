import type { ChatStatusTimelineStep } from "./chatStatusTimeline";

export type ChatMessageLike = {
  id: string;
  content: string;
  reasoningContent?: string;
  lastSequence?: number;
  serverMessageId?: number;
  groupId?: number;
  userMessageId?: number;
  groupModels?: string[];
  groupIndex?: number;
  generationStartedAt?: number;
  statusTimeline?: ChatStatusTimelineStep[];
};

export type MessagePatch<T> = Partial<T> | ((message: T) => Partial<T>);

export function patchMessageById<T extends { id: string }>(messages: T[], messageId: string, patch: MessagePatch<T>): T[] {
  return messages.map((message) => {
    if (message.id !== messageId) return message;
    const resolvedPatch = typeof patch === "function" ? patch(message) : patch;
    return { ...message, ...resolvedPatch };
  });
}

export type ApplyFinalRealtimeDataOptions = {
  finalContent?: string;
  finalData?: Record<string, any> | null;
  latestSequence?: number;
  forceContentFallback?: boolean;
};

export function applyFinalRealtimeDataToMessage<T extends ChatMessageLike>(
  message: T,
  { finalContent = "", finalData, latestSequence, forceContentFallback = false }: ApplyFinalRealtimeDataOptions
): T {
  const next: T = { ...message };
  const realtimeContent = typeof finalData?.content === "string" ? finalData.content : "";
  const nextContent = realtimeContent || finalContent;
  if (nextContent || forceContentFallback) {
    next.content = nextContent || message.content;
  }
  if (typeof finalData?.reasoningContent === "string") {
    next.reasoningContent = finalData.reasoningContent;
  }
  if (typeof finalData?.generationStartedAt === "number") {
    next.generationStartedAt = finalData.generationStartedAt;
  }
  if (Array.isArray(finalData?.statusTimeline)) {
    next.statusTimeline = finalData.statusTimeline;
  }
  if (typeof latestSequence === "number") {
    next.lastSequence = Math.max(message.lastSequence || 0, latestSequence);
  }
  if (finalData) {
    Object.assign(next, finalData);
  }
  return next;
}

export type CompareGroupContextPatch = {
  groupId?: number;
  userMessageId?: number;
  groupModels: string[];
};

export type ApplyCompareGroupContextOptions = {
  userMessageId: string;
  assistantIds: string[];
  context: CompareGroupContextPatch;
};

export function applyCompareGroupContextToMessages<T extends ChatMessageLike>(
  messages: T[],
  { userMessageId, assistantIds, context }: ApplyCompareGroupContextOptions
): T[] {
  return messages.map((message) => {
    if (message.id === userMessageId) {
      return { ...message, serverMessageId: context.userMessageId };
    }
    const groupIndex = assistantIds.indexOf(message.id);
    if (groupIndex !== -1) {
      return {
        ...message,
        groupId: context.groupId,
        userMessageId: context.userMessageId,
        groupModels: context.groupModels,
        groupIndex,
      };
    }
    return message;
  });
}
