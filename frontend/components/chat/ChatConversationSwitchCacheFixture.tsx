"use client";

import { useCallback, useRef, useState, type SetStateAction } from "react";
import MessageList from "./MessageList";
import type { ChatModel, Message } from "@/lib/chatTypes";
import { useChatConversationLifecycle } from "@/hooks/useChatConversationLifecycle";
import { useChatConversationRestoreRuntime } from "@/hooks/useChatConversationRestoreRuntime";
import type { TaskStreamActiveState } from "@/hooks/useChatTaskStreamRuntime";
import {
  clearConversationSnapshotCache,
  setConversationSnapshot,
} from "@/lib/chatConversationCache";
import type { ConversationRestoreResponse } from "@/lib/chatConversationRestoreCoordinator";

const models: ChatModel[] = [
  { id: "fixture-model", name: "Fixture Model", provider: "local", description: "Conversation switch cache fixture", color: "#64748b" },
  { id: "fixture-model-2", name: "Fixture Model 2", provider: "local", description: "Conversation switch cache fixture", color: "#22c55e" },
];

const conversation100CachedMessages: Message[] = [
  {
    id: "cached-user-100",
    role: "user",
    content: "缓存会话 100 的用户消息。",
    createdAt: 1_700_000_000_000,
    serverMessageId: 1001,
  },
  {
    id: "cached-assistant-100",
    role: "assistant",
    content: "缓存会话 100 的回答，应在 cache hit 时立即出现。",
    model: "fixture-model",
    createdAt: 1_700_000_001_000,
    completedAt: 1_700_000_002_000,
    serverMessageId: 1002,
  },
];

const conversation100FreshMessages: Message[] = [
  ...conversation100CachedMessages,
  {
    id: "fresh-assistant-100",
    role: "assistant",
    content: "服务端刷新后的会话 100 新回答。",
    model: "fixture-model-2",
    createdAt: 1_700_000_003_000,
    completedAt: 1_700_000_004_000,
    serverMessageId: 1003,
  },
];

const conversation101Messages: Message[] = [
  {
    id: "fresh-user-101",
    role: "user",
    content: "会话 101 的问题。",
    createdAt: 1_700_000_005_000,
    serverMessageId: 1011,
  },
  {
    id: "fresh-assistant-101",
    role: "assistant",
    content: "会话 101 从服务端恢复后的回答。",
    model: "fixture-model",
    createdAt: 1_700_000_006_000,
    completedAt: 1_700_000_007_000,
    serverMessageId: 1012,
  },
];

type FixturePhase = "ready" | "cache-miss-loading" | "cache-miss-restored" | "cache-hit-immediate" | "cache-hit-refreshed";

function cloneMessages(messages: Message[]) {
  return messages.map((message) => ({ ...message }));
}

function delayedRestore(conversationId: number, delayMs: number): Promise<ConversationRestoreResponse> {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      if (conversationId === 100) {
        resolve({
          title: "Conversation 100 fresh",
          model: "fixture-model-2",
          messages: cloneMessages(conversation100FreshMessages),

        });
        return;
      }
      resolve({
        title: "Conversation 101",
        model: "fixture-model",
        messages: cloneMessages(conversation101Messages),

      });
    }, delayMs);
  });
}

