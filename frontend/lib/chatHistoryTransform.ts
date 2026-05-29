export type ChatHistoryMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type ModelHistoryMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export const ASSISTANT_HISTORY_TRUNCATE_THRESHOLD = 1500;
export const ASSISTANT_HISTORY_TRUNCATE_TO = 300;
export const ASSISTANT_HISTORY_TRUNCATED_NOTICE = "[前文已省略，如需回顾请重新提问]";

export function stripReasoningBlocks(content: string): string {
  if (!content) return content;
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .trim();
}

export function truncateAssistantHistory(
  content: string,
  threshold: number = ASSISTANT_HISTORY_TRUNCATE_THRESHOLD,
  truncateTo: number = ASSISTANT_HISTORY_TRUNCATE_TO
): string {
  if (!content || content.length <= threshold) return content;
  const truncated = content.slice(0, truncateTo).trim();
  return `${truncated}\n\n${ASSISTANT_HISTORY_TRUNCATED_NOTICE}`;
}

export function toModelMessages(messages: ChatHistoryMessage[]): ModelHistoryMessage[] {
  return messages
    .map((message) => ({
      role: message.role,
      content: message.role === "assistant"
        ? truncateAssistantHistory(stripReasoningBlocks(message.content))
        : message.content,
    }))
    .filter((message) => message.role !== "assistant" || message.content.trim() !== "");
}
