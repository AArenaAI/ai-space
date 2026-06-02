"use client";

import { useSearchParams } from "next/navigation";
import { useModels } from "@/hooks/useModels";
import ChatInterface from "./ChatInterface";
import { useI18n } from "@/lib/i18n";

function ChatSkeleton() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col h-full bg-surface items-center justify-center">
      <div className="animate-pulse text-text-tertiary text-sm">{t("chat.loading")}</div>
    </div>
  );
}

export default function ChatContent() {
  const searchParams = useSearchParams();
  const conversationId = searchParams.get("id")
    ? Number(searchParams.get("id"))
    : undefined;
  const newChatToken = searchParams.get("t") || "default";
  const targetMessageId = searchParams.get("message")
    ? Number(searchParams.get("message"))
    : undefined;
  const { models, loading } = useModels();

  if (loading || models.length === 0) return <ChatSkeleton />;

  // 只用 t 参数强制重置“新对话”实例；创建对话后 URL 会从 /chat?t=xxx 变成 /chat?t=xxx&id=123，
  // key 必须保持不变，否则 ChatInterface 会 remount，正在流式写入的本地 assistant 消息会丢失。
  // 历史对话通常不带 t，统一使用稳定 key，由 useChat 内部按 conversationId 加载。
  const chatKey = newChatToken !== "default" ? `new-${newChatToken}` : "chat";
  return (
    <div className="h-full min-h-0 overflow-hidden">
      <ChatInterface key={chatKey} conversationId={conversationId} models={models} targetMessageId={targetMessageId} />
    </div>
  );
}
