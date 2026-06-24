"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
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
import { useChatRuntimeCleanup } from "@/hooks/useChatRuntimeCleanup";
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
import { mapPersistedChatMessages, buildGroupViewsFromMessages } from "@/lib/chatForkCoordinator";
import type { CachedConversationSnapshot } from "@/lib/chatConversationCache";
import type { ConversationRestoreResponse } from "@/lib/chatConversationRestoreCoordinator";
import { buildBootstrapTaskResumePlan } from "@/lib/chatBootstrapTaskResume";

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
  const [messages, setMessages] = useState<Message[]>([]);
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
  const taskStreamsRef = useRef<Record<string, AbortController>>({});
  const resumedBootstrapTaskIdsRef = useRef<Set<number>>(new Set());
  const abortReasonRef = useRef<"user" | "navigation" | null>(null);
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
  }, [bootstrap]);
  const stopTaskStream = useStopTaskStreamAction(taskStreamsRef);

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
      alreadyResumedTaskIds: resumedBootstrapTaskIdsRef.current,
    });
    plan.forEach(({ task, message, after, initialContent }) => {
      resumedBootstrapTaskIdsRef.current.add(task.id);
      setMessages((prev) => prev.map((item) =>
        item.id === message.id
          ? {
              ...item,
              generationTaskId: task.id,
              lastSequence: after || item.lastSequence,
              activityStatus: item.activityStatus ?? busyStatus,
              generationStartedAt: item.generationStartedAt ?? Date.now(),
            }
          : item
      ));
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
    translate: t,
    bootstrapSnapshot,
    fetchRestore: fetchBootstrapRestore,
  });

  const {
    createConversation,
    sendCompareMessages,
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

  const {
    clearMessages,
    deleteMessage,
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
    getToken: () => localStorage.getItem("token"),
    fallbackId: uuidv4,
    setIsLoadingMore,
    setMessages,
    setLoadedPersistedMessages,
    setTotalMessages,
  });

  return {
    messages,
    isLoading,
    isLoadingHistory,
    selectedModel,
    setSelectedModel,
    sendMessage,
    stopGeneration,
    clearMessages,
    deleteMessage,
    regenerateMessage,
    currentConversation,
    effectiveSkillKey,
    isCompare,
    setIsCompare,
    compareModels,
    setCompareModels,
    sendCompareMessages,
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

