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

  // 新对话按钮会刷新 t 参数；用 key 强制重置 useChat 内部状态，避免 replaceState 写入 id 后 Next searchParams 未同步导致点击无效
  const chatKey = conversationId ? `conversation-${conversationId}` : `new-${newChatToken}`;
  return <ChatInterface key={chatKey} conversationId={conversationId} models={models} />;
}
