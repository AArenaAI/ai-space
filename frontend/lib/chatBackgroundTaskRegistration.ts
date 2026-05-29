import type { BackgroundTaskRecord } from "./taskNotifications";

export type ChatBackgroundTaskRegistration = Omit<
  BackgroundTaskRecord,
  "status" | "createdAt" | "updatedAt"
>;

export function getNotificationConversationTitle(title?: string, fallback?: string) {
  const trimmed = (title || "").trim();
  if (trimmed) return trimmed;
  const fallbackText = (fallback || "").trim();
  if (fallbackText) return fallbackText;
  return "对话任务";
}

export function buildChatBackgroundTaskRegistration({
  serverMessageId,
  conversationId,
  conversationTitle,
  modelName,
}: {
  serverMessageId: number;
  conversationId?: number;
  conversationTitle?: string;
  modelName?: string;
}): ChatBackgroundTaskRegistration {
  const notificationTitle = getNotificationConversationTitle(conversationTitle, modelName);
  return {
    type: "chat",
    id: serverMessageId,
    key: `chat:${serverMessageId}`,
    title: "长对话生成中",
    description: notificationTitle,
    href: `/chat${conversationId ? `?id=${conversationId}` : ""}`,
    conversationId,
    serverMessageId,
    conversationTitle: notificationTitle,
  };
}
