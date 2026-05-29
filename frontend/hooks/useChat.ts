"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { emitTaskFinished, registerBackgroundTask } from "@/lib/taskNotifications";
import { v4 as uuidv4 } from "uuid";
import { getGuestId } from "@/lib/guestId";
import { streamAppend, streamGet, streamClear, realtimeUpdate, realtimeGet, realtimeClear } from "@/lib/streaming";
import {
  getNotificationConversationTitle,
} from "@/lib/chatBackgroundTaskRegistration";
import {
  shouldStartTaskStreamFallbackPolling,
  shouldSyncTaskStreamFinalMessage,
} from "@/lib/chatTaskStreamFinalizer";
import { createTaskStreamEventHandler } from "@/lib/chatTaskStreamEventHandler";
import { createMainStreamEventHandler } from "@/lib/chatMainStreamEventHandler";
import { runCompareModels } from "@/lib/chatCompareRunCoordinator";
import {
  applySingleSendMessagePlan,
  buildNewConversationTitle,
  prepareSingleSendMessages,
  runSingleChatRequest,
  shouldStartSingleSend,
} from "@/lib/chatSingleSendCoordinator";
import {
  cancelGenerationTask,
  runStopGeneration,
} from "@/lib/chatStopGenerationCoordinator";
import {
  buildForkRefreshState,
  fetchForkConversationRefresh,
  resolveForkConversationId,
  resolveForkedModels,
  runForkChatRequest,
} from "@/lib/chatForkCoordinator";
import {
  runChatStreamLifecycle,
} from "@/lib/chatStreamLifecycle";
import {
  runTaskEventStream,
  shouldFallbackToBackgroundPollingAfterTaskStreamError,
} from "@/lib/chatTaskStreamLifecycle";
import {
  buildCompletedPatch,
  buildDisplayErrorPatch,
  buildRecoverableBusyPatch,
  buildStoppedPatch,
} from "@/lib/chatCompletionFinalizer";
import {
  buildChatStreamRunResult,
  shouldMarkCompleted,
  shouldRecoverStream,
  shouldReconcileAfterDone,
  type ChatStreamGroupContext,
  type ChatStreamRunResult,
} from "@/lib/chatStreamRunResult";
import {
  buildBackgroundPollingMessagePatch,
  shouldKeepBackgroundLoading,
} from "@/lib/chatBackgroundPolling";
import { startBackgroundPollingRunner } from "@/lib/chatBackgroundPollingRunner";
import {
  applyCompareGroupContextToMessages,
  applyFinalRealtimeDataToMessage,
  patchMessageById,
} from "@/lib/chatMessageStatePatch";
import {
  buildChatRequestHeaders,
} from "@/lib/chatRequestBuilder";
import { toModelMessages } from "@/lib/chatHistoryTransform";
import {
  buildMessageFiles,
  createCompareAssistantMessages,
  createUserChatMessage,
} from "@/lib/chatMessageFactory";
import {
  selectCompareModelIds,
  shouldStartCompare,
} from "@/lib/chatCompareCoordinator";
import {
  resolveRecoveryIds,
  shouldIgnoreStreamAbort,
  shouldRecoverCompareRun,
  shouldResumeTaskStreamAfterError,
} from "@/lib/chatErrorRecovery";
import {
  createBusyGeneratingStatus,
  createFinalizingStatus,
  createGeneratingStatus,
} from "@/lib/chatActivityStatus";

const API_BASE_URL = ""; // 使用相对路径，nginx 同域名代理 /api -> 后端

export interface SearchSource {
  title: string;
  url: string;
  description: string;
}

function parsePersistedSearchSources(raw: any): SearchSource[] | undefined {
  const value = raw?.search_sources ?? raw?.searchSources;
  if (!value) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeMessageFiles(value: any): Message["files"] {
  if (!value) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model?: string;
  createdAt: number;
  completedAt?: number;
  stopped?: boolean;
  search?: boolean;
  searchSources?: SearchSource[];
  searchSourcesCount?: number;
  searchStatus?: "searching" | "completed";
  activityStatus?: { kind: "generating" | "reasoning" | "web_search" | "file_search" | "tool_call"; status: "running" | "searching" | "completed"; label: string };
  files?: { public_id: string; type: string; filename: string }[];
  errorCode?: string;
  retryable?: boolean;
  requestId?: string;
  serverMessageId?: number;
  backgroundTaskId?: string;
  generationTaskId?: number;
  useBackground?: boolean;
  isComplexTask?: boolean;
  lastSequence?: number;
  groupId?: number;
  groupIndex?: number;
  groupModels?: string[];
  userMessageId?: number;
}

type CompareGroupContext = ChatStreamGroupContext;
type StreamRunResult = ChatStreamRunResult;

export interface ChatModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  color: string;
  capabilities?: string[];
  supported_inputs?: string[];
  supported_file_extensions?: string[];
  supported_file_mime_types?: string[];
  file_accept?: string;
}

export interface Conversation {
  id: number;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
}

export const MODELS: ChatModel[] = [
  {
    id: "gpt-5.4",
    name: "GPT 5.4",
    provider: "OpenAI",
    description: "旗舰通用模型，综合能力强",
    color: "#10a37f",
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT 5.4 Mini",
    provider: "OpenAI",
    description: "快速、经济，日常任务首选",
    color: "#10a37f",
  },
  {
    id: "gpt-5.5",
    name: "GPT 5.5",
    provider: "OpenAI",
    description: "第五代增强版，更强推理能力",
    color: "#10a37f",
  },
  {
    id: "gpt-5.5-pro",
    name: "GPT 5.5 Pro",
    provider: "OpenAI",
    description: "旗舰级专业模型，最强的多模态能力",
    color: "#10a37f",
  },
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    provider: "Google",
    description: "新一代旗舰推理模型，更强多模态",
    color: "#4285f4",
  },
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    provider: "Google",
    description: "新一代高速模型，响应更快更稳",
    color: "#4285f4",
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek-V4 Pro",
    provider: "DeepSeek",
    description: "V4 Pro 增强版，最强推理能力",
    color: "#4d6bfa",
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek-V4 Flash",
    provider: "DeepSeek",
    description: "V4 轻量版，极速响应",
    color: "#6366f1",
  },
  {
    id: "kimi-k2.6",
    name: "Kimi K2.6",
    provider: "Moonshot",
    description: "最新旗舰版，更强多模态+推理能力",
    color: "#00b96b",
  },
];

