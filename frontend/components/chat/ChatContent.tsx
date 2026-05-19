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

  // 只用新对话按钮的 t 参数强制重置；不要用 conversationId 做 key。
  // 第一条消息会创建新对话并把 URL 改成 ?id=xxx，如果 key 跟着变，会卸载正在流式生成的 ChatInterface，导致第一条 AI 回复不可见。
  const chatKey = `chat-${newChatToken}`;
  return <ChatInterface key={chatKey} conversationId={conversationId} models={models} />;
}
