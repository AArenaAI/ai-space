"use client";

import { useState } from "react";
import MessageInput, { type QuoteDraft, type ReasoningConfig } from "./MessageInput";
import MessageList from "./MessageList";
import type { ChatModel, Message } from "@/lib/chatTypes";

const models: ChatModel[] = [
  { id: "fixture-model", name: "Fixture Model", provider: "local", description: "Selection fixture model", color: "#64748b" },
];

const messages: Message[] = [
  {
    id: "user-1",
    role: "user",
    content: "这是第 1 轮用户消息，用于验证引用插入输入框。",
    createdAt: 1_700_000_000_000,
    serverMessageId: 1,
  },
  {
    id: "assistant-1",
    role: "assistant",
    content: "这是助手回复，用户可以选中其中一段作为引用。",
    model: "fixture-model",
    createdAt: 1_700_000_001_000,
    completedAt: 1_700_000_002_000,
    serverMessageId: 2,
  },
];

export default function ChatTextSelectionFixture() {
  const [quoteDraft, setQuoteDraft] = useState<QuoteDraft | null>(null);

  return (
    <div className="flex h-screen min-h-0 flex-col bg-surface text-text-primary" data-testid="chat-text-selection-fixture">
      <div className="flex min-h-0 flex-1">
        <MessageList
          messages={messages}
          isLoading={false}
          models={models}
          conversationId={999}
          isLoadingMore={false}
          hasMoreMessages={false}
          onQuoteSelection={(quote) => setQuoteDraft({ id: Date.now(), text: quote })}
        />
      </div>
      <MessageInput
        onSend={(_content: string, _reasoning: ReasoningConfig) => {}}
        onStop={() => {}}
        isLoading={false}
        compareMode={false}
        onToggleCompare={() => {}}
        currentModel={models[0]}
        templates={[]}
        selectedTemplateId={0}
        onSelectTemplate={() => {}}
        onNewChat={() => {}}
        quoteDraft={quoteDraft}
      />
    </div>
  );
}
