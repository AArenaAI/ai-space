export type ChatLocalMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model?: string;
  createdAt: number;
};

export function buildCreateConversationFailureMessage(input: {
  id: string;
  modelId: string;
  createdAt: number;
}): ChatLocalMessage {
  return {
    id: input.id,
    role: "assistant",
    content: "❌ 创建对话失败，请检查登录状态或刷新页面重试",
    model: input.modelId,
    createdAt: input.createdAt,
  };
}

export function appendCreateConversationFailureMessage<Message extends ChatLocalMessage>(
  messages: Message[],
  failureMessage: Message
): Message[] {
  return [...messages, failureMessage];
}

export type ClearMessagesState = {
  messages: ChatLocalMessage[];
  currentConversation?: number;
};

export function buildClearMessagesState(): ClearMessagesState {
  return {
    messages: [],
    currentConversation: undefined,
  };
}

export function findLastUserMessage<Message extends { role: string; content: string }>(messages: Message[]): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") return message;
  }
  return undefined;
}

export type RegenerateRequest = {
  content: string;
  shouldRegenerate: true;
};

export function buildRegenerateRequest<Message extends { role: string; content: string }>(
  messages: Message[]
): RegenerateRequest | undefined {
  const lastUserMessage = findLastUserMessage(messages);
  if (!lastUserMessage) return undefined;
  return {
    content: lastUserMessage.content,
    shouldRegenerate: true,
  };
}

export function switchGroupView(previous: Map<number, number>, groupId: number, activeIndex: number): Map<number, number> {
  const next = new Map(previous);
  next.set(groupId, activeIndex);
  return next;
}
