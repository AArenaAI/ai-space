"use client";

import { useEffect, useState } from "react";
import type { Message, ChatModel } from "@/lib/chatTypes";
import { AssistantAnswerRenderer } from "@/components/chat/AssistantAnswerRenderer";
import ChatActivityPanel from "@/components/chat/ChatActivityPanel";
import { resolveChatMessageRuntimeState } from "@/lib/chatMessageRuntimeState";
import { normalizeSearchSources } from "@/lib/searchSources";

declare global {
  interface Window {
    __CHAT_ACTIVITY_ENTRY_STATES_FIXTURE__?: Message[];
    __CHAT_ACTIVITY_ENTRY_PANEL_SNAPSHOTS__?: Record<string, { title: string; hasSources: boolean; text: string }>;
  }
}

const fixtureModel: ChatModel = {
  id: "fixture-model",
  name: "Fixture Model",
  provider: "Fixture",
  description: "Fixture",
  color: "#7c5cff",
};

function fallbackMessages(): Message[] {
  const now = Date.now();
  return [
    { id: "plain", role: "assistant", content: "普通回答", model: "fixture-model", createdAt: now - 2000, completedAt: now - 1000 },
  ];
}

export default function ChatActivityEntryStatesFixturePage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeMessage, setActiveMessage] = useState<Message | null>(null);

  useEffect(() => {
    setMessages(window.__CHAT_ACTIVITY_ENTRY_STATES_FIXTURE__ || fallbackMessages());
  }, []);

  const openActivity = (message: Message) => {
    setActiveMessage(message);
    window.setTimeout(() => {
      const panel = document.querySelector('[data-chat-activity-panel="true"]');
      const title = panel?.getAttribute("data-chat-activity-title") || "";
      const text = panel?.textContent || "";
      window.__CHAT_ACTIVITY_ENTRY_PANEL_SNAPSHOTS__ = {
        ...(window.__CHAT_ACTIVITY_ENTRY_PANEL_SNAPSHOTS__ || {}),
        [message.id]: { title, hasSources: text.includes("参考来源"), text },
      };
    }, 150);
  };

  return (
    <main className="min-h-screen bg-surface p-8 text-text-primary" data-fixture-ready={messages.length > 0 ? "true" : undefined}>
      <div className="mx-auto max-w-3xl space-y-8">
        {messages.map((message) => {
          const runtimeState = resolveChatMessageRuntimeState({ message });
          const sourceCount = normalizeSearchSources(runtimeState.searchSources).length || runtimeState.searchSourcesCount || 0;
          const hasReasoning = Boolean(runtimeState.reasoningContent?.trim());
          const hasEntry = hasReasoning || sourceCount > 0;
          return (
            <section key={message.id} data-fixture-row={message.id} className="rounded-2xl border border-surface-border bg-surface-card p-4">
              <div className="mb-2 text-xs text-text-tertiary">{message.id}</div>
              <div data-fixture-entry-wrapper="true">
                <AssistantAnswerRenderer
                  message={message}
                  runtimeState={runtimeState}
                  generating={false}
                  shouldRenderStreamingText={false}
                  keepReasoningExpanded={false}
                  onOpenActivity={() => openActivity(message)}
                  t={(key) => key}
                />
              </div>
            </section>
          );
        })}
      </div>
      {activeMessage && (
        <div className="fixed inset-0 z-50 bg-black/10 p-6">
          <button data-fixture-close="true" className="mb-4 rounded-lg bg-surface-card px-3 py-2 text-sm" onClick={() => setActiveMessage(null)}>关闭</button>
          <ChatActivityPanel message={activeMessage} model={fixtureModel} onClose={() => setActiveMessage(null)} />
        </div>
      )}
    </main>
  );
}
