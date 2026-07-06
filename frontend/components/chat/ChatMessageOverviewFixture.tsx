"use client";

import { useMemo, useState } from "react";
import MessageList from "./MessageList";
import type { ChatModel, Message } from "@/lib/chatTypes";

const models: ChatModel[] = [
  { id: "deepseek-chat", name: "DeepSeek", provider: "deepseek", description: "DeepSeek fixture model", color: "#4f8cff" },
  { id: "gpt-fixture", name: "GPT Fixture", provider: "openai", description: "Compare fixture model", color: "#10b981" },
];

const makeTurn = (index: number): Message[] => [
  {
    id: `overview-user-${index}`,
    role: "user",
    content: index === 1
      ? "在 dydx chain 中，撮合引擎的状态如何同步？"
      : index === 2
        ? "go 多线程的情况下，如何保证订单写入一致性？"
        : index === 3
          ? "在这套系统中，订单的存储是怎么设计的？"
          : `先不说加速问题；就是现在的第 ${index} 个用户问题需要跳转测试。`,
    createdAt: 1_700_000_000_000 + index * 2,
    serverMessageId: index * 2 - 1,
  },
  {
    id: `overview-assistant-${index}`,
    role: "assistant",
    content: Array.from({ length: 10 }, (_, line) => `第 ${index} 轮回答第 ${line + 1} 行：用于撑开消息区高度，测试右侧概览点击跳转。`).join("\n\n"),
    model: "deepseek-chat",
    createdAt: 1_700_000_000_000 + index * 2 + 1,
    completedAt: 1_700_000_000_000 + index * 2 + 2,
    serverMessageId: index * 2,
  },
];

const allMessages: Message[] = Array.from({ length: 8 }, (_, index) => makeTurn(index + 1)).flat();
const manyMessages: Message[] = Array.from({ length: 40 }, (_, index) => makeTurn(index + 1)).flat();
const singleTurnMessages = makeTurn(1);

export default function ChatMessageOverviewFixture() {
  const [mode, setMode] = useState<"normal" | "single" | "select" | "compare" | "many">("normal");
  const [targetMessageId, setTargetMessageId] = useState<number | undefined>(undefined);
  const messages = mode === "single" ? singleTurnMessages : mode === "many" ? manyMessages : allMessages;
  const isCompare = mode === "compare";
  const compareModels = useMemo(() => isCompare ? ["deepseek-chat", "gpt-fixture"] : [], [isCompare]);
  const conversationId = mode === "many" ? 2040 : mode === "single" ? 2001 : mode === "compare" ? 2002 : 2000;

  return (
    <div className="flex h-screen min-h-0 flex-col bg-surface text-text-primary" data-testid="chat-message-overview-fixture" data-mode={mode}>
      <div className="flex shrink-0 items-center gap-2 border-b border-surface-border px-4 py-2 text-xs text-text-secondary">
        <span>DeepSeek-style message overview fixture</span>
        <button type="button" data-testid="overview-mode-normal" className="rounded border border-surface-border px-2 py-1" onClick={() => setMode("normal")}>normal</button>
        <button type="button" data-testid="overview-mode-single" className="rounded border border-surface-border px-2 py-1" onClick={() => setMode("single")}>single</button>
        <button type="button" data-testid="overview-mode-select" className="rounded border border-surface-border px-2 py-1" onClick={() => setMode("select")}>select</button>
        <button type="button" data-testid="overview-mode-compare" className="rounded border border-surface-border px-2 py-1" onClick={() => setMode("compare")}>compare</button>
        <button type="button" data-testid="overview-mode-many" className="rounded border border-surface-border px-2 py-1" onClick={() => setMode("many")}>many</button>
        <button type="button" data-testid="overview-target-assistant" className="rounded border border-surface-border px-2 py-1" onClick={() => setTargetMessageId(4)}>target assistant #2</button>
        <button type="button" data-testid="overview-clear-target" className="rounded border border-surface-border px-2 py-1" onClick={() => setTargetMessageId(undefined)}>clear target</button>
      </div>
      <div className="flex min-h-0 flex-1">
        <MessageList
          messages={messages}
          isLoading={false}
          models={models}
          conversationId={conversationId}
          isCompare={isCompare}
          compareModels={compareModels}
          targetMessageId={targetMessageId}
          onSelectModeChange={(mode === "select") ? () => {} : undefined}
        />
      </div>
    </div>
  );
}
