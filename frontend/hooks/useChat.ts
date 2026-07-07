"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import type { SetStateAction } from "react";
import { useChatModelSelection } from "@/hooks/useChatModelSelection";
import { useChatLocalActions } from "@/hooks/useChatLocalActions";
import { useChatBackgroundPollingRuntime } from "@/hooks/useChatBackgroundPollingRuntime";
import {
  useChatTaskStreamRuntime,
  useStopTaskStreamAction,
} from "@/hooks/useChatTaskStreamRuntime";
import { useChatMainStreamRuntime } from "@/hooks/useChatMainStreamRuntime";
import { useChatSendRuntime } from "@/hooks/useChatSendRuntime";
import { useChatConversationRestoreRuntime } from "@/hooks/useChatConversationRestoreRuntime";
import { useChatGenerationControlsRuntime } from "@/hooks/useChatGenerationControlsRuntime";
import { useChatUserMessageEditRuntime } from "@/hooks/useChatUserMessageEditRuntime";
import { useChatRuntimeCleanup } from "@/hooks/useChatRuntimeCleanup";
import { useConversationRuntimeMessages, useConversationRuntimeSlice } from "@/hooks/useChatRuntimeSelectors";
import {
  useChatConversationLifecycle,
  useLoadMoreMessagesAction,
} from "@/hooks/useChatConversationLifecycle";
import { useI18n } from "@/lib/i18n";
import { v4 as uuidv4 } from "uuid";
import { createBusyGeneratingStatus, createFinalizingStatus } from "@/lib/chatActivityStatus";
import {
  ChatModel,
  Conversation,
  Message,
  SearchSource,
} from "@/lib/chatTypes";
import { fetchChatBootstrap, type ChatBootstrapPayload } from "@/lib/chatBootstrapCoordinator";
import {
  getConversationMetadataEventFromDomEvent,
  shouldApplyConversationTitleUpdate,
} from "@/lib/chatConversationMetadataEvents";
import { mapPersistedChatMessages, buildGroupViewsFromMessages } from "@/lib/chatForkCoordinator";
import type { CachedConversationSnapshot } from "@/lib/chatConversationCache";
import { setConversationSnapshot } from "@/lib/chatConversationCache";
import { setPersistentConversationSnapshot } from "@/lib/chatConversationPersistentCache";
import { fetchConversationRestore, type ConversationRestoreResponse } from "@/lib/chatConversationRestoreCoordinator";
import { buildBootstrapTaskResumePlan } from "@/lib/chatBootstrapTaskResume";
import { buildStoppedPatch } from "@/lib/chatCompletionFinalizer";
import {
  inferConversationGenerationState,
  isConversationGenerationActive,
  type ConversationGenerationStore,
} from "@/lib/chatConversationGenerationStore";
import { readAuthState } from "@/lib/auth/state";
import { chatRuntimeStore } from "@/lib/chatRuntime";

const API_BASE_URL = ""; // 使用相对路径，nginx 同域名代理 /api -> 后端

export type { ChatModel, Conversation, Message, SearchSource } from "@/lib/chatTypes";

export const MODELS: ChatModel[] = [
  {
    id: "gpt-5.4",
    name: "GPT 5.4",
    provider: "OpenAI",
    description: "Flagship general-purpose model with strong overall capability",
    color: "#10a37f",
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT 5.4 Mini",
    provider: "OpenAI",
    description: "Fast and cost-effective for everyday tasks",
    color: "#10a37f",
  },
  {
    id: "gpt-5.5",
    name: "GPT 5.5",
    provider: "OpenAI",
    description: "Enhanced fifth-generation model with stronger reasoning",
    color: "#10a37f",
  },
  {
    id: "gpt-5.5-pro",
    name: "GPT 5.5 Pro",
    provider: "OpenAI",
    description: "Flagship professional model with top multimodal capability",
    color: "#10a37f",
  },
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    provider: "Google",
    description: "Next-generation flagship reasoning model with stronger multimodal capability",
    color: "#4285f4",
  },
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    provider: "Google",
    description: "Next-generation high-speed model with faster, steadier responses",
    color: "#4285f4",
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek-V4 Pro",
    provider: "DeepSeek",
    description: "Enhanced V4 Pro with the strongest reasoning capability",
    color: "#4d6bfa",
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek-V4 Flash",
    provider: "DeepSeek",
    description: "Lightweight V4 with ultra-fast responses",
    color: "#6366f1",
  },
  {
    id: "kimi-k2.6",
    name: "Kimi K2.6",
    provider: "Moonshot",
    description: "Latest flagship with stronger multimodal and reasoning capability",
    color: "#00b96b",
  },
];

