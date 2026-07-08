"use client";

import { useMemo, useRef, useState } from "react";
import MessageInput, { type AttachedFile, type ChatComposerSendResult, type ReasoningConfig } from "./MessageInput";
import MessageRow from "./MessageRow";
import StableMarkdownRenderer from "./StableMarkdownRenderer";
import type { ChatModel, Message } from "@/lib/chatTypes";

const model: ChatModel = {
  id: "fixture-model",
  name: "Fixture Model",
  provider: "Fixture",
  description: "fixture",
  color: "#888888",
};

function makeId(prefix: string, index: number) {
  return `${prefix}-${index}`;
}

export default function ChatLocalSendRunFixture() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [scenario, setScenario] = useState<"success" | "stop" | "init-fail" | "stream-fail">("success");
  const [events, setEvents] = useState<string[]>([]);
  const sendCounterRef = useRef(0);
  const pendingRunRef = useRef<{ localRunId: string; userId: string; assistantId: string; stopped: boolean } | null>(null);

  const modelById = useMemo(() => new Map([[model.id, model]]), []);

  const appendEvent = (event: string) => setEvents((prev) => [...prev, event]);

  const commitLocalRun = (content: string) => {
    sendCounterRef.current += 1;
    const index = sendCounterRef.current;
    const localRunId = makeId("run", index);
    const userId = makeId("client-user", index);
    const assistantId = makeId("client-assistant", index);
    const now = Date.now();
    const user: Message = {
      id: userId,
      clientMessageId: userId,
      localRunId,
      role: "user",
      content,
      createdAt: now,
      sendStatus: "submitting",
    };
    const assistant: Message = {
      id: assistantId,
      clientMessageId: assistantId,
      localRunId,
      role: "assistant",
      model: model.id,
      content: "",
      createdAt: now,
      generationStatus: "pending",
      serverGenerationStatus: "pending",
      phase: "starting" as any,
      generationStartedAt: now,
    };
    pendingRunRef.current = { localRunId, userId, assistantId, stopped: false };
    setMessages((prev) => [...prev, user, assistant]);
    setIsLoading(true);
    appendEvent("local-committed");
    return pendingRunRef.current;
  };

  const bindServer = (run: { userId: string; assistantId: string }) => {
    setMessages((prev) => prev.map((message) => {
      if (message.id === run.userId) return { ...message, serverMessageId: 1001, sendStatus: "server_bound" };
      if (message.id === run.assistantId) return {
        ...message,
        serverMessageId: 1002,
        generationTaskId: 9001,
        serverGenerationStatus: "running",
        generationStatus: "pending",
        phase: "starting" as any,
      };
      return message;
    }));
    appendEvent("server-bound");
  };

  const completeRun = (run: { assistantId: string }) => {
    setMessages((prev) => prev.map((message) => message.id === run.assistantId
      ? {
          ...message,
          content: "完成回答 **OK**",
          completedAt: Date.now(),
          serverGenerationStatus: "completed",
          generationStatus: "completed",
          phase: "completed" as any,
          activityStatus: undefined,
        }
      : message));
    setIsLoading(false);
    appendEvent("completed");
  };

  const failInit = (run: { userId: string; assistantId: string }) => {
    setMessages((prev) => prev.map((message) => {
      if (message.id === run.userId) return { ...message, sendStatus: "failed", errorCode: "init_failed" };
      if (message.id === run.assistantId) return { ...message, errorCode: "init_failed", content: "发送失败", generationStatus: "failed", serverGenerationStatus: "failed", phase: "failed" as any };
      return message;
    }));
    setIsLoading(false);
    appendEvent("init-failed");
  };

  const failStream = (run: { assistantId: string }) => {
    setMessages((prev) => prev.map((message) => message.id === run.assistantId
      ? { ...message, content: "部分回答", errorCode: "stream_failed", generationStatus: "failed", serverGenerationStatus: "failed", phase: "failed" as any }
      : message));
    setIsLoading(false);
    appendEvent("stream-failed");
  };

  const handleSend = async (content: string, _reasoning: ReasoningConfig, _search: boolean, _attachments?: AttachedFile[]): Promise<ChatComposerSendResult> => {
    const run = commitLocalRun(content);
    window.setTimeout(() => {
      if (run.stopped || pendingRunRef.current?.localRunId !== run.localRunId) return;
      if (scenario === "stop") return;
      if (scenario === "init-fail") {
        failInit(run);
        pendingRunRef.current = null;
        return;
      }
      bindServer(run);
      window.setTimeout(() => {
        if (run.stopped || pendingRunRef.current?.localRunId !== run.localRunId) return;
        if (scenario === "stream-fail") failStream(run);
        else completeRun(run);
        pendingRunRef.current = null;
      }, 220);
    }, 220);
    return { accepted: true };
  };

  const handleStop = () => {
    const run = pendingRunRef.current;
    if (!run) return;
    run.stopped = true;
    setMessages((prev) => prev.map((message) => {
      if (message.id === run.userId && !message.serverMessageId) return { ...message, sendStatus: "cancelled", errorCode: "cancelled" };
      if (message.id === run.assistantId) return { ...message, generationStatus: "cancelled", serverGenerationStatus: "cancelled", stopped: true, completedAt: Date.now(), phase: "stopped" as any };
      return message;
    }));
    setIsLoading(false);
    pendingRunRef.current = null;
    appendEvent("stopped");
  };

  const retryUserMessage = (message: Message) => {
    appendEvent(`retry:${message.content}`);
    void handleSend(message.content, { enabled: false, effort: "standard" }, false);
  };

  const saveUserEdit = async (message: Message, content: string) => {
    setMessages((prev) => prev.map((item) => item.id === message.id ? { ...item, content, sendStatus: "submitting" } : item));
    appendEvent(`edited:${content}`);
  };

  return (
    <div className="min-h-screen bg-surface p-6" data-testid="chat-local-send-run-fixture" data-scenario={scenario}>
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="flex flex-wrap gap-2" data-testid="scenario-controls">
          {(["success", "stop", "init-fail", "stream-fail"] as const).map((name) => (
            <button key={name} type="button" onClick={() => setScenario(name)} data-testid={`scenario-${name}`} className="rounded-lg border border-surface-border px-3 py-1 text-sm text-text-primary">
              {name}
            </button>
          ))}
        </div>
        <div className="rounded-2xl border border-surface-border bg-surface-elevated/50 p-4" data-testid="local-send-message-list">
          {messages.map((message, index) => (
            <MessageRow
              key={message.clientMessageId || message.id}
              message={message}
              model={message.role === "assistant" ? model : undefined}
              isLast={index === messages.length - 1}
              isLatestAssistant={message.role === "assistant" && index === messages.length - 1}
              isInitialReadingAssistant={false}
              isViewedAssistant={false}
              isLoading={isLoading}
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
              onRetryUserMessage={retryUserMessage}
              onEditUserMessage={saveUserEdit}
              canEditUserMessages
              imageLoadFailedLabel="图片加载失败"
              MarkdownRenderer={StableMarkdownRenderer as any}
              useContentVisibility={false}
            />
          ))}
        </div>
        <MessageInput
          onSend={handleSend}
          onStop={handleStop}
          isLoading={isLoading}
          compareMode={false}
          onToggleCompare={() => {}}
          currentModel={model}
          templates={[]}
          selectedTemplateId={0}
          onSelectTemplate={() => {}}
          onNewChat={() => {}}
        />
        <pre data-testid="local-send-events" className="whitespace-pre-wrap text-xs text-text-tertiary">{events.join("\n")}</pre>
      </div>
    </div>
  );
}
