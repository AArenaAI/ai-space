"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import MessageList from "./MessageList";
import { Message, ChatModel } from "@/lib/chatTypes";

const LONG_MARKDOWN = [
  "# 长 Markdown 性能样本",
  "",
  "这是一段用于验证 Markdown 懒加载和虚拟列表首屏渲染的长内容。".repeat(20),
  "",
  "```ts",
  "export function sample(input: string) {",
  "  return input.split('').reverse().join('');",
  "}",
  "```",
  "",
  "| 项目 | 数值 | 说明 |",
  "| --- | ---: | --- |",
  "| alpha | 123 | 表格渲染样本 |",
  "| beta | 456 | 表格渲染样本 |",
  "",
  "- 列表项 A".repeat(40),
].join("\n");

function buildMessages(count: number, longEvery: number): Message[] {
  const now = 1_700_000_000_000;
  return Array.from({ length: count }, (_, index) => {
    const isUser = index % 2 === 0;
    const pair = Math.floor(index / 2) + 1;
    const content = isUser
      ? `这是第 ${pair} 轮用户消息，用于性能验证。`
      : (longEvery > 0 && pair % longEvery === 0
        ? `${LONG_MARKDOWN}\n\n轮次：${pair}\n\n${"补充说明。".repeat(600)}`
        : `这是第 ${pair} 轮助手回复。\n\n- 要点一\n- 要点二\n\n结束。`);
    return {
      id: `perf-${index + 1}`,
      role: isUser ? "user" : "assistant",
      content,
      model: isUser ? undefined : "perf-model",
      createdAt: now + index * 1000,
      completedAt: isUser ? undefined : now + index * 1000 + 500,
      serverMessageId: index + 1,
    } satisfies Message;
  });
}

const models: ChatModel[] = [
  { id: "perf-model", name: "性能模型", provider: "local", description: "Synthetic performance model", color: "#64748b" },
];

export default function ChatPerformanceFixture() {
  const params = useSearchParams();
  const count = Math.max(0, Number(params.get("count") || 1000));
  const longEvery = Math.max(0, Number(params.get("longEvery") || 10));
  const hasMore = params.get("hasMore") !== "0";
  const [loadMoreCount, setLoadMoreCount] = useState(0);
  const messages = useMemo(() => buildMessages(count, longEvery), [count, longEvery]);

  return (
    <div className="flex h-screen min-h-0 flex-col bg-surface text-text-primary" data-testid="chat-performance-fixture">
      <div className="shrink-0 border-b border-surface-border px-4 py-2 text-xs text-text-secondary">
        perf fixture · messages={messages.length} · loadMore={loadMoreCount}
      </div>
      <div className="flex min-h-0 flex-1">
        <MessageList
          messages={messages}
          isLoading={false}
          models={models}
          conversationId={999}
          isLoadingMore={false}
          hasMoreMessages={hasMore}
          onLoadMore={() => setLoadMoreCount((value) => value + 1)}
        />
      </div>
    </div>
  );
}
