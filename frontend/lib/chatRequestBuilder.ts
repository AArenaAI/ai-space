export function getClientTimezone(): string | undefined {
  if (typeof Intl === "undefined") return undefined;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export type ChatRequestHeadersOptions = {
  token?: string | null;
  guestId: string;
};

export function buildChatRequestHeaders({ token, guestId }: ChatRequestHeadersOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token && token !== "null" && token !== "undefined") {
    headers.Authorization = `Bearer ${token}`;
  }
  if (guestId) {
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
  notebookId?: number;
  reasoningEnabled: boolean;
  reasoningEffort?: string;
  search: boolean;
  templateId: number;
  skillKey?: string;
  messageFileIds?: string[];
  notebookFileIds?: number[];
  clientTimezone?: string;
};

export type SingleChatRequestOptions = CommonChatRequestOptions & {
  skipSaveUserMessage?: boolean;
};

export function buildSingleChatRequestBody({
  model,
  messages,
  conversationId,
  notebookId,
  reasoningEnabled,
  reasoningEffort,
  search,
  templateId,
  skipSaveUserMessage = false,
  skillKey,
  messageFileIds,
  notebookFileIds,
  clientTimezone,
}: SingleChatRequestOptions): Record<string, any> {
  return {
    model,
    messages,
    stream: true,
    conversation_id: conversationId,
    notebook_id: notebookId,
    reasoning: reasoningEnabled,
    reasoning_effort: reasoningEffort || "high",
    search,
    template_id: templateId,
    skip_save_user_msg: skipSaveUserMessage,
    skill_key: skillKey || undefined,
    message_file_ids: messageFileIds || undefined,
    notebook_file_ids: notebookFileIds || undefined,
    client_timezone: clientTimezone || undefined,
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
  notebookId,
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
  notebookFileIds,
  clientTimezone,
}: CompareChatRequestOptions): Record<string, any> {
  return {
    model,
    messages,
    stream: true,
    conversation_id: conversationId,
    notebook_id: notebookId,
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
    notebook_file_ids: notebookFileIds || undefined,
    client_timezone: clientTimezone || undefined,
  };
}
