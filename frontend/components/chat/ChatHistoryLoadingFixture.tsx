"use client";

import { useEffect, useState } from "react";
import MessageList from "./MessageList";
import type { ChatModel, Message } from "@/lib/chatTypes";

const models: ChatModel[] = [
  { id: "fixture-model", name: "Fixture Model", provider: "local", description: "History loading fixture model", color: "#64748b" },
];

const previousMessages: Message[] = [
  {
    id: "previous-user",
    role: "user",
    content: "这是上一个会话的消息。",
    createdAt: 1_700_000_000_000,
    serverMessageId: 1,
  },
  {
    id: "previous-assistant",
    role: "assistant",
    content: "这是上一个会话的回答，用于模拟切换历史会话前已经有内容。",
    model: "fixture-model",
    createdAt: 1_700_000_001_000,
    completedAt: 1_700_000_002_000,
    serverMessageId: 2,
  },
];

const restoredMessages: Message[] = [
  {
    id: "restored-user-1",
    role: "user",
    content: "加载后的历史问题 1。",
    createdAt: 1_700_000_003_000,
    serverMessageId: 11,
  },
  {
    id: "restored-assistant-1",
    role: "assistant",
    content: "加载后的历史回答 1。\n\n这段内容用于验证历史加载期间不出现 welcome/空白闪屏。",
    model: "fixture-model",
    createdAt: 1_700_000_004_000,
    completedAt: 1_700_000_005_000,
    serverMessageId: 12,
  },
  {
    id: "restored-user-2",
    role: "user",
    content: "加载后的历史问题 2。",
    createdAt: 1_700_000_006_000,
    serverMessageId: 13,
  },
  {
    id: "restored-assistant-2",
    role: "assistant",
    content: "加载后的历史回答 2。".repeat(40),
    model: "fixture-model",
    createdAt: 1_700_000_007_000,
    completedAt: 1_700_000_008_000,
    serverMessageId: 14,
  },
];

type Phase = "previous" | "loading" | "restored";

export default function ChatHistoryLoadingFixture() {
  const [phase, setPhase] = useState<Phase>("previous");

  useEffect(() => {
    const loadingTimer = window.setTimeout(() => setPhase("loading"), 180);
    const restoredTimer = window.setTimeout(() => setPhase("restored"), 720);
    return () => {
      window.clearTimeout(loadingTimer);
      window.clearTimeout(restoredTimer);
    };
  }, []);

  const messages = phase === "previous" ? previousMessages : phase === "restored" ? restoredMessages : [];

  return (
    <div className="flex h-screen min-h-0 flex-col bg-surface text-text-primary" data-testid="chat-history-loading-fixture" data-phase={phase}>
      <div className="shrink-0 border-b border-surface-border px-4 py-2 text-xs text-text-secondary">
        history loading fixture · phase: <span data-testid="history-loading-phase">{phase}</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <MessageList
          messages={messages}
          isLoading={false}
          isLoadingHistory={phase === "loading"}
          models={models}
          conversationId={phase === "previous" ? 998 : 999}
          isLoadingMore={false}
          hasMoreMessages={false}
        />
      </div>
    </div>
  );
}
