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
  // 用时间戳参数确保新对话能重新挂载
  const freshKey = searchParams.get("t") || conversationId || 'new';
  const { models, loading } = useModels();

  if (loading || models.length === 0) return <ChatSkeleton />;

  return <ChatInterface key={freshKey} conversationId={conversationId} models={models} />;
}
