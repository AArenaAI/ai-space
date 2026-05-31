"use client";

import { useEffect, useMemo, useState } from "react";
import MessageList from "./MessageList";
import { Message, ChatModel } from "@/lib/chatTypes";
import { realtimeAppend, realtimeClear, realtimeUpdate } from "@/lib/streaming";

const models: ChatModel[] = [
  { id: "fixture-model", name: "Fixture Model", provider: "fixture", description: "Synthetic chat state fixture", color: "#8b5cf6" },
];

function baseMessages(): Message[] {
  return [
    {
      id: "fixture-user",
      role: "user",
      content: "请联网搜索并先思考再回答。",
      createdAt: 1_700_000_000_000,
      serverMessageId: 1,
    },
    {
      id: "fixture-assistant",
      role: "assistant",
      content: "",
      model: "fixture-model",
      createdAt: 1_700_000_001_000,
      serverMessageId: 2,
      searchStatus: "searching",
      activityStatus: { kind: "web_search", status: "searching", label: "正在联网搜索" },
    },
  ];
}

export default function ChatStreamingStateFixture() {
  const assistantId = "fixture-assistant";
  const [messages, setMessages] = useState<Message[]>(() => baseMessages());
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState("init");

  useEffect(() => {
    realtimeClear(assistantId);
    setMessages(baseMessages());
    setLoading(true);
    setPhase("searching");

    const timers = [
      window.setTimeout(() => {
        realtimeUpdate(assistantId, {
          content: "",
          searchStatus: "searching",
          activityStatus: { kind: "web_search", status: "searching", label: "正在联网搜索" },
          phase: "searching",
        });
        setPhase("searching");
      }, 80),
      window.setTimeout(() => {
        // Simulate a provider/SSE event that carries reasoning and visible answer
        // in the same payload. The frontend must show reasoning first and hold
        // the answer until reasoning is closed.
        realtimeAppend(assistantId, { reasoningDelta: "先分析搜索结果，确认 **最终** 只输出简短回答。", reasoning: true });
        setPhase("mixed-held");
      }, 260),
      window.setTimeout(() => {
        realtimeAppend(assistantId, { reasoning: false });
        realtimeAppend(assistantId, { answerDelta: "最终回答 **", reasoning: false });
        setPhase("answer-streaming");
      }, 650),
      window.setTimeout(() => {
        realtimeAppend(assistantId, { answerDelta: "OK", reasoning: false });
      }, 820),
      window.setTimeout(() => {
        realtimeAppend(assistantId, { answerDelta: "** 42", reasoning: false });
      }, 990),
      window.setTimeout(() => {
        // Simulate DONE without a search-completed meta event. This used to leave
        // the web-search badge stuck in the running state.
        realtimeUpdate(assistantId, {
          completedAt: Date.now(),
          activityStatus: undefined,
          searchStatus: undefined,
          phase: "completed",
        });
        setMessages((prev) => prev.map((message) => message.id === assistantId
          ? {
              ...message,
              content: "<think>先分析搜索结果，确认 **最终** 只输出简短回答。</think>最终回答 **OK** 42",
              completedAt: Date.now(),
              activityStatus: undefined,
              searchStatus: undefined,
            }
          : message
        ));
        setLoading(false);
        setPhase("done");
      }, 1800),
    ];

    return () => {
      timers.forEach(window.clearTimeout);
      realtimeClear(assistantId);
    };
  }, []);

  const marker = useMemo(() => JSON.stringify({ phase, loading }), [phase, loading]);

  return (
    <div className="flex h-screen min-h-0 flex-col bg-surface text-text-primary" data-testid="chat-streaming-state-fixture" data-state={marker}>
      <div className="shrink-0 border-b border-surface-border px-4 py-2 text-xs text-text-secondary">
        streaming state fixture · phase=<span data-testid="fixture-phase">{phase}</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <MessageList
          messages={messages}
          isLoading={loading}
          models={models}
          conversationId={999}
          isLoadingMore={false}
          hasMoreMessages={false}
        />
      </div>
    </div>
  );
}