export default function ChatConversationSwitchCacheFixture() {
  const [conversationId, setConversationId] = useState<number | undefined>(undefined);
  const [phase, setPhase] = useState<FixturePhase>("ready");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "previous-user-99",
      role: "user",
      content: "上一个会话 99 的旧消息，切换时不能残留。",
      createdAt: 1_700_000_009_000,
      serverMessageId: 991,
    },
    {
      id: "previous-assistant-99",
      role: "assistant",
      content: "上一个会话 99 的旧回答，cache miss/loading 期间不能显示。",
      model: "fixture-model",
      createdAt: 1_700_000_010_000,
      completedAt: 1_700_000_011_000,
      serverMessageId: 992,
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [conversationTitle, setConversationTitle] = useState("");
  const [selectedModel, setSelectedModel] = useState(models[0]);
  const [isCompare, setIsCompare] = useState(false);
  const [compareModels, setCompareModels] = useState<string[]>([]);
  const [effectiveSkillKey, setEffectiveSkillKey] = useState<string | undefined>(undefined);
  const [groupViews, setGroupViews] = useState<Map<number, number>>(new Map());
  const restoreCallsRef = useRef(0);
  const previousLoadingRef = useRef(false);

  const lifecycle = useChatConversationLifecycle(conversationId);
  const abortControllerRef = useRef<AbortController | null>(null);
  const compareAbortControllersRef = useRef<AbortController[]>([]);
  const abortReasonRef = useRef<"user" | "navigation" | null>(null);
  const activeTaskStreamsRef = useRef<Record<string, TaskStreamActiveState>>({});

  const setLoadingHistoryTracked = useCallback((next: SetStateAction<boolean>) => {
    setIsLoadingHistory((previous) => {
      const resolved = typeof next === "function" ? (next as (value: boolean) => boolean)(previous) : next;
      previousLoadingRef.current = resolved;
      if (resolved && conversationId === 101) {
        setPhase("cache-miss-loading");
      }
      return resolved;
    });
  }, [conversationId]);

  const setMessagesTracked = useCallback((next: SetStateAction<Message[]>) => {
    setMessages((previous) => {
      const resolved = typeof next === "function" ? (next as (value: Message[]) => Message[])(previous) : next;
      if (resolved.some((message) => message.id === "cached-assistant-100")) {
        setPhase((current) => current === "cache-miss-restored" ? "cache-hit-immediate" : current);
      }
      if (resolved.some((message) => message.id === "fresh-assistant-100")) {
        setPhase("cache-hit-refreshed");
      }
      if (resolved.some((message) => message.id === "fresh-assistant-101")) {
        setPhase("cache-miss-restored");
      }
      return resolved;
    });
  }, []);

  useChatConversationRestoreRuntime({
    apiBaseUrl: "",
    conversationId,
    models,
    modelsKey: "fixture-model|fixture-model-2",
    skillKey: undefined,
    conversationLoadSeqRef: lifecycle.conversationLoadSeqRef,
    shouldResetRef: lifecycle.shouldResetRef,
    justCreatedRef: lifecycle.justCreatedRef,
    abortControllerRef,
    compareAbortControllersRef,
    abortReasonRef,
    activeTaskStreamsRef,
    setMessages: setMessagesTracked,
    setConversationTitle,
    setLoadedPersistedMessages: lifecycle.setLoadedPersistedMessages,
    setGroupViews,
    setIsLoading,
    setIsLoadingHistory: setLoadingHistoryTracked,
    setTotalMessages: lifecycle.setTotalMessages,
    setSelectedModel,
    setIsCompare,
    setCompareModels,
    setEffectiveSkillKey,
    applyNavigationResetLifecycle: lifecycle.applyNavigationResetLifecycle,
    applyJustCreatedNavigationLifecycle: lifecycle.applyJustCreatedNavigationLifecycle,
    applyLoadExistingNavigationLifecycle: lifecycle.applyLoadExistingNavigationLifecycle,
    startTaskEventStream: () => {},
    translate: (key) => key,
    getToken: () => "fixture-token",
    fetchRestore: ({ conversationId: restoredConversationId }: { conversationId: number }) => {
      restoreCallsRef.current += 1;
      return delayedRestore(restoredConversationId, restoredConversationId === 100 ? 450 : 650);
    },
    fetchMessageStatus: async ({ serverMessageId }: { serverMessageId: number }) => ({
      message: {
        content: serverMessageId === 1003
          ? "服务端刷新后的会话 100 新回答。"
          : "会话 101 从服务端恢复后的回答。",
      },
      background_task: { status: "completed", completed_at: "2024-01-01T00:00:00Z" },
    }),
    fetchMessageCount: async ({ conversationId: countConversationId }) => countConversationId === 100 ? conversation100FreshMessages.length : conversation101Messages.length,
  });

  const prepare = () => {
    clearConversationSnapshotCache();
    setConversationSnapshot({
      conversationId: 100,
      title: "Conversation 100 cached",
      messages: cloneMessages(conversation100CachedMessages),
      loadedPersistedMessages: conversation100CachedMessages.length,
      totalMessages: conversation100CachedMessages.length,
      groupViews: new Map(),
      isLoading: false,
      isCompare: false,
      compareModels: [],
      model: "fixture-model",
      fetchedAt: Date.now(),
      updatedAt: Date.now(),
    });
    restoreCallsRef.current = 0;
    previousLoadingRef.current = false;
    setConversationId(101);
  };

  const switchToCached = () => {
    setConversationId(100);
  };

  return (
    <div
      className="flex h-screen min-h-0 flex-col bg-surface text-text-primary"
      data-testid="chat-conversation-switch-cache-fixture"
      data-phase={phase}
      data-conversation-id={conversationId ?? "none"}
      data-loading-history={String(isLoadingHistory)}
      data-title={conversationTitle}
      data-model={selectedModel.id}
      data-restore-calls={restoreCallsRef.current}
      data-loaded-persisted={lifecycle.loadedPersistedMessages}
      data-total={lifecycle.totalMessages}
      data-compare={String(isCompare)}
      data-compare-count={compareModels.length}
      data-skill={effectiveSkillKey ?? ""}
    >
      <div className="shrink-0 border-b border-surface-border px-4 py-2 text-xs text-text-secondary">
        conversation switch cache fixture · phase: <span data-testid="conversation-switch-phase">{phase}</span>
        <button className="ml-3 rounded border px-2 py-1" data-testid="switch-cache-miss" onClick={prepare}>switch cache miss 101</button>
        <button className="ml-2 rounded border px-2 py-1" data-testid="switch-cache-hit" onClick={switchToCached}>switch cache hit 100</button>
      </div>
      <div className="flex min-h-0 flex-1">
        <MessageList
          messages={messages}
          isLoading={isLoading}
          isLoadingHistory={isLoadingHistory}
          models={models}
          conversationId={conversationId}
          isLoadingMore={false}
          hasMoreMessages={false}
          groupViews={groupViews}
        />
      </div>
    </div>
  );
}
