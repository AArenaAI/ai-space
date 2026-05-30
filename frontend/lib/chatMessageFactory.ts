export type ChatAttachmentInput = {
  filename: string;
  content?: string;
  type?: string;
  public_id?: string;
};

export type ChatMessageFile = {
  public_id: string;
  type: string;
  filename: string;
};

export type FactoryChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model?: string;
  createdAt: number;
  files?: ChatMessageFile[];
  search?: boolean;
  searchStatus?: "searching" | "completed" | "failed";
};

export function buildMessageFiles(
  attachments?: ChatAttachmentInput[],
  options: { defaultType?: string } = {}
): ChatMessageFile[] {
  return attachments
    ?.filter((attachment) => !!attachment.public_id)
    .map((attachment) => ({
      public_id: attachment.public_id!,
      type: attachment.type || options.defaultType || "file",
      filename: attachment.filename,
    })) || [];
}

export type CreateUserMessageOptions = {
  id: string;
  content: string;
  createdAt: number;
  files?: ChatMessageFile[];
};

export function createUserChatMessage({
  id,
  content,
  createdAt,
  files = [],
}: CreateUserMessageOptions): FactoryChatMessage {
  return {
    id,
    role: "user",
    content: content.trim(),
    createdAt,
    files,
  };
}

export type CreateAssistantMessageOptions = {
  id: string;
  model: string;
  createdAt: number;
  search?: boolean;
};

export function createAssistantChatMessage({
  id,
  model,
  createdAt,
  search = false,
}: CreateAssistantMessageOptions): FactoryChatMessage {
  return {
    id,
    role: "assistant",
    content: "",
    model,
    createdAt,
    search,
    searchStatus: search ? "searching" : undefined,
  };
}

export type CreateCompareAssistantMessagesOptions = {
  modelIds: string[];
  ids: string[];
  createdAt: number;
  search?: boolean;
};

export function createCompareAssistantMessages({
  modelIds,
  ids,
  createdAt,
  search = false,
}: CreateCompareAssistantMessagesOptions): FactoryChatMessage[] {
  return modelIds.map((modelId, index) => createAssistantChatMessage({
    id: ids[index],
    model: modelId,
    createdAt,
    search,
  }));
}
