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
  const { models, loading } = useModels();

  if (loading || models.length === 0) return <ChatSkeleton />;

  // 用固定 key 避免切换对话时组件重新挂载，useChat 的 effect 会正确处理 conversationId 变化
  return <ChatInterface key="chat" conversationId={conversationId} models={models} />;
}
