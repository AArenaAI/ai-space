"use client";

import { useMemo, useState } from "react";
import MessageRow from "./MessageRow";
import StableMarkdownRenderer from "./StableMarkdownRenderer";
import { mergeConversationSnapshot } from "@/lib/chatConversationSnapshotMerge";
import type { ChatModel, Message } from "@/lib/chatTypes";

const model: ChatModel = { id: "fixture-model", name: "Fixture Model", provider: "Fixture", description: "fixture", color: "#888" };

function localMessages(): Message[] {
  const now = Date.now();
  return [
    { id: "client-user-a", clientMessageId: "client-user-a", localRunId: "run-a", role: "user", content: "fresh local send", createdAt: now, sendStatus: "submitting" },
    { id: "client-assistant-a", clientMessageId: "client-assistant-a", localRunId: "run-a", role: "assistant", model: model.id, content: "", createdAt: now, generationStatus: "pending", serverGenerationStatus: "pending", phase: "starting" as any },
  ];
}

export default function ChatLocalSendSwitchRestoreFixture() {
  const [activeConversation, setActiveConversation] = useState<"a" | "b">("a");
  const [messagesA, setMessagesA] = useState<Message[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const modelById = useMemo(() => new Map([[model.id, model]]), []);
  const messages = activeConversation === "a" ? messagesA : [{ id: "b-user", role: "user", content: "conversation b", createdAt: 1 } as Message];
  const append = (event: string) => setEvents((prev) => [...prev, event]);

  const startSendA = () => {
    setMessagesA(localMessages());
    append("a-local-committed");
  };
  const bindServerA = () => {
    setMessagesA((prev) => prev.map((message) => {
      if (message.id === "client-user-a") return { ...message, serverMessageId: 7001, sendStatus: "server_bound" };
      if (message.id === "client-assistant-a") return { ...message, serverMessageId: 7002, generationTaskId: 9901, serverGenerationStatus: "running", generationStatus: "pending" };
      return message;
    }));
    append("a-server-bound");
  };
  const applyStaleRestoreA = () => {
    const decision = mergeConversationSnapshot(
      {
        conversationId: 1,
        snapshotVersion: 10,
        updatedAt: 10000,
        messages: messagesA as any,
      },
      {
        conversationId: 1,
        snapshotVersion: 9,
        updatedAt: 9000,
        messages: [{ id: "server-old-user", role: "user", content: "old restore" }],
      },
      { source: "restore", currentConversationId: 1, activeStreamTaskIds: [] },
    );
    append(`stale-restore-${decision.accepted ? "accepted" : "rejected"}:${decision.reason}`);
    if (decision.accepted) setMessagesA((decision.snapshot.messages || []) as Message[]);
  };

  return (
    <div className="min-h-screen bg-surface p-6" data-testid="chat-local-send-switch-restore-fixture" data-active-conversation={activeConversation}>
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="start-send-a" onClick={startSendA} className="rounded border px-3 py-1">start A send</button>
          <button type="button" data-testid="switch-b" onClick={() => { setActiveConversation("b"); append("switch-b"); }} className="rounded border px-3 py-1">switch B</button>
          <button type="button" data-testid="bind-server-a" onClick={bindServerA} className="rounded border px-3 py-1">bind A</button>
          <button type="button" data-testid="apply-stale-restore-a" onClick={applyStaleRestoreA} className="rounded border px-3 py-1">stale restore A</button>
          <button type="button" data-testid="switch-a" onClick={() => { setActiveConversation("a"); append("switch-a"); }} className="rounded border px-3 py-1">switch A</button>
        </div>
        <div data-testid="switch-message-list" className="rounded-2xl border border-surface-border bg-surface-elevated/50 p-4">
          {messages.map((message, index) => (
            <MessageRow
              key={message.clientMessageId || message.id}
              message={message}
              model={message.role === "assistant" ? model : undefined}
              isLast={index === messages.length - 1}
              isLatestAssistant={message.role === "assistant" && index === messages.length - 1}
              isInitialReadingAssistant={false}
              isViewedAssistant={false}
              isLoading={activeConversation === "a" && messagesA.some((m) => m.role === "assistant" && !m.completedAt && !m.errorCode)}
              selectMode={false}
              isSelected={false}
              isHighlighted={false}
              historyPrependSettling={false}
              deferRichTextHydration={false}
              allowRichLiteFallback={false}
              modelById={modelById}
              openAvatarDropdownGroupId={null}
              setOpenAvatarDropdownGroupId={() => {}}
              toggleSelect={() => {}}
              handleCopy={() => {}}
              enterSelectMode={() => {}}
              isFavorited={() => false}
              imageLoadFailedLabel="图片加载失败"
              MarkdownRenderer={StableMarkdownRenderer as any}
              useContentVisibility={false}
            />
          ))}
        </div>
        <pre data-testid="switch-events" className="whitespace-pre-wrap text-xs text-text-tertiary">{events.join("\n")}</pre>
      </div>
    </div>
  );
}