export function useChat(conversationId: number | undefined, models: ChatModel[], skillKey?: string, notebookId?: number, notebookFileIds?: number[], modelSelectionOptions?: { storageKey?: string; defaultModelId?: string }, bootstrap?: ChatBootstrapPayload) {
  const { t } = useI18n();
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const { selectedModel, setSelectedModel, initialized } = useChatModelSelection(models, modelSelectionOptions);
  const {
    conversationTitle,
    setConversationTitle,
    currentConversation,
    setCurrentConversation,
    totalMessages,
    setTotalMessages,
    loadedPersistedMessages,
    setLoadedPersistedMessages,
    isLoadingMore,
    setIsLoadingMore,
    hasMoreMessages,
    conversationLoadSeqRef,
    shouldResetRef,
    justCreatedRef,
    setCreatedConversation,
    applyNavigationResetLifecycle,
    applyJustCreatedNavigationLifecycle,
    applyLoadExistingNavigationLifecycle,
  } = useChatConversationLifecycle(conversationId);
  const abortControllerRef = useRef<AbortController | null>(null);
  const compareAbortControllersRef = useRef<AbortController[]>([]);
  const lastReasoningRef = useRef<{ enabled: boolean; effort?: string }>({ enabled: false, effort: "high" });
  const lastSearchRef = useRef<boolean>(false);
  const [isCompare, setIsCompare] = useState(false);
  const [compareModels, setCompareModels] = useState<string[]>([]);
  // 从对话历史或 prop 恢复的有效 skillKey（优先级：历史 > prop）
  const [effectiveSkillKey, setEffectiveSkillKey] = useState<string | undefined>(skillKey);
  const [groupViews, setGroupViews] = useState<Map<number, number>>(new Map());
  const [generationStore, setGenerationStore] = useState<ConversationGenerationStore>({});
  const taskStreamsRef = useRef<Record<string, AbortController>>({});
  const pendingLocalAssistantsRef = useRef<Record<string, { convId?: number; message: Message }>>({});
  const resumedBootstrapTaskKeysRef = useRef<Set<string>>(new Set());
  const abortReasonRef = useRef<"user" | "navigation" | null>(null);
  const runtimeSlice = useConversationRuntimeSlice(currentConversation);
  const runtimeMessages = useConversationRuntimeMessages(currentConversation);
  const messages = currentConversation ? runtimeMessages : localMessages;
  const setMessages = useCallback((next: SetStateAction<Message[]>) => {
    if (!currentConversation) {
      setLocalMessages(next);
      return;
    }
    const previous = chatRuntimeStore.getConversation(currentConversation).messages as Message[];
    const resolved = typeof next === "function" ? (next as (prev: Message[]) => Message[])(previous) : next;
    chatRuntimeStore.patchConversation(currentConversation, { messages: resolved, updatedAt: Date.now() });
  }, [currentConversation]);
  const modelsKey = models.map((m) => m.id).join("|");
  const bootstrapSnapshot: CachedConversationSnapshot | undefined = useMemo(() => {
    if (!bootstrap?.conversation || !bootstrap.snapshot) return undefined;
    const mappedMessages = mapPersistedChatMessages(bootstrap.snapshot.messages || [], { fallbackId: uuidv4 });
    return {
      conversationId: bootstrap.conversation.id,
      title: bootstrap.conversation.title || "",
      messages: mappedMessages,
      loadedPersistedMessages: mappedMessages.length,
      totalMessages: bootstrap.snapshot.total,
      groupViews: buildGroupViewsFromMessages(mappedMessages),
      isLoading: false,
      isCompare: !!bootstrap.conversation.compare,
      compareModels: bootstrap.conversation.compare_models || [],
      model: bootstrap.conversation.model,
      skillKey: bootstrap.conversation.skill_key || skillKey,
      snapshotVersion: bootstrap.snapshot.snapshot_version,
      fetchedAt: Date.now(),
      updatedAt: Date.now(),
    };
  }, [bootstrap, skillKey]);
  const fetchBootstrapRestore = useCallback(async ({
    apiBaseUrl,
    conversationId: restoreConversationId,
    token,
    signal,
  }: {
    apiBaseUrl?: string;
    conversationId: number;
    token: string;
    signal?: AbortSignal;
    snapshotVersion?: string;
  }): Promise<ConversationRestoreResponse> => {
    try {
      const payload = bootstrap?.conversation?.id === restoreConversationId && bootstrap.snapshot
        ? bootstrap
        : await fetchChatBootstrap({ apiBaseUrl, conversationId: restoreConversationId, token, signal });
      return {
        title: payload.conversation?.title || "",
        model: payload.conversation?.model,
        compare: !!payload.conversation?.compare,
        compare_models: JSON.stringify(payload.conversation?.compare_models || []),
        skill_key: payload.conversation?.skill_key,
        messages: payload.snapshot?.messages || [],
        total: payload.snapshot?.total,
        has_more: payload.snapshot?.has_more,
        snapshot_version: payload.snapshot?.snapshot_version,
        last_assistant_status: payload.snapshot?.last_assistant_status,
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      return fetchConversationRestore({ apiBaseUrl, conversationId: restoreConversationId, token, signal });
    }
  }, [bootstrap]);
  const stopTaskStream = useStopTaskStreamAction(taskStreamsRef);

  const persistCurrentConversationSnapshot = useCallback(() => {
    if (!currentConversation || messages.length === 0) return;
    const snapshot: CachedConversationSnapshot = {
      conversationId: currentConversation,
      title: conversationTitle || "",
      messages,
      loadedPersistedMessages: Math.max(loadedPersistedMessages, messages.length),
      totalMessages: Math.max(totalMessages || 0, messages.length),
      groupViews,
      isLoading,
      isCompare,
      compareModels,
      model: selectedModel?.id,
      skillKey: effectiveSkillKey,
      fetchedAt: Date.now(),
      updatedAt: Date.now(),
    };
    setConversationSnapshot(snapshot);
    void setPersistentConversationSnapshot(snapshot);
  }, [compareModels, conversationTitle, currentConversation, effectiveSkillKey, groupViews, isCompare, isLoading, loadedPersistedMessages, messages, selectedModel?.id, totalMessages]);

  useEffect(() => {
    const handleBeforeRouteChange = () => persistCurrentConversationSnapshot();
    window.addEventListener("chat-conversation-before-route-change", handleBeforeRouteChange);
    return () => window.removeEventListener("chat-conversation-before-route-change", handleBeforeRouteChange);
  }, [persistCurrentConversationSnapshot]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleConversationMetadata = (event: Event) => {
      const incoming = getConversationMetadataEventFromDomEvent(event);
      if (!shouldApplyConversationTitleUpdate({ currentConversationId: currentConversation, incoming, currentTitle: conversationTitle, eventType: event.type })) return;
      setConversationTitle(incoming!.title!);
    };
    window.addEventListener("conversation-updated", handleConversationMetadata);
    window.addEventListener("conversation-renamed", handleConversationMetadata);
    window.addEventListener("conversation-created", handleConversationMetadata);
    return () => {
      window.removeEventListener("conversation-updated", handleConversationMetadata);
      window.removeEventListener("conversation-renamed", handleConversationMetadata);
      window.removeEventListener("conversation-created", handleConversationMetadata);
    };
  }, [conversationTitle, currentConversation, setConversationTitle]);

  useEffect(() => {
    if (!currentConversation || messages.length === 0 || !isLoading) return;
    persistCurrentConversationSnapshot();
  }, [currentConversation, isLoading, messages, persistCurrentConversationSnapshot]);

  const {
    backgroundPollersRef,
    stopBackgroundPoller,
    startBackgroundPolling,
    stopAllBackgroundPollers,
  } = useChatBackgroundPollingRuntime({
    apiBaseUrl: API_BASE_URL,
    taskStreamsRef,
    setMessages,
    setIsLoading,
    conversationTitle,
    selectedModel,
    stopTaskStream,
    translate: t,
  });

  const {
    activeTaskStreamsRef,
    startTaskEventStream,
    stopAllTaskStreams,
  } = useChatTaskStreamRuntime({
    apiBaseUrl: API_BASE_URL,
    taskStreamsRef,
    setMessages,
    setIsLoading,
    startBackgroundPolling,
    translate: t,
  });


  const { streamResponse } = useChatMainStreamRuntime({
    selectedModel,
    conversationTitle,
    currentConversation,
    abortReasonRef,
    setMessages,
    startTaskEventStream,
    startBackgroundPolling,
    translate: t,
  });

  useEffect(() => {
    const activeTasks = bootstrap?.active_tasks?.chat || [];
    if (!conversationId || activeTasks.length === 0 || messages.length === 0) return;
    const busyStatus = createBusyGeneratingStatus(t);
    const plan = buildBootstrapTaskResumePlan({
      activeTasks,
      messages,
    });
    plan.forEach(({ task, message, after, initialContent }) => {
      const resumeKey = `${message.id}:${task.id}:${after || 0}`;
      if (taskStreamsRef.current[message.id] || activeTaskStreamsRef.current[message.id] || resumedBootstrapTaskKeysRef.current.has(resumeKey)) return;
      resumedBootstrapTaskKeysRef.current.add(resumeKey);
      setMessages((prev) => {
        const next = prev.map((item) => {
          if (item.id !== message.id) return item;
          const nextLastSequence = after || item.lastSequence;
          if (
            item.generationTaskId === task.id &&
            item.lastSequence === nextLastSequence &&
            item.activityStatus
          ) {
            return item;
          }
          return {
            ...item,
            generationTaskId: task.id,
            lastSequence: nextLastSequence,
            activityStatus: item.activityStatus ?? busyStatus,
            generationStartedAt: item.generationStartedAt ?? Date.now(),
          };
        });
        chatRuntimeStore.patchConversation(task.conversation_id || conversationId, {
          messages: next,
          activeStreams: {
            ...chatRuntimeStore.getConversation(task.conversation_id || conversationId).activeStreams,
            [message.id]: {
              convId: task.conversation_id || conversationId,
              serverMessageId: task.assistant_message_id,
              generationTaskId: task.id,
              lastSequence: after || 0,
              content: initialContent || "",
            },
          },
          generationTasks: {
            ...chatRuntimeStore.getConversation(task.conversation_id || conversationId).generationTasks,
            [String(task.id)]: {
              convId: task.conversation_id || conversationId,
              serverMessageId: task.assistant_message_id,
              generationTaskId: task.id,
              localMessageId: message.id,
              lastSequence: after || 0,
              content: initialContent || "",
            },
          },
          updatedAt: Date.now(),
        });
        return next;
      });
      startTaskEventStream(
        task.conversation_id || conversationId,
        message.id,
        task.assistant_message_id,
        after,
        initialContent,
        task.id
      );
    });
  }, [bootstrap, conversationId, messages, setMessages, startTaskEventStream, t]);

  useChatRuntimeCleanup({ stopAllBackgroundPollers, stopAllTaskStreams });

  useChatConversationRestoreRuntime({
    apiBaseUrl: API_BASE_URL,
    conversationId,
    models,
    modelsKey,
    skillKey,
    conversationLoadSeqRef,
    shouldResetRef,
    justCreatedRef,
    abortControllerRef,
    compareAbortControllersRef,
    abortReasonRef,
    activeTaskStreamsRef,
    pendingLocalAssistantsRef,
    setMessages,
    setConversationTitle,
    setLoadedPersistedMessages,
    setGroupViews,
    setIsLoading,
    setIsLoadingHistory,
    setTotalMessages,
    setSelectedModel,
    setIsCompare,
    setCompareModels,
    setEffectiveSkillKey,
    applyNavigationResetLifecycle,
    applyJustCreatedNavigationLifecycle,
    applyLoadExistingNavigationLifecycle,
    startTaskEventStream,
    startBackgroundPolling,
    translate: t,
    bootstrapSnapshot,
    fetchRestore: fetchBootstrapRestore,
  });

  const {
    createConversation,
    sendCompareMessages,
    retryCompareColumn,
    sendMessage,
  } = useChatSendRuntime({
    apiBaseUrl: API_BASE_URL,
    messages,
    models,
    selectedModel,
    currentConversation,
    notebookId,
    notebookFileIds,
    effectiveSkillKey,
    setCreatedConversation,
    setMessages,
    setIsLoading,
    setIsCompare,
    setCompareModels,
    abortControllerRef,
    compareAbortControllersRef,
    abortReasonRef,
    taskStreamsRef,
    pendingLocalAssistantsRef,
    backgroundPollersRef,
    lastReasoningRef,
    lastSearchRef,
    streamResponse,
    startBackgroundPolling,
    translate: t,
  });

  const { stopGeneration, forkChat } = useChatGenerationControlsRuntime({
    apiBaseUrl: API_BASE_URL,
    messages,
    currentConversation,
    taskStreamsRef,
    abortControllerRef,
    compareAbortControllersRef,
    abortReasonRef,
    setIsCompare,
    setCompareModels,
    setMessages,
    setLoadedPersistedMessages,
    setGroupViews,
    streamResponse,
    startBackgroundPolling,
    reasoning: lastReasoningRef.current,
    search: lastSearchRef.current,
    skillKey: effectiveSkillKey,
    notebookId,
    notebookFileIds,
    translate: t,
  });

  const stopCurrentConversationGeneration = useCallback(() => {
    stopGeneration();
    if (!currentConversation) return;
    const pendingIds = Object.entries(pendingLocalAssistantsRef.current)
      .filter(([, entry]) => entry.convId === currentConversation)
      .map(([id]) => id);
    if (pendingIds.length === 0) return;
    const stoppedPatch = buildStoppedPatch(Date.now());
    setMessages((prev) => {
      const next = prev.map((message) =>
        pendingIds.includes(message.id) ? { ...message, ...stoppedPatch } : message
      );
      chatRuntimeStore.patchConversation(currentConversation, {
        messages: next,
        pendingOptimisticMessages: [],
        activeStreams: {},
        generationTasks: {},
        updatedAt: Date.now(),
      });
      return next;
    });
    pendingIds.forEach((id) => {
      delete pendingLocalAssistantsRef.current[id];
    });
    setIsLoading(false);
  }, [currentConversation, stopGeneration, setMessages, setIsLoading]);

  const {
    clearMessages,
    regenerateMessage,
    switchGroupModel,
  } = useChatLocalActions({
    messages,
    setMessages,
    setCurrentConversation,
    setGroupViews,
    getReasoning: () => lastReasoningRef.current,
    getSearch: () => lastSearchRef.current,
    sendMessage,
  });


  // 向上滚动加载更多历史消息
  const loadMoreMessages = useLoadMoreMessagesAction({
    apiBaseUrl: API_BASE_URL,
    currentConversation,
    isLoadingMore,
    hasMoreMessages,
    totalMessages,
    loadedPersistedMessages,
    getToken: () => readAuthState().token,
    fallbackId: uuidv4,
    setIsLoadingMore,
    setMessages,
    setLoadedPersistedMessages,
    setTotalMessages,
  });

  const latestAssistantMessage = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "assistant") return messages[index];
    }
    return undefined;
  }, [messages]);

  const hasCurrentPendingLocalAssistant = useMemo(() => {
    if (!currentConversation || !latestAssistantMessage) return false;
    const pending = pendingLocalAssistantsRef.current[latestAssistantMessage.id];
    return Boolean(
      pending?.convId === currentConversation &&
      !latestAssistantMessage.completedAt &&
      !latestAssistantMessage.stopped &&
      !latestAssistantMessage.errorCode
    );
  }, [currentConversation, latestAssistantMessage, messages]);

  const hasCurrentMainStream = useMemo(() => {
    return Boolean(abortControllerRef.current) && Boolean(
      latestAssistantMessage &&
      !latestAssistantMessage.completedAt &&
      !latestAssistantMessage.stopped &&
      !latestAssistantMessage.errorCode &&
      !latestAssistantMessage.content?.trim()
    );
  }, [latestAssistantMessage, messages]);

  const hasRuntimeActiveStream = useMemo(() => Object.keys(runtimeSlice.activeStreams || {}).length > 0, [runtimeSlice.activeStreams]);
  const hasRuntimeGenerationTask = useMemo(() => Object.keys(runtimeSlice.generationTasks || {}).length > 0, [runtimeSlice.generationTasks]);
  const hasRuntimePendingOptimistic = useMemo(() => (runtimeSlice.pendingOptimisticMessages || []).length > 0, [runtimeSlice.pendingOptimisticMessages]);

  useEffect(() => {
    if (!currentConversation) return;
    setGenerationStore((prev) => ({
      ...prev,
      [currentConversation]: inferConversationGenerationState({
        conversationId: currentConversation,
        messages,
        hasActiveTaskStream: hasRuntimeActiveStream,
        hasCurrentPoller: hasRuntimeGenerationTask && hasRuntimeActiveStream,
        hasPendingLocalAssistant: hasCurrentPendingLocalAssistant || hasRuntimePendingOptimistic,
        hasMainStream: hasCurrentMainStream && hasRuntimeActiveStream,
        previous: prev[currentConversation],
      }),
    }));
  }, [currentConversation, messages, hasCurrentPendingLocalAssistant, hasCurrentMainStream, hasRuntimeActiveStream, hasRuntimeGenerationTask, hasRuntimePendingOptimistic]);

  const isCurrentConversationGenerating = useMemo(() => {
    if (!currentConversation) return false;
    const currentState = inferConversationGenerationState({
      conversationId: currentConversation,
      messages,
      hasActiveTaskStream: hasRuntimeActiveStream,
      hasCurrentPoller: hasRuntimeGenerationTask && hasRuntimeActiveStream,
      hasPendingLocalAssistant: hasCurrentPendingLocalAssistant || hasRuntimePendingOptimistic,
      hasMainStream: hasCurrentMainStream && hasRuntimeActiveStream,
      previous: generationStore[currentConversation],
    });
    return isConversationGenerationActive(currentState);
  }, [currentConversation, generationStore, messages, hasCurrentPendingLocalAssistant, hasCurrentMainStream, hasRuntimeActiveStream, hasRuntimeGenerationTask, hasRuntimePendingOptimistic]);

  const editUserMessage = useChatUserMessageEditRuntime({
    apiBaseUrl: API_BASE_URL,
    messages,
    selectedModel,
    currentConversation,
    isCompare,
    isLoading: isLoading || isCurrentConversationGenerating,
    setMessages,
    setIsLoading,
    abortControllerRef,
    abortReasonRef,
    pendingLocalAssistantsRef,
    streamResponse,
    reasoning: lastReasoningRef.current,
    search: lastSearchRef.current,
    notebookId,
    notebookFileIds,
    skillKey: effectiveSkillKey,
    translate: t,
  });

  return {
    messages,
    isLoading,
    isCurrentConversationGenerating,
    isLoadingHistory,
    selectedModel,
    setSelectedModel,
    sendMessage,
    stopGeneration: stopCurrentConversationGeneration,
    clearMessages,
    regenerateMessage,
    editUserMessage,
    currentConversation,
    effectiveSkillKey,
    isCompare,
    setIsCompare,
    compareModels,
    setCompareModels,
    sendCompareMessages,
    retryCompareColumn,
    groupViews,
    switchGroupModel,
    forkChat,
    conversationTitle,
    setConversationTitle,
    totalMessages,
    isLoadingMore,
    hasMoreMessages,
    loadMoreMessages,
  };
}

