import {
  buildMessageFiles,
  createAssistantChatMessage,
  createUserChatMessage,
  type ChatAttachmentInput,
  type FactoryChatMessage,
} from "./chatMessageFactory";
import { buildSingleChatRequestBody, type ModelMessage } from "./chatRequestBuilder";
import type { ChatStreamRunResult } from "./chatStreamRunResult";

export type SingleSendMessageLike = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model?: string;
  createdAt: number;
  files?: any[];
  search?: boolean;
  searchStatus?: "searching" | "completed" | "failed";
};

export type SingleSendPrepareMode = "regenerate" | "skip-user" | "normal";

export type PrepareSingleSendMessagesOptions<TMessage extends SingleSendMessageLike> = {
  content: string;
  messages: TMessage[];
  modelId: string;
  isRegenerate: boolean;
  skipUserMessage: boolean;
  attachments?: ChatAttachmentInput[];
  search: boolean;
  createId: () => string;
  now: () => number;
};

export type SingleSendMessagePlan<TMessage extends SingleSendMessageLike> = {
  mode: SingleSendPrepareMode;
  assistantMessage: TMessage;
  userMessage?: TMessage;
  contextMessages: TMessage[];
  lastUserIndex?: number;
  finalContent: string;
};

export function shouldStartSingleSend({
  content,
  isRegenerate,
  attachments,
}: {
  content: string;
  isRegenerate: boolean;
  attachments?: ChatAttachmentInput[];
}): boolean {
  return !!content.trim() || isRegenerate || !!attachments?.length;
}

export function buildNewConversationTitle(content: string, maxLength: number = 20): string {
  const trimmed = content.trim();
  return trimmed.slice(0, maxLength) + (trimmed.length > maxLength ? "..." : "");
}

export function prepareSingleSendMessages<TMessage extends SingleSendMessageLike>({
  content,
  messages,
  modelId,
  isRegenerate,
  skipUserMessage,
  attachments,
  search,
  createId,
  now,
}: PrepareSingleSendMessagesOptions<TMessage>): SingleSendMessagePlan<TMessage> | undefined {
  const finalContent = content.trim();

  if (isRegenerate) {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return undefined;
    const lastUserIndex = messages.findIndex((m) => m.id === lastUserMsg.id);
    const assistantMessage = createAssistantChatMessage({
      id: createId(),
      model: modelId,
      createdAt: now(),
      search,
    }) as TMessage;
    return {
      mode: "regenerate",
      assistantMessage,
      contextMessages: messages.slice(0, lastUserIndex + 1),
      lastUserIndex,
      finalContent,
    };
  }

  if (skipUserMessage) {
    const userFiles = buildMessageFiles(attachments);
    const assistantMessage = createAssistantChatMessage({
      id: createId(),
      model: modelId,
      createdAt: now(),
      search,
    }) as TMessage;
    const syntheticUserMessage = {
      role: "user",
      content: finalContent,
      id: "",
      createdAt: 0,
      files: userFiles,
    } as TMessage;
    return {
      mode: "skip-user",
      assistantMessage,
      contextMessages: [...messages, syntheticUserMessage],
      finalContent,
    };
  }

  const userFiles = buildMessageFiles(attachments);
  const userMessage = createUserChatMessage({
    id: createId(),
    content: finalContent,
    createdAt: now(),
    files: userFiles,
  }) as TMessage;
  const assistantMessage = createAssistantChatMessage({
    id: createId(),
    model: modelId,
    createdAt: now(),
    search,
  }) as TMessage;
  return {
    mode: "normal",
    assistantMessage,
    userMessage,
    contextMessages: [...messages, userMessage],
    finalContent,
  };
}

export function applySingleSendMessagePlan<TMessage extends SingleSendMessageLike>(
  previous: TMessage[],
  plan: SingleSendMessagePlan<TMessage>
): TMessage[] {
  if (plan.mode === "regenerate") {
    const lastUserIndex = plan.lastUserIndex ?? -1;
    const trimmed = previous.filter((message, index) => index <= lastUserIndex || message.role !== "assistant");
    return [...trimmed, plan.assistantMessage];
  }
  if (plan.mode === "skip-user") {
    return [...previous, plan.assistantMessage];
  }
  return [...previous, plan.userMessage!, plan.assistantMessage];
}

export type SingleChatRunReasoningOptions = {
  enabled: boolean;
  effort?: string;
};

export type RunSingleChatRequestOptions<TAssistant extends SingleSendMessageLike> = {
  apiBaseUrl?: string;
  headers: Record<string, string>;
  controller: AbortController;
  assistantMessage: TAssistant;
  modelId: string;
  modelMessages: ModelMessage[];
  conversationId?: number;
  notebookId?: number;
  reasoning: SingleChatRunReasoningOptions;
  search: boolean;
  templateId: number;
  skipSaveUserMessage: boolean;
  skillKey?: string;
  messageFileIds?: string[];
  fetchImpl?: typeof fetch;
  streamResponse: (
    response: Response,
    assistant: TAssistant,
    controller: AbortController,
    conversationId: number | undefined
  ) => Promise<ChatStreamRunResult | undefined>;
};

export async function runSingleChatRequest<TAssistant extends SingleSendMessageLike>({
  apiBaseUrl = "",
  headers,
  controller,
  assistantMessage,
  modelId,
  modelMessages,
  conversationId,
  notebookId,
  reasoning,
  search,
  templateId,
  skipSaveUserMessage,
  skillKey,
  messageFileIds,
  fetchImpl = fetch,
  streamResponse,
}: RunSingleChatRequestOptions<TAssistant>): Promise<ChatStreamRunResult | undefined> {
  const response = await fetchImpl(`${apiBaseUrl}/api/chat`, {
    method: "POST",
    headers,
    signal: controller.signal,
    body: JSON.stringify(buildSingleChatRequestBody({
      model: modelId,
      messages: modelMessages,
      conversationId,
      notebookId,
      reasoningEnabled: reasoning.enabled,
      reasoningEffort: reasoning.effort,
      search,
      templateId,
      skipSaveUserMessage,
      skillKey,
      messageFileIds,
    })),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorCode = errorBody.error || "unknown";
    const errorMsg = errorBody.message || "请求失败";
    throw Object.assign(new Error(errorMsg), { errorCode });
  }

  return streamResponse(response, assistantMessage, controller, conversationId);
}
