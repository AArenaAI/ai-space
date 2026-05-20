"use client";

import { useSearchParams } from "next/navigation";
import { useModels } from "@/hooks/useModels";
import ChatInterface from "./ChatInterface";

function ChatSkeleton() {
  return (
    <div className="flex flex-col h-full bg-surface items-center justify-center">
      <div className="animate-pulse text-text-tertiary text-sm">加载中...</div>
    </div>
  );
}

export default function ChatContent() {
  const searchParams = useSearchParams();
  const conversationId = searchParams.get("id")
    ? Number(searchParams.get("id"))
    : undefined;
  const newChatToken = searchParams.get("t") || "default";
  const { models, loading } = useModels();

  if (loading || models.length === 0) return <ChatSkeleton />;

  // 只在“空的新对话”用 t 参数强制重置；历史对话切换保持稳定 key，由 useChat 内部按 conversationId 加载。
  // 否则从 /chat?t=xxx&id=123 切到 /chat?id=456 时 key 会变化，导致 ChatInterface 整体 remount，出现概率白屏/全局加载。
  const chatKey = conversationId ? "chat" : `new-${newChatToken}`;
  return <ChatInterface key={chatKey} conversationId={conversationId} models={models} />;
}
