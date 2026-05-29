export type ChatRequestHeadersOptions = {
  token?: string | null;
  guestId: string;
};

export function buildChatRequestHeaders({ token, guestId }: ChatRequestHeadersOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else {
    headers["X-Guest-ID"] = guestId;
  }
  return headers;
}

export type ModelMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type CommonChatRequestOptions = {
  model: string;
  messages: ModelMessage[];
  conversationId?: number;
  reasoningEnabled: boolean;
  reasoningEffort?: string;
  search: boolean;
  templateId: number;
  skillKey?: string;
  messageFileIds?: string[];
};

export type SingleChatRequestOptions = CommonChatRequestOptions & {
  skipSaveUserMessage?: boolean;
};

export function buildSingleChatRequestBody({
  model,
  messages,
  conversationId,
  reasoningEnabled,
  reasoningEffort,
  search,
  templateId,
  skipSaveUserMessage = false,
  skillKey,
  messageFileIds,
}: SingleChatRequestOptions): Record<string, any> {
  return {
    model,
    messages,
    stream: true,
    conversation_id: conversationId,
    reasoning: reasoningEnabled,
    reasoning_effort: reasoningEffort || "high",
    search,
    template_id: templateId,
    skip_save_user_msg: skipSaveUserMessage,
    skill_key: skillKey || undefined,
    message_file_ids: messageFileIds || undefined,
  };
}

export type CompareChatRequestOptions = CommonChatRequestOptions & {
  templatePrefix?: string;
  skipSaveUserMessage: boolean;
  groupId?: number;
  userMessageId?: number;
  groupIndex: number;
  groupModels: string[];
  fallbackGroupModels: string[];
};

export function buildCompareChatRequestBody({
  model,
  messages,
  conversationId,
  reasoningEnabled,
  reasoningEffort,
  search,
  templateId,
  templatePrefix,
  skipSaveUserMessage,
  groupId,
  userMessageId,
  groupIndex,
  groupModels,
  fallbackGroupModels,
  skillKey,
  messageFileIds,
}: CompareChatRequestOptions): Record<string, any> {
  return {
    model,
    messages,
    stream: true,
    conversation_id: conversationId,
    reasoning: reasoningEnabled,
    reasoning_effort: reasoningEffort || "high",
    search,
    template_id: templateId,
    template_prefix: templatePrefix,
    skip_save_user_msg: skipSaveUserMessage,
    group_id: groupId,
    user_message_id: userMessageId,
    group_index: groupIndex,
    group_models: groupModels.length ? groupModels : fallbackGroupModels,
    skill_key: skillKey || undefined,
    message_file_ids: messageFileIds || undefined,
  };
}
