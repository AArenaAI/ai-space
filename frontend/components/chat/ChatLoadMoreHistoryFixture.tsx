"use client";

import { useCallback, useState } from "react";
import MessageList from "./MessageList";
import type { ChatModel, Message } from "@/lib/chatTypes";

const models: ChatModel[] = [
  { id: "fixture-model", name: "Fixture Model", provider: "local", description: "Load more fixture model", color: "#64748b" },
];

const makeTurn = (index: number, prefix = "current"): Message[] => [
  {
    id: `${prefix}-user-${index}`,
    role: "user",
    content: `第 ${index} 轮问题：用于测试向上加载更多历史消息时当前视图是否保持稳定。`,
    createdAt: 1_700_000_000_000 + index * 2,
    serverMessageId: index * 2 - 1,
  },
  {
    id: `${prefix}-assistant-${index}`,
    role: "assistant",
    content: Array.from({ length: 8 }, (_, line) => `第 ${index} 轮回答第 ${line + 1} 行：这是一段有高度的历史回答，用来放大 prepend 后的滚动补偿误差。`).join("\n\n"),
    model: "fixture-model",
    createdAt: 1_700_000_000_000 + index * 2 + 1,
    completedAt: 1_700_000_000_000 + index * 2 + 2,
    serverMessageId: index * 2,
  },
];

const initialMessages: Message[] = Array.from({ length: 14 }, (_, index) => makeTurn(index + 20)).flat();
const olderMessages: Message[] = Array.from({ length: 8 }, (_, index) => makeTurn(index + 1, "older")).flat();

export default function ChatLoadMoreHistoryFixture() {
  const [messages, setMessages] = useState(initialMessages);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadedOlder, setLoadedOlder] = useState(false);

  const handleLoadMore = useCallback(() => {
    if (loadedOlder || isLoadingMore) return;
    setIsLoadingMore(true);
    window.setTimeout(() => {
      setMessages((prev) => [...olderMessages, ...prev]);
      setLoadedOlder(true);
      setIsLoadingMore(false);
    }, 260);
  }, [isLoadingMore, loadedOlder]);

  return (
    <div className="flex h-screen min-h-0 flex-col bg-surface text-text-primary" data-testid="chat-load-more-history-fixture" data-loaded-older={loadedOlder ? "true" : "false"}>
      <div className="shrink-0 border-b border-surface-border px-4 py-2 text-xs text-text-secondary">
        load more history fixture · loaded older: <span data-testid="load-more-loaded-older">{loadedOlder ? "true" : "false"}</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <MessageList
          messages={messages}
          isLoading={false}
          models={models}
          conversationId={1000}
          isLoadingMore={isLoadingMore}
          hasMoreMessages={!loadedOlder}
          onLoadMore={handleLoadMore}
        />
      </div>
    </div>
  );
}