const STORAGE_KEY = "selected-model";

function loadSavedModel(models: ChatModel[]): ChatModel {
  if (typeof window === "undefined") return models[0];
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const model = models.find((m) => m.id === saved);
      if (model) return model;
    }
  } catch {}
  return models[0];
}

function persistModel(model: ChatModel) {
  try {
    localStorage.setItem(STORAGE_KEY, model.id);
  } catch {}
}

export function useChat(conversationId: number | undefined, models: ChatModel[], skillKey?: string) {
  const defaultModel = models.length > 0 ? models[0] : ({} as ChatModel);
  const { t } = useI18n();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [selectedModel, setSelectedModelState] = useState<ChatModel>(defaultModel);
  const [conversationTitle, setConversationTitle] = useState("");
  const [currentConversation, setCurrentConversation] = useState<number | undefined>(conversationId);
  const abortControllerRef = useRef<AbortController | null>(null);
  const compareAbortControllersRef = useRef<AbortController[]>([]);
  const conversationLoadSeqRef = useRef(0);
  const lastReasoningRef = useRef<{ enabled: boolean; effort?: string }>({ enabled: false, effort: "high" });
  const lastSearchRef = useRef<boolean>(false);
  const [initialized, setInitialized] = useState(false);
  const [isCompare, setIsCompare] = useState(false);
  const [compareModels, setCompareModels] = useState<string[]>([]);
  // 从对话历史或 prop 恢复的有效 skillKey（优先级：历史 > prop）
  const [effectiveSkillKey, setEffectiveSkillKey] = useState<string | undefined>(skillKey);
  const [groupViews, setGroupViews] = useState<Map<number, number>>(new Map());
  const [totalMessages, setTotalMessages] = useState(0);
  const [loadedPersistedMessages, setLoadedPersistedMessages] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const hasMoreMessages = totalMessages > loadedPersistedMessages;
  const backgroundPollersRef = useRef<Record<string, number>>({});
  const taskStreamsRef = useRef<Record<string, AbortController>>({});
  const abortReasonRef = useRef<"user" | "navigation" | null>(null);
  const activeTaskStreamsRef = useRef<Record<string, { convId?: number; serverMessageId?: number; generationTaskId?: number; lastSequence?: number; content?: string }>>({});
  const modelsKey = models.map((m) => m.id).join("|");
  // 防止 createConversation 成功后 useEffect 因 models 等依赖变化而清空消息/重置对话
  const shouldResetRef = useRef(true);
  // 标记刚创建的新对话 ID，避免 useEffect 立即加载历史覆盖本地正在生成的消息
  const justCreatedRef = useRef<number | undefined>(undefined);

  // 在客户端初始化后，从 localStorage 恢复上次选择的模型
  useEffect(() => {
    const saved = loadSavedModel(models);
    setSelectedModelState(saved);
    setInitialized(true);
  }, []);

  const setSelectedModel = useCallback((model: ChatModel) => {
    setSelectedModelState(model);
    persistModel(model);
    try {
      const RECENT_KEY = "recent-models";
      const recent = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").filter((id: string) => id !== model.id);
      recent.unshift(model.id);
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 3)));
    } catch {}
  }, []);

  const stopBackgroundPoller = useCallback((localMessageId: string) => {
    const timer = backgroundPollersRef.current[localMessageId];
    if (timer) {
      window.clearInterval(timer);
      delete backgroundPollersRef.current[localMessageId];
    }
  }, []);

  const stopTaskStream = useCallback((localMessageId: string) => {
    const controller = taskStreamsRef.current[localMessageId];
    if (controller) {
      controller.abort();
      delete taskStreamsRef.current[localMessageId];
    }
  }, []);

  const startBackgroundPolling = useCallback((convId: number | undefined, localMessageId: string, serverMessageId?: number) => {
    if (!convId || !serverMessageId || backgroundPollersRef.current[localMessageId]) return;

    const token = localStorage.getItem("token");
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      headers["X-Guest-ID"] = getGuestId();
    }

    const runner = startBackgroundPollingRunner({
      apiBaseUrl: API_BASE_URL,
      conversationId: convId,
      serverMessageId,
      headers,
      callbacks: {
        onPollState: (pollState) => {
          const streamActive = !!taskStreamsRef.current[localMessageId];
          const liveContent = streamGet(localMessageId) || realtimeGet(localMessageId)?.content || "";
          const now = Date.now();
          setMessages((prev) => patchMessageById(prev, localMessageId, (m) =>
            // SSE / task event stream 仍在追加时，polling 只能更新状态，不能用 DB 全文覆盖内容。
            // 否则 OpenAI completed 后 message.content 已是全文，但补尾 delta 还在路上，UI 会从半截直接跳全文。
            buildBackgroundPollingMessagePatch({
              existingContent: m.content,
              polledContent: pollState.content,
              liveContent,
              streamActive,
              serverMessageId,
              isFinished: pollState.isFinished,
              now,
              createBusyStatus: () => createBusyGeneratingStatus(t),
            })
          ));
        },
        onFinished: (pollState) => {
          stopBackgroundPoller(localMessageId);
          stopTaskStream(localMessageId);
          const notificationTitle = getNotificationConversationTitle(conversationTitle, selectedModel.name || selectedModel.id);
          emitTaskFinished({
            key: `chat:${serverMessageId}`,
            type: "chat",
            title: pollState.isCompleted ? "长对话任务已完成" : "长对话任务未完成",
            description: notificationTitle,
            href: `/chat?id=${convId}`,
            ok: pollState.isCompleted,
            conversationTitle: notificationTitle,
          });
          const hasOtherTaskStream = Object.keys(taskStreamsRef.current).some((id) => id !== localMessageId);
          const hasOtherPoller = Object.keys(backgroundPollersRef.current).some((id) => id !== localMessageId);
          setIsLoading(hasOtherTaskStream || hasOtherPoller);
        },
        onKeepLoading: () => {
          // terminal 状态可能先于最终 message.content 可见；多轮确认稳定前继续轮询，避免刷新后才完整。
          setIsLoading(true);
        },
        shouldKeepLoading: shouldKeepBackgroundLoading,
        isStreamActive: () => !!taskStreamsRef.current[localMessageId],
      },
    });
    backgroundPollersRef.current[localMessageId] = runner.timer;
  }, [stopBackgroundPoller, stopTaskStream]);

  const startTaskEventStream = useCallback((convId: number | undefined, localMessageId: string, serverMessageId?: number, after: number = 0, initialContent: string = "", generationTaskId?: number) => {
    if (!convId || (!serverMessageId && !generationTaskId) || taskStreamsRef.current[localMessageId]) return;
    activeTaskStreamsRef.current[localMessageId] = { convId, serverMessageId, generationTaskId, lastSequence: after || 0, content: initialContent || "" };
    setIsLoading(true);

    const token = localStorage.getItem("token");
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      headers["X-Guest-ID"] = getGuestId();
    }

    const controller = new AbortController();
    taskStreamsRef.current[localMessageId] = controller;

    const taskEventHandler = createTaskStreamEventHandler({
      convId,
      localMessageId,
      serverMessageId,
      generationTaskId,
      after,
      initialContent,
      t,
      callbacks: {
        getActiveState: () => activeTaskStreamsRef.current[localMessageId],
        setActiveState: (state) => {
          activeTaskStreamsRef.current[localMessageId] = state;
        },
        deleteActiveState: () => {
          delete activeTaskStreamsRef.current[localMessageId];
        },
        streamAppend,
        streamGet: () => streamGet(localMessageId),
        realtimeGet: () => realtimeGet(localMessageId),
        realtimeUpdate: (patch) => realtimeUpdate(localMessageId, patch),
        startBackgroundPolling: (resolvedServerMessageId) => {
          if (resolvedServerMessageId) {
            startBackgroundPolling(convId, localMessageId, resolvedServerMessageId);
          }
        },
      },
    });


    (async () => {
      try {
        await runTaskEventStream({
          apiBaseUrl: API_BASE_URL,
          serverMessageId,
          generationTaskId,
          after,
          headers,
          signal: controller.signal,
          onEvent: taskEventHandler.processEvent,
        });
      } catch {
        if (shouldFallbackToBackgroundPollingAfterTaskStreamError(controller.signal)) {
          startBackgroundPolling(convId, localMessageId, serverMessageId);
        }
      } finally {
        // 同步 streaming store 到 messages state
        const accumulated = taskEventHandler.getAccumulated();
        const latestSequence = taskEventHandler.getLatestSequence();
        const finalData = realtimeGet(localMessageId);
        if (shouldSyncTaskStreamFinalMessage({ hasFinalData: Boolean(finalData), accumulated })) {
          setMessages((prev) => patchMessageById(prev, localMessageId, (m) =>
            applyFinalRealtimeDataToMessage(m, {
              finalContent: accumulated,
              finalData,
              latestSequence,
              forceContentFallback: true,
            })
          ));
        }
        realtimeClear(localMessageId);
        delete taskStreamsRef.current[localMessageId];
        // 无论是否被 abort，只要 serverMessageId 存在就兜底轮询，避免 task stream 异常中断后前端悬停
        if (shouldStartTaskStreamFallbackPolling({ serverMessageId })) {
          startBackgroundPolling(convId, localMessageId, serverMessageId);
        }
      }
    })();
  }, [startBackgroundPolling]);

  useEffect(() => {
    return () => {
      Object.values(backgroundPollersRef.current).forEach((timer) => window.clearInterval(timer));
      backgroundPollersRef.current = {};
      Object.values(taskStreamsRef.current).forEach((controller) => controller.abort());
      taskStreamsRef.current = {};
      activeTaskStreamsRef.current = {};
    };
  }, []);

  useEffect(() => {
    const loadSeq = ++conversationLoadSeqRef.current;
    const loadController = new AbortController();
    const isLatestLoad = () => conversationLoadSeqRef.current === loadSeq;

    if (!conversationId) {
      setIsLoadingHistory(false);
      setConversationTitle("");
      if (shouldResetRef.current) {
        setMessages([]);
        setCurrentConversation(undefined);
      }
      setLoadedPersistedMessages(0);
      setTotalMessages(0);
      setIsCompare(false);
      setCompareModels([]);
      setEffectiveSkillKey(skillKey);
      return () => loadController.abort();
    }

    // 如果这个对话是刚创建的，跳过加载历史（本地已经有正在生成的消息）
    if (justCreatedRef.current === conversationId) {
      justCreatedRef.current = undefined;
      setIsLoadingHistory(false);
      setCurrentConversation(conversationId);
      setLoadedPersistedMessages(0);
      setTotalMessages(0);
      return () => loadController.abort();
    }

    // 切换到已有历史对话时只断开 /api/chat 直连 SSE；本地 task event stream 继续运行，
    // 这样返回当前会话无需刷新也能看到正在追加的深度推理/正文。
    if (abortControllerRef.current) {
      abortReasonRef.current = "navigation";
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (compareAbortControllersRef.current.length > 0) {
      abortReasonRef.current = "navigation";
      compareAbortControllersRef.current.forEach((controller) => controller.abort());
      compareAbortControllersRef.current = [];
    }

    const activeEntries = Object.entries(activeTaskStreamsRef.current);

    const token = localStorage.getItem("token");
    if (!token) {
      setIsLoadingHistory(false);
      return () => loadController.abort();
    }

    setIsLoadingHistory(true);
    setCurrentConversation(conversationId);

    // 加载对话消息：首次只加载最近50条（tail模式），向上滚动时通过 loadMoreMessages 加载更多
    fetch(`${API_BASE_URL}/api/conversations/${conversationId}?message_tail=50`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: loadController.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`load conversation failed: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!isLatestLoad() || loadController.signal.aborted) return;
        setConversationTitle(data.title || "");
        if (data.messages) {
          const loadedMessages: Message[] = data.messages.map((m: any) => ({
            id: String(m.id || uuidv4()),
            role: m.role,
            content: m.content,
            model: m.model,
            createdAt: new Date(m.created_at).getTime(),
            completedAt: m.completed_at ? new Date(m.completed_at).getTime() : undefined,
            files: normalizeMessageFiles(m.files),
            searchSources: parsePersistedSearchSources(m),
            searchSourcesCount: typeof m.search_sources_count === "number" ? m.search_sources_count : undefined,
            searchStatus: m.search_sources_count > 0 || m.search_sources ? "completed" : undefined,
            serverMessageId: Number(m.id || 0) || undefined,
            groupId: m.group_id || undefined,
            groupIndex: m.group_index ?? undefined,
            groupModels: Array.isArray(m.group_models)
              ? m.group_models.filter((model: unknown): model is string => typeof model === "string" && model.length > 0)
              : undefined,
          }));
          // 后端已返回 completed_at，不需要近似回退
          const activeByServerMessageId = new Map(
            activeEntries
              .filter(([, info]) => info.convId === conversationId && info.serverMessageId)
              .map(([localId, info]) => [String(info.serverMessageId), { localId, info }])
          );
          const mergedMessages = loadedMessages.map((m) => {
            if (m.role !== "assistant") return m;
            const active = activeByServerMessageId.get(String(m.serverMessageId || m.id));
            if (!active) return m;
            return {
              ...m,
              id: active.localId,
              content: active.info.content || m.content,
              serverMessageId: active.info.serverMessageId || m.serverMessageId,
              generationTaskId: active.info.generationTaskId || m.generationTaskId,
              lastSequence: active.info.lastSequence || m.lastSequence,
              activityStatus: createGeneratingStatus(t),
            };
          });
          setMessages(mergedMessages);
          setLoadedPersistedMessages(loadedMessages.length);
          // 从历史恢复 groupViews，默认每组显示第 0 个模型
          const newGroupViews = new Map<number, number>();
          mergedMessages.forEach((m) => {
            if (m.groupId !== undefined && !newGroupViews.has(m.groupId)) {
              newGroupViews.set(m.groupId, 0);
            }
          });
          setGroupViews(newGroupViews);
          setIsLoading(activeByServerMessageId.size > 0);

          // 先渲染历史，再异步检查最后一条 assistant 的后台状态，避免切换对话被第二个请求阻塞。
          const lastAssistant = [...mergedMessages].reverse().find((m) => m.role === "assistant" && m.serverMessageId);
          if (lastAssistant?.serverMessageId && !activeByServerMessageId.has(String(lastAssistant.serverMessageId))) {
            fetch(`${API_BASE_URL}/api/conversations/${conversationId}/messages/${lastAssistant.serverMessageId}`, {
              headers: { Authorization: `Bearer ${token}` },
              signal: loadController.signal,
            })
              .then((res) => (res.ok ? res.json() : undefined))
              .then((statusData) => {
                if (!statusData || !isLatestLoad() || loadController.signal.aborted) return;
                const bgTask = statusData?.background_task || {};
                const hasTask = !!bgTask.id || !!bgTask.task_id || !!bgTask.status;
                const status = bgTask.status || "";
                const terminalStatus = status === "completed" || status === "failed" || status === "cancelled" || status === "incomplete";
                const serverContent = statusData?.message?.content || "";
                const hasContent = serverContent.trim().length > 0;
                const shouldResumePolling = hasTask && (!terminalStatus || !hasContent);
                const generationTaskId = Number(bgTask.id || bgTask.task_id || 0) || undefined;
                const lastSequence = Number(bgTask.last_sequence_number || 0) || 0;

                setMessages((prev) => prev.map((m) => {
                  if (m.id !== lastAssistant.id) return m;
                  return {
                    ...m,
                    content: serverContent || m.content,
                    generationTaskId: generationTaskId || m.generationTaskId,
                    lastSequence: lastSequence || m.lastSequence,
                    completedAt: shouldResumePolling
                      ? undefined
                      : (hasTask && terminalStatus && hasContent && !m.completedAt
                        ? (bgTask.completed_at ? new Date(bgTask.completed_at).getTime() : Date.now())
                        : m.completedAt),
                    activityStatus: shouldResumePolling
                      ? createBusyGeneratingStatus(t)
                      : m.activityStatus,
                  } as Message;
                }));

                if (shouldResumePolling) {
                  setIsLoading(true);
                  startTaskEventStream(conversationId, lastAssistant.id, lastAssistant.serverMessageId, lastSequence || lastAssistant.lastSequence || 0, serverContent || lastAssistant.content || "", generationTaskId);
                }
              })
              .catch((err: any) => {
                if (loadController.signal.aborted || err?.name === "AbortError") return;
              });
          }
        } else {
          setMessages([]);
          setLoadedPersistedMessages(0);
          setIsLoading(false);
        }
        setIsLoadingHistory(false);

        // 获取消息总数，用于分页加载更多
        fetch(`${API_BASE_URL}/api/conversations/${conversationId}/messages?limit=1`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: loadController.signal,
        })
          .then((res) => (res.ok ? res.json() : undefined))
          .then((countData) => {
            if (countData && typeof countData.total === "number") {
              setTotalMessages(countData.total);
            }
          })
          .catch(() => {});

        // 设置当前模型
        if (data.model) {
          const model = models.find((m) => m.id === data.model);
          if (model) setSelectedModel(model);
        }
        // 检测是否为对比对话
        setIsCompare(!!data.compare);
        if (data.compare_models) {
          try {
            const parsed = JSON.parse(data.compare_models);
            setCompareModels(Array.isArray(parsed) ? parsed : []);
          } catch {
            setCompareModels([]);
          }
        } else {
          setCompareModels([]);
        }
        // 从历史对话恢复 skill_key；如果历史没有，则回到 URL 传入的 skillKey
        setEffectiveSkillKey(data.skill_key || skillKey);
      })
      .catch((err) => {
        if (!isLatestLoad() || loadController.signal.aborted || err?.name === "AbortError") return;
        setMessages([]);
        setIsLoadingHistory(false);
      });

    return () => loadController.abort();
  }, [conversationId, modelsKey, setSelectedModel, skillKey]);

  // 创建新对话
  const createConversation = useCallback(
    async (title: string, model: string, sk?: string): Promise<number | undefined> => {
      const token = localStorage.getItem("token");
      if (!token) return undefined;

      try {
        const body: any = { title, model };
        if (sk && sk.trim()) {
          body.skill_key = sk.trim();
        }
        // 从 localStorage 获取当前 workspace
        const wsId = localStorage.getItem("current-workspace");
        if (wsId) {
          body.workspace_id = Number(wsId);
        }
        const res = await fetch(`${API_BASE_URL}/api/conversations`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          console.error("createConversation failed:", res.status, await res.text().catch(() => ""));
          return undefined;
        }
        const data = await res.json();
        setConversationTitle(data.title || title);
        setCurrentConversation(data.id);
        shouldResetRef.current = false; // 标记已创建对话，防止 useEffect 清空消息
        justCreatedRef.current = data.id; // 标记刚创建，避免 useEffect 加载历史覆盖本地消息
        // 立即更新 URL，确保用户跳转/刷新后能回到当前对话
        const url = new URL(window.location.href);
        url.searchParams.set("id", String(data.id));
        if (sk && !url.searchParams.get("key")) {
          url.searchParams.set("key", sk);
        }
        window.history.replaceState({}, "", url.toString());
        // 通知侧边栏刷新列表
        window.dispatchEvent(new CustomEvent("conversation-created", { detail: data }));
        return data.id;
      } catch (err) {
        console.error("createConversation error:", err);
        return undefined;
      }
    },
    []
  );

  // 流式读取核心逻辑
  const streamResponse = useCallback(
    async (
      response: Response,
      assistantMsg: Message,
      controller: AbortController,
      convId?: number,
      onGroupContext?: (context: CompareGroupContext) => void
    ): Promise<StreamRunResult | undefined> => {
      const mainStreamHandler = createMainStreamEventHandler({
        assistantMessageId: assistantMsg.id,
        assistantModelName: assistantMsg.model,
        selectedModelName: selectedModel.name,
        conversationId: convId,
        conversationTitle,
        initialGroupMeta: {
          groupId: assistantMsg.groupId,
          groupIndex: assistantMsg.groupIndex,
          groupModels: assistantMsg.groupModels,
          userMessageId: assistantMsg.userMessageId,
        },
        t,
        callbacks: {
          streamAppend,
          streamGet: () => streamGet(assistantMsg.id),
          realtimeGet: () => realtimeGet(assistantMsg.id),
          realtimeUpdate: (patch) => realtimeUpdate(assistantMsg.id, patch),
          registerBackgroundTask,
          onGroupContext,
        },
      });

      const buildStreamRunResult = (contentOverride?: string): StreamRunResult => {
        const state = mainStreamHandler.getState();
        return buildChatStreamRunResult({
          groupContext: state.groupContext,
          serverMessageId: state.serverMessageId,
          generationTaskId: state.generationTaskId,
          lastSequence: state.lastSequence,
          content: contentOverride,
          fallbackContent: streamGet(assistantMsg.id) || state.accumulated,
          useBackground: state.useBackground,
          sawDone: state.sawDone,
          recoverable: state.recoverable,
        });
      };

      try {
        const lifecycleResult = await runChatStreamLifecycle({
          response,
          signal: controller.signal,
          getAbortReason: () => abortReasonRef.current,
          getRecoveryIds: () => ({
            serverMessageId: mainStreamHandler.getState().serverMessageId,
            generationTaskId: mainStreamHandler.getState().generationTaskId,
          }),
          onEvent: mainStreamHandler.processEvent,
        });
        if (lifecycleResult.action === "ignored") {
          return;
        }
        if (lifecycleResult.action === "resume") {
          mainStreamHandler.setRecoverable(true);
          const state = mainStreamHandler.getState();
          startTaskEventStream(convId || currentConversation, assistantMsg.id, state.serverMessageId, state.lastSequence, state.accumulated, state.generationTaskId);
          return;
        }
      } finally {
        const abortReason = abortReasonRef.current;

        // 如果 reasoning 块未关闭，自动关闭
        mainStreamHandler.closeOpenReasoning();
        const state = mainStreamHandler.getState();

        // 同步 streaming store 到 messages state
        const finalContent = streamGet(assistantMsg.id) || state.accumulated;
        const finalData = realtimeGet(assistantMsg.id);
        if (finalContent || finalData) {
          setMessages((prev) => patchMessageById(prev, assistantMsg.id, (m) =>
            applyFinalRealtimeDataToMessage(m, { finalContent, finalData })
          ));
        }

        // SSE 自然断开但没有收到 DONE：不能把空 assistant 标 completed。
        // 后端 task runner 仍可能在生成/落库，转为可恢复 task stream / polling。
        if (shouldRecoverStream({
          sawDone: state.sawDone,
          abortReason,
          serverMessageId: state.serverMessageId,
          generationTaskId: state.generationTaskId,
        })) {
          mainStreamHandler.setRecoverable(true);
          startTaskEventStream(convId || currentConversation, assistantMsg.id, state.serverMessageId, state.lastSequence, finalContent, state.generationTaskId);
          if (state.useBackground && state.serverMessageId) {
            startBackgroundPolling(convId || currentConversation, assistantMsg.id, state.serverMessageId);
          }
          return buildStreamRunResult(finalContent);
        }

        const hasFinalContent = (finalContent || "").trim().length > 0;

        // OpenAI background/complex task 的 [DONE] 只代表当前 SSE/event stream 结束，
        // 不代表已展示内容就是 DB 最终内容。即使已有部分内容，也要继续通过
        // task stream / DB polling 校准，否则会出现“输出一半直接 DONE，刷新后变完整”。
        if (shouldReconcileAfterDone({
          sawDone: state.sawDone,
          abortReason,
          serverMessageId: state.serverMessageId,
          generationTaskId: state.generationTaskId,
        })) {
          mainStreamHandler.setRecoverable(true);
          // The initial /chat request is itself a task event stream. Its controller is
          // still registered until this finally block finishes, so an immediate
          // startTaskEventStream() would no-op and leave the UI stuck on partial text.
          // DB polling is the correct post-DONE reconciler here; explicit task
          // stream reattach is reserved for abnormal disconnects before DONE.
          if (state.serverMessageId) {
            startBackgroundPolling(convId || currentConversation, assistantMsg.id, state.serverMessageId);
          }
          return buildStreamRunResult(finalContent);
        }

        streamClear(assistantMsg.id);
        realtimeClear(assistantMsg.id);

        // 切会话/用户停止时不要在旧异步里把消息标 completed。
        // 切回该会话时由历史加载 + task event stream 恢复真实状态。
        if (shouldMarkCompleted({ sawDone: state.sawDone, hasFinalContent, abortReason })) {
          setMessages((prev) => patchMessageById(prev, assistantMsg.id, buildCompletedPatch(Date.now())));
        }
      }

      return buildStreamRunResult();
    },
    [currentConversation, startBackgroundPolling, startTaskEventStream]
  );

  // 对比模式：固定两个模型并发流式展示
  const sendCompareMessages = useCallback(
    async (
      content: string,
      modelIds: string[],
      reasoning: { enabled: boolean; effort?: string } = { enabled: false },
      search: boolean = false,
      templateId: number = 0,
      attachments?: { filename: string; content: string; type?: string; public_id?: string }[],
      file_ids?: string[],
      templatePrefix?: string
    ) => {
      if (!content.trim() && (!attachments || attachments.length === 0)) return;

      const compareModelIds = selectCompareModelIds(modelIds, models);
      if (!shouldStartCompare(compareModelIds)) return;

      lastReasoningRef.current = reasoning;
      lastSearchRef.current = search;

      const token = localStorage.getItem("token");

      // 确定当前对话 ID
      let convId = currentConversation;
      if (token && !convId) {
        const title = content.trim().slice(0, 20) + (content.trim().length > 20 ? "..." : "");
        convId = await createConversation(title, compareModelIds[0], effectiveSkillKey);
      }

      const finalContent = content.trim();
      const userFiles = buildMessageFiles(attachments, { defaultType: "file" });
      const userMsg = createUserChatMessage({
        id: uuidv4(),
        content: finalContent,
        createdAt: Date.now(),
        files: userFiles,
      }) as Message;
      const assistantMsgs = createCompareAssistantMessages({
        modelIds: compareModelIds,
        ids: compareModelIds.map(() => uuidv4()),
        createdAt: Date.now(),
        search: lastSearchRef.current,
      }) as Message[];
      const contextMessages = [...messages, userMsg];

      setIsCompare(true);
      setCompareModels(compareModelIds);
      setMessages((prev) => [...prev, userMsg, ...assistantMsgs]);
      setIsLoading(true);

      const controllers = assistantMsgs.map(() => new AbortController());
      compareAbortControllersRef.current = controllers;
      abortControllerRef.current = null;
      abortReasonRef.current = null;

      const headers = buildChatRequestHeaders({ token, guestId: getGuestId() });

      const handleCompareGroupContextResolved = (context: CompareGroupContext) => {
        setMessages((prev) => applyCompareGroupContextToMessages(prev, {
          userMessageId: userMsg.id,
          assistantIds: assistantMsgs.map((assistant) => assistant.id),
          context,
        }));
      };

      const handleCompareRecoverableResult = (assistantMsg: Message, streamResult: StreamRunResult) => {
        setMessages((prev) => patchMessageById(prev, assistantMsg.id, (m) => buildRecoverableBusyPatch({
          serverMessageId: streamResult.serverMessageId || m.serverMessageId,
          generationTaskId: streamResult.generationTaskId || m.generationTaskId,
          activityStatus: createBusyGeneratingStatus(t),
        })));
      };

      const handleCompareRunError = (assistantMsg: Message, error: any, streamResult?: StreamRunResult) => {
        const now = Date.now();
        const realtime = realtimeGet(assistantMsg.id);
        const { serverMessageId, generationTaskId } = resolveRecoveryIds({
          streamServerMessageId: streamResult?.serverMessageId,
          realtimeServerMessageId: realtime?.serverMessageId,
          streamGenerationTaskId: streamResult?.generationTaskId,
          realtimeGenerationTaskId: realtime?.generationTaskId,
        });

        if (shouldRecoverCompareRun({
          serverMessageId,
          generationTaskId,
          hasTaskStream: !!taskStreamsRef.current[assistantMsg.id],
          hasBackgroundPoller: !!backgroundPollersRef.current[assistantMsg.id],
          model: assistantMsg.model,
          conversationId: convId,
        })) {
          setMessages((prev) => patchMessageById(prev, assistantMsg.id, (m) => buildRecoverableBusyPatch({
            serverMessageId: serverMessageId || m.serverMessageId,
            generationTaskId: generationTaskId || m.generationTaskId,
            activityStatus: createBusyGeneratingStatus(t),
          })));
          if (serverMessageId) startBackgroundPolling(convId, assistantMsg.id, serverMessageId);
          return;
        }

        setMessages((prev) => patchMessageById(prev, assistantMsg.id, buildDisplayErrorPatch({ errorCode: error.errorCode, message: error.message, now })));
      };

      try {
        await runCompareModels({
          apiBaseUrl: API_BASE_URL,
          headers,
          controllers,
          assistantMessages: assistantMsgs,
          compareModelIds,
          modelMessages: toModelMessages(contextMessages),
          conversationId: convId,
          reasoning,
          search,
          templateId,
          templatePrefix,
          skillKey: effectiveSkillKey,
          messageFileIds: file_ids,
          callbacks: {
            streamResponse,
            onGroupContextResolved: handleCompareGroupContextResolved,
            onRecoverableResult: handleCompareRecoverableResult,
            onAbortUser: (assistantMsg) => {
              setMessages((prev) => patchMessageById(prev, assistantMsg.id, buildStoppedPatch(Date.now())));
            },
            onRunError: handleCompareRunError,
            getAbortReason: () => abortReasonRef.current,
          },
        });
      } finally {
        const abortReason = abortReasonRef.current;
        // 和单聊保持一致：切换会话导致的 abort 只是断开当前页面 SSE，不要污染新会话 loading/侧边栏状态。
        if (abortReason !== "navigation") {
          const hasActiveTaskStream = Object.keys(taskStreamsRef.current).length > 0;
          const hasActivePoller = Object.keys(backgroundPollersRef.current).length > 0;
          setIsLoading(hasActiveTaskStream || hasActivePoller);
          compareAbortControllersRef.current = [];
          abortControllerRef.current = null;
          abortReasonRef.current = null;
          if (convId) {
            window.dispatchEvent(new CustomEvent("conversation-updated", {
              detail: { id: convId, updated_at: new Date().toISOString() },
            }));
          }
        }
      }
    },
    [messages, models, currentConversation, createConversation, streamResponse, effectiveSkillKey]
  );

  const sendMessage = useCallback(
    async (
      content: string,
      reasoning: { enabled: boolean; effort?: string } = { enabled: false },
      isRegenerate: boolean = false,
      search: boolean = false,
      templateId: number = 0,
      skipUserMsg: boolean = false,
      attachments?: { filename: string; content: string; type: string; public_id?: string }[],
      file_ids?: string[],
      templatePrefix?: string
    ) => {
      if (!shouldStartSingleSend({ content, isRegenerate, attachments })) return;

      lastReasoningRef.current = reasoning;
      lastSearchRef.current = search;

      const token = localStorage.getItem("token");

      // 确定当前对话 ID（登录状态下）
      let convId = currentConversation;
      if (token && !convId && !isRegenerate) {
        const title = buildNewConversationTitle(content);
        convId = await createConversation(title, selectedModel.id, effectiveSkillKey);
        if (!convId) {
          // 创建对话失败，显示错误提示并终止
          setMessages((prev) => [
            ...prev,
            {
              id: uuidv4(),
              role: "assistant",
              content: "❌ 创建对话失败，请检查登录状态或刷新页面重试",
              model: selectedModel.id,
              createdAt: Date.now(),
            },
          ]);
          setIsLoading(false);
          return;
        }
      }

      const messagePlan = prepareSingleSendMessages<Message>({
        content,
        messages,
        modelId: selectedModel.id,
        isRegenerate,
        skipUserMessage: skipUserMsg,
        attachments,
        search: lastSearchRef.current,
        createId: uuidv4,
        now: Date.now,
      });
      if (!messagePlan) return;

      const contextMessages = messagePlan.contextMessages;
      const assistantMsg = messagePlan.assistantMessage;
      setMessages((prev) => applySingleSendMessagePlan(prev, messagePlan));

      setIsLoading(true);
      const controller = new AbortController();
      abortReasonRef.current = null;
      abortControllerRef.current = controller;

      try {
        const headers = buildChatRequestHeaders({ token, guestId: getGuestId() });
        await runSingleChatRequest({
          apiBaseUrl: API_BASE_URL,
          headers,
          controller,
          assistantMessage: assistantMsg,
          modelId: selectedModel.id,
          modelMessages: toModelMessages(contextMessages),
          conversationId: convId,
          reasoning,
          search,
          templateId,
          skipSaveUserMessage: skipUserMsg,
          skillKey: effectiveSkillKey,
          messageFileIds: file_ids,
          streamResponse,
        });
      } catch (error: any) {
        if (error.name === "AbortError") {
          // 只有点击“停止生成”才显示中断；切换会话/页面导致的 Abort 不污染消息状态。
          if (abortReasonRef.current === "user") {
            setMessages((prev) => patchMessageById(prev, assistantMsg.id, buildStoppedPatch()));
          }
        } else {
          const isBackgroundModel = selectedModel.id === "gpt-5.5-pro" || selectedModel.id.startsWith("gpt-5.5-pro-");
          if (isBackgroundModel && convId) {
            setMessages((prev) => patchMessageById(prev, assistantMsg.id, buildRecoverableBusyPatch({ activityStatus: createBusyGeneratingStatus(t) })));
          } else {
            setMessages((prev) => patchMessageById(prev, assistantMsg.id, buildDisplayErrorPatch({
              errorCode: error.errorCode,
              message: error.errorCode === "guest_limit_exceeded" ? "匿名用户每日次数用完，请登录后继续" : error.message,
            })));
          }
        }
      } finally {
        const abortReason = abortReasonRef.current;
        // 切换会话导致的 abort 只是断开当前页面 SSE，后端仍继续生成；不要在旧异步 finally 里改全局 loading/清 reason。
        if (abortReason !== "navigation") {
          const hasActiveTaskStream = Object.keys(taskStreamsRef.current).length > 0;
          if (!hasActiveTaskStream) {
            setIsLoading(false);
            abortControllerRef.current = null;
            abortReasonRef.current = null;
          }
        }
        // 通知侧边栏仅做本地排序/时间更新，避免每次发消息都全量重拉历史列表
        if (convId) {
          window.dispatchEvent(new CustomEvent("conversation-updated", {
            detail: { id: convId, updated_at: new Date().toISOString() },
          }));
        }
      }
    },
    [messages, selectedModel, currentConversation, createConversation, streamResponse, effectiveSkillKey]
  );

  const stopGeneration = useCallback(() => {
    const token = localStorage.getItem("token");
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    } else {
      headers["X-Guest-ID"] = getGuestId();
    }

    runStopGeneration({
      messages,
      callbacks: {
        cancelTask: (taskId) => {
          cancelGenerationTask({
            apiBaseUrl: API_BASE_URL,
            taskId,
            headers,
          });
        },
        abortTaskStreams: () => {
          Object.values(taskStreamsRef.current).forEach((controller) => controller.abort());
          taskStreamsRef.current = {};
        },
        getMainAbortController: () => abortControllerRef.current,
        clearMainAbortController: () => {
          abortControllerRef.current = null;
        },
        getCompareAbortControllers: () => compareAbortControllersRef.current,
        clearCompareAbortControllers: () => {
          compareAbortControllersRef.current = [];
        },
        setAbortReason: (reason) => {
          abortReasonRef.current = reason;
        },
      },
    });
  }, [messages]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setCurrentConversation(undefined);
  }, []);

  const deleteMessage = useCallback((messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  }, []);

  const regenerateMessage = useCallback(async () => {
    // 重新生成最后一条用户消息的回复
    const lastUserMsg = messages
      .filter((m) => m.role === "user")
      .pop();
    if (lastUserMsg) {
      await sendMessage(lastUserMsg.content, lastReasoningRef.current, true, lastSearchRef.current);
    }
  }, [messages, sendMessage]);

  const switchGroupModel = useCallback((groupId: number, activeIndex: number) => {
    setGroupViews((prev) => {
      const next = new Map(prev);
      next.set(groupId, activeIndex);
      return next;
    });
  }, []);

  // Fork 对比：从指定消息处 Fork 出新模型对比
  const forkChat = useCallback(
    async (messageId: number, modelIds: string[]) => {
      const token = localStorage.getItem("token");
      const headers = buildChatRequestHeaders({ token, guestId: getGuestId() });
      const data = await runForkChatRequest({
        apiBaseUrl: API_BASE_URL,
        messageId,
        modelIds,
        headers,
      });

      // 进入对比模式
      setIsCompare(true);
      setCompareModels(resolveForkedModels(data, modelIds));

      // 刷新消息列表（新 fork 的 assistant 消息已被后端创建，可立即展示占位）
      const convId = resolveForkConversationId(data, currentConversation);
      if (convId && token) {
        try {
          const refreshData = await fetchForkConversationRefresh({
            apiBaseUrl: API_BASE_URL,
            conversationId: convId,
            token,
          });
          const refreshState = buildForkRefreshState(refreshData, {
            fallbackId: uuidv4,
          });
          if (refreshState) {
            setMessages(refreshState.messages as Message[]);
            setLoadedPersistedMessages(refreshState.messages.length);
            setGroupViews(refreshState.groupViews);
          }
        } catch (e) {
          console.error("fork refresh failed:", e);
        }
      }

      return data;
    },
    [currentConversation]
  );

  // 向上滚动加载更多历史消息
  const loadMoreMessages = useCallback(async () => {
    if (!currentConversation || isLoadingMore || !hasMoreMessages) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    setIsLoadingMore(true);
    try {
      const limit = 50;
      const offset = Math.max(0, totalMessages - loadedPersistedMessages - limit);
      const expectedOlderCount = Math.max(0, totalMessages - loadedPersistedMessages - offset);
      const res = await fetch(
        `${API_BASE_URL}/api/conversations/${currentConversation}/messages?limit=${expectedOlderCount || limit}&offset=${offset}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return;
      const data = await res.json();
      const olderMessages: Message[] = (data.messages || []).map((m: any) => ({
        id: String(m.id || uuidv4()),
        role: m.role,
        content: m.content,
        model: m.model,
        createdAt: new Date(m.created_at).getTime(),
        completedAt: m.completed_at ? new Date(m.completed_at).getTime() : undefined,
        files: normalizeMessageFiles(m.files),
        searchSources: parsePersistedSearchSources(m),
        searchSourcesCount: typeof m.search_sources_count === "number" ? m.search_sources_count : undefined,
        searchStatus: m.search_sources_count > 0 || m.search_sources ? "completed" : undefined,
        serverMessageId: Number(m.id || 0) || undefined,
        groupId: m.group_id || undefined,
        groupIndex: m.group_index ?? undefined,
      }));
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.serverMessageId).filter(Boolean));
        const newOnes = olderMessages.filter((m) => {
          if (!m.serverMessageId || existingIds.has(m.serverMessageId)) return false;
          existingIds.add(m.serverMessageId);
          return true;
        });
        return [...newOnes, ...prev];
      });
      setLoadedPersistedMessages((prev) => Math.min(typeof data.total === "number" ? data.total : totalMessages, prev + olderMessages.length));
      if (typeof data.total === "number") {
        setTotalMessages(data.total);
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingMore(false);
    }
  }, [currentConversation, isLoadingMore, hasMoreMessages, totalMessages, loadedPersistedMessages]);

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

