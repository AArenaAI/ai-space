export type ChatTargetHrefInput = {
  conversationId: string | number;
  skillKey?: string | null;
  messageId?: string | number | null;
  blockId?: string | null;
};

function hasValue(value: unknown): value is string | number {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

export function buildChatTargetHref({ conversationId, skillKey, messageId, blockId }: ChatTargetHrefInput): string {
  const params = new URLSearchParams();
  const path = skillKey ? "/skills/chat" : "/chat";
  if (skillKey) params.set("key", String(skillKey));
  params.set("id", String(conversationId));
  if (hasValue(messageId)) {
    params.set("message", String(messageId));
    if (hasValue(blockId)) params.set("block", String(blockId));
  }
  return `${path}?${params.toString()}`;
}
