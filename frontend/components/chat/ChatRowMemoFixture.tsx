"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MessageList from "./MessageList";
import type { ChatModel, Message } from "@/lib/chatTypes";

const models: ChatModel[] = [
  { id: "fixture-model", name: "Fixture Model", provider: "local", description: "Row memo fixture", color: "#64748b" },
];

function buildLongMarkdown() {
  const sections = Array.from({ length: 28 }, (_, index) => {
    const n = index + 1;
    return [
      `## Section ${n}`,
      "This is a deliberately long assistant message used to verify that unrelated parent state changes do not force the long row to re-render.",
      "- Keep markdown fallback stable.",
      "- Keep row memo boundaries effective.",
      "- Keep virtualized chat switching smooth.",
      "```ts",
      `export const section${n} = { id: ${n}, label: \"row memo fixture\" };`,
      "```",
    ].join("\n");
  });
  return sections.join("\n\n");
}

const fixtureMessages: Message[] = [
  {
    id: "row-memo-user-1",
    role: "user",
    content: "请生成一份长 Markdown 说明。",
    createdAt: 1_700_000_000_000,
    serverMessageId: 1,
  },
  {
    id: "row-memo-long-assistant",
    role: "assistant",
    content: buildLongMarkdown(),
    model: "fixture-model",
    createdAt: 1_700_000_001_000,
    completedAt: 1_700_000_002_000,
    serverMessageId: 2,
  },
  {
    id: "row-memo-user-2",
    role: "user",
    content: "再给一个简短问题。",
    createdAt: 1_700_000_003_000,
    serverMessageId: 3,
  },
  {
    id: "row-memo-short-assistant",
    role: "assistant",
    content: "这是短回答。",
    model: "fixture-model",
    createdAt: 1_700_000_004_000,
    completedAt: 1_700_000_005_000,
    serverMessageId: 4,
  },
];

type RenderEvent = {
  phase?: string;
  messageId?: string;
  durationMs?: number;
  at?: number;
};

export default function ChatRowMemoFixture() {
  const [unrelatedTick, setUnrelatedTick] = useState(0);
  const [eventVersion, setEventVersion] = useState(0);
  const eventsRef = useRef<RenderEvent[]>([]);
  const messages = useMemo(() => fixtureMessages, []);
  const handleDelete = useCallback(() => {}, []);
  const handleRegenerate = useCallback(() => {}, []);

  useEffect(() => {
    (window as Window & { __AI_SPACE_CHAT_PROFILE_ENABLED?: boolean }).__AI_SPACE_CHAT_PROFILE_ENABLED = true;
    const onProfile = (event: Event) => {
      const detail = (event as CustomEvent<RenderEvent>).detail;
      eventsRef.current.push(detail);
      setEventVersion((value) => value + 1);
    };
    window.addEventListener("chat-render-profile", onProfile);
    return () => window.removeEventListener("chat-render-profile", onProfile);
  }, []);

  const resetEvents = () => {
    eventsRef.current = [];
    setEventVersion((value) => value + 1);
  };

  const events = eventsRef.current;
  const longRowCommitCount = events.filter((event) => event.phase === "message-row-commit" && event.messageId === "row-memo-long-assistant").length;
  const allRowCommitCount = events.filter((event) => event.phase === "message-row-commit").length;
  const listCommitCount = events.filter((event) => event.phase === "message-list-commit").length;

  return (
    <div
      className="flex h-screen min-h-0 flex-col bg-surface text-text-primary"
      data-testid="chat-row-memo-fixture"
      data-unrelated-tick={unrelatedTick}
      data-event-version={eventVersion}
      data-long-row-commits={longRowCommitCount}
      data-row-commits={allRowCommitCount}
      data-list-commits={listCommitCount}
    >
      <div className="shrink-0 border-b border-surface-border px-4 py-2 text-xs text-text-secondary">
        row memo fixture · tick: <span data-testid="row-memo-tick">{unrelatedTick}</span>
        <button className="ml-3 rounded border px-2 py-1" data-testid="row-memo-reset-events" onClick={resetEvents}>reset events</button>
        <button className="ml-2 rounded border px-2 py-1" data-testid="row-memo-unrelated-rerender" onClick={() => setUnrelatedTick((value) => value + 1)}>unrelated parent rerender</button>
      </div>
      <div className="flex min-h-0 flex-1">
        <MessageList
          messages={messages}
          isLoading={false}
          models={models}
          conversationId={7001}
          isLoadingMore={false}
          hasMoreMessages={false}
          onRegenerate={handleRegenerate}
          welcomeTitle={`unused-${unrelatedTick}`}
        />
      </div>
    </div>
  );
}
