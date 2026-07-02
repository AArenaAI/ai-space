export type ChatConversationMetadataEvent = {
  id: number;
  title?: string;
  model?: string;
  skill_key?: string;
  workspace_id?: number;
  updated_at?: string;
  source?: string;
};

function normalizeNumericId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function normalizeConversationMetadataEventDetail(detail: unknown): ChatConversationMetadataEvent | null {
  if (!detail || typeof detail !== "object") return null;
  const record = detail as Record<string, unknown>;
  const id = normalizeNumericId(record.id ?? record.conversationId);
  if (!id) return null;
  const title = typeof record.title === "string" ? record.title : undefined;
  const model = typeof record.model === "string" ? record.model : undefined;
  const skillKey = typeof record.skill_key === "string" ? record.skill_key : undefined;
  const workspaceId = normalizeNumericId(record.workspace_id);
  const updatedAt = typeof record.updated_at === "string" ? record.updated_at : undefined;
  const source = typeof record.source === "string" ? record.source : undefined;
  return {
    id,
    ...(title !== undefined ? { title } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(skillKey !== undefined ? { skill_key: skillKey } : {}),
    ...(workspaceId !== undefined ? { workspace_id: workspaceId } : {}),
    ...(updatedAt !== undefined ? { updated_at: updatedAt } : {}),
    ...(source !== undefined ? { source } : {}),
  };
}

export function getConversationMetadataEventFromDomEvent(event: Event): ChatConversationMetadataEvent | null {
  return normalizeConversationMetadataEventDetail((event as CustomEvent).detail);
}

function isDefaultOrEmptyConversationTitle(title: string) {
  const normalized = title.trim();
  return !normalized || normalized === "新对话" || normalized.toLowerCase() === "new chat";
}

export function shouldApplyConversationTitleUpdate({
  currentConversationId,
  incoming,
  currentTitle,
  eventType,
}: {
  currentConversationId?: number;
  incoming: ChatConversationMetadataEvent | null;
  currentTitle: string;
  eventType?: string;
}) {
  if (!currentConversationId || !incoming || incoming.id !== currentConversationId) return false;
  if (incoming.title === undefined || incoming.title === currentTitle) return false;
  if (eventType === "conversation-renamed") return true;
  if (incoming.source === "local-send") return isDefaultOrEmptyConversationTitle(currentTitle);
  return false;
}
