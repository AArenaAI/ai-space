"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useChatModelSelection } from "@/hooks/useChatModelSelection";
import { useChatLocalActions } from "@/hooks/useChatLocalActions";
import { useChatBackgroundPollingRuntime } from "@/hooks/useChatBackgroundPollingRuntime";
import { useChatTaskStreamRuntime } from "@/hooks/useChatTaskStreamRuntime";
import { useChatMainStreamRuntime } from "@/hooks/useChatMainStreamRuntime";
import {
  useChatConversationLifecycle,
  useLoadMoreMessagesAction,
} from "@/hooks/useChatConversationLifecycle";
import { useI18n } from "@/lib/i18n";
import { v4 as uuidv4 } from "uuid";
import { getGuestId } from "@/lib/guestId";
import { realtimeGet } from "@/lib/streaming";
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
  buildConversationRestoreState,
  buildConversationStatusDecision,
  fetchConversationMessageCount,
  fetchConversationMessageStatus,
  fetchConversationRestore,
  findLastAssistantStatusTarget,
  parseConversationCompareModels,
  resolveConversationSkillKey,
} from "@/lib/chatConversationRestoreCoordinator";
import {
  buildConversationNavigationPlan,
  shouldContinueConversationRestore,
} from "@/lib/chatNavigationResetCoordinator";
import {
  buildCreateConversationBody,
  buildCreatedConversationUrl,
  resolveCreatedConversationTitle,
  runCreateConversationRequest,
  shouldCreateConversation,
} from "@/lib/chatConversationCreateCoordinator";
import {
  buildConversationUpdatedEventDetail,
  buildRecoverableResultPatch,
  buildUserAbortStoppedPatch,
  decideCompareRunError,
  decideCompareRunFinally,
  decideSingleSendError,
  decideSingleSendFinally,
} from "@/lib/chatRunUiCoordinator";
import {
  appendCreateConversationFailureMessage,
  buildCreateConversationFailureMessage,
} from "@/lib/chatLocalActionCoordinator";
import {
  type ChatStreamGroupContext,
  type ChatStreamRunResult,
} from "@/lib/chatStreamRunResult";
import {
  applyCompareGroupContextToMessages,
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
  shouldIgnoreStreamAbort,
  shouldResumeTaskStreamAfterError,
} from "@/lib/chatErrorRecovery";
import {
  createBusyGeneratingStatus,
  createFinalizingStatus,
  createGeneratingStatus,
} from "@/lib/chatActivityStatus";
import type {
  ChatModel,
  Conversation,
  Message,
  SearchSource,
} from "@/lib/chatTypes";

const API_BASE_URL = ""; // 使用相对路径，nginx 同域名代理 /api -> 后端

export type { ChatModel, Conversation, Message, SearchSource } from "@/lib/chatTypes";

type CompareGroupContext = ChatStreamGroupContext;
type StreamRunResult = ChatStreamRunResult;

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

export function useChat(conversationId: number | undefined, models: ChatModel[], skillKey?: string) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const { selectedModel, setSelectedModel, initialized } = useChatModelSelection(models);
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
  const abortReasonRef = useRef<"user" | "navigation" | null>(null);
  const modelsKey = models.map((m) => m.id).join("|");

  const stopTaskStream = useCallback((localMessageId: string) => {
    const controller = taskStreamsRef.current[localMessageId];
    if (controller) {
      controller.abort();
      delete taskStreamsRef.current[localMessageId];
    }
  }, []);

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

  useEffect(() => {
    return () => {
      stopAllBackgroundPollers();
      stopAllTaskStreams();
    };
  }, [stopAllBackgroundPollers, stopAllTaskStreams]);

  useEffect(() => {
    const loadSeq = ++conversationLoadSeqRef.current;
    const loadController = new AbortController();
    const isLatestLoad = () => conversationLoadSeqRef.current === loadSeq;

    const navigationPlan = buildConversationNavigationPlan({
      conversationId,
      shouldReset: shouldResetRef.current,
      justCreatedConversationId: justCreatedRef.current,
      skillKey,
      hasMainAbortController: Boolean(abortControllerRef.current),
      compareAbortControllerCount: compareAbortControllersRef.current.length,
    });

    if (navigationPlan.kind === "reset") {
      if (navigationPlan.shouldSetLoadingHistory) setIsLoadingHistory(navigationPlan.loadingHistory);
      applyNavigationResetLifecycle(navigationPlan);
      if (navigationPlan.shouldResetMessages) setMessages([]);
      setIsCompare(navigationPlan.isCompare);
      setCompareModels(navigationPlan.compareModels);
      setEffectiveSkillKey(navigationPlan.effectiveSkillKey);
      return () => loadController.abort();
    }

    if (navigationPlan.kind === "just_created") {
      applyJustCreatedNavigationLifecycle(navigationPlan);
      setIsLoadingHistory(navigationPlan.loadingHistory);
      return () => loadController.abort();
    }

    const { abortPlan } = navigationPlan;
    if (abortPlan.shouldAbortMain && abortControllerRef.current) {
      abortReasonRef.current = abortPlan.abortReason;
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (abortPlan.shouldAbortCompare && compareAbortControllersRef.current.length > 0) {
      abortReasonRef.current = abortPlan.abortReason;
      compareAbortControllersRef.current.forEach((controller) => controller.abort());
      compareAbortControllersRef.current = [];
    }

    const activeEntries = Object.entries(activeTaskStreamsRef.current);

    const token = localStorage.getItem("token");
    if (!shouldContinueConversationRestore({ token, loadAborted: loadController.signal.aborted })) {
      setIsLoadingHistory(false);
      return () => loadController.abort();
    }
    const loadConversationId: number = navigationPlan.conversationId;
    const authToken: string = token as string;

    if (navigationPlan.shouldSetLoadingHistory) setIsLoadingHistory(navigationPlan.loadingHistory);
    applyLoadExistingNavigationLifecycle(navigationPlan);

    // 加载对话消息：首次只加载最近50条（tail模式），向上滚动时通过 loadMoreMessages 加载更多
    fetchConversationRestore({
      apiBaseUrl: API_BASE_URL,
      conversationId: loadConversationId,
      token: authToken,
      signal: loadController.signal,
    })
      .then((data) => {
        if (!isLatestLoad() || loadController.signal.aborted) return;
        setConversationTitle(data.title || "");
        const restoreState = buildConversationRestoreState({
          data,
          activeEntries,
          conversationId: loadConversationId,
          fallbackId: uuidv4,
          activeActivityStatus: createGeneratingStatus(t),
        });
        if (restoreState) {
          const { loadedMessages, mergedMessages, groupViews, activeByServerMessageId } = restoreState;
          setMessages(mergedMessages as Message[]);
          setLoadedPersistedMessages(loadedMessages.length);
          setGroupViews(groupViews);
          setIsLoading(restoreState.isLoading);

          // 先渲染历史，再异步检查最后一条 assistant 的后台状态，避免切换对话被第二个请求阻塞。
          const lastAssistant = findLastAssistantStatusTarget(mergedMessages, activeByServerMessageId);
          if (lastAssistant?.serverMessageId) {
            fetchConversationMessageStatus({
              apiBaseUrl: API_BASE_URL,
              conversationId: loadConversationId,
              serverMessageId: lastAssistant.serverMessageId,
              token: authToken,
              signal: loadController.signal,
            })
              .then((statusData) => {
                if (!statusData || !isLatestLoad() || loadController.signal.aborted) return;
                const decision = buildConversationStatusDecision({
                  statusData,
                  currentMessage: lastAssistant,
                  busyActivityStatus: createBusyGeneratingStatus(t),
                });

                setMessages((prev) => patchMessageById(prev, lastAssistant.id, decision.patch as Partial<Message>));

                if (decision.shouldResumePolling && decision.resume) {
                  setIsLoading(true);
                  startTaskEventStream(
                    conversationId,
                    lastAssistant.id,
                    lastAssistant.serverMessageId,
                    decision.resume.lastSequence,
                    decision.resume.initialContent,
                    decision.resume.generationTaskId
                  );
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
        fetchConversationMessageCount({
          apiBaseUrl: API_BASE_URL,
          conversationId: loadConversationId,
          token: authToken,
          signal: loadController.signal,
        })
          .then((total) => {
            if (typeof total === "number") {
              setTotalMessages(total);
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
        setCompareModels(parseConversationCompareModels(data.compare_models));
        // 从历史对话恢复 skill_key；如果历史没有，则回到 URL 传入的 skillKey
        setEffectiveSkillKey(resolveConversationSkillKey(data.skill_key, skillKey));
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
      if (!shouldCreateConversation({ token })) return undefined;

      try {
        const body = buildCreateConversationBody({
          title,
          model,
          skillKey: sk,
          workspaceId: localStorage.getItem("current-workspace"),
        });
        const data = await runCreateConversationRequest({
          apiBaseUrl: API_BASE_URL,
          token: token as string,
          body,
        });
        if (!data) return undefined;

        setCreatedConversation(data.id, resolveCreatedConversationTitle(data, title));
        window.history.replaceState({}, "", buildCreatedConversationUrl({
          currentHref: window.location.href,
          conversationId: data.id,
          skillKey: sk,
        }));
        // 通知侧边栏刷新列表
        window.dispatchEvent(new CustomEvent("conversation-created", { detail: data }));
        return data.id;
      } catch (err) {
        console.error("createConversation error:", err);
        return undefined;
      }
    },
    [setCreatedConversation]
  );

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
        setMessages((prev) => patchMessageById(prev, assistantMsg.id, (m) => buildRecoverableResultPatch({
          serverMessageId: streamResult.serverMessageId,
          generationTaskId: streamResult.generationTaskId,
          existingServerMessageId: m.serverMessageId,
          existingGenerationTaskId: m.generationTaskId,
          busyActivityStatus: createBusyGeneratingStatus(t),
        })));
      };

      const handleCompareRunError = (assistantMsg: Message, error: any, streamResult?: StreamRunResult) => {
        const realtime = realtimeGet(assistantMsg.id);
        const decision = decideCompareRunError({
          assistantModel: assistantMsg.model || "",
          error,
          streamResult,
          realtime,
          hasTaskStream: !!taskStreamsRef.current[assistantMsg.id],
          hasBackgroundPoller: !!backgroundPollersRef.current[assistantMsg.id],
          conversationId: convId,
          existingServerMessageId: assistantMsg.serverMessageId,
          existingGenerationTaskId: assistantMsg.generationTaskId,
          busyActivityStatus: createBusyGeneratingStatus(t),
          now: Date.now(),
        });

        setMessages((prev) => patchMessageById(prev, assistantMsg.id, decision.patch));
        if (decision.type === "recoverable_busy" && decision.shouldStartBackgroundPolling && decision.serverMessageId) {
          startBackgroundPolling(convId, assistantMsg.id, decision.serverMessageId);
        }
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
              setMessages((prev) => patchMessageById(prev, assistantMsg.id, buildUserAbortStoppedPatch(Date.now())));
            },
            onRunError: handleCompareRunError,
            getAbortReason: () => abortReasonRef.current,
          },
        });
      } finally {
        const decision = decideCompareRunFinally({
          abortReason: abortReasonRef.current,
          hasActiveTaskStream: Object.keys(taskStreamsRef.current).length > 0,
          hasActivePoller: Object.keys(backgroundPollersRef.current).length > 0,
          conversationId: convId,
        });
        if (decision.shouldUpdateLoading) setIsLoading(Boolean(decision.isLoading));
        if (decision.shouldClearCompareControllers) compareAbortControllersRef.current = [];
        if (decision.shouldClearMainController) abortControllerRef.current = null;
        if (decision.shouldClearAbortReason) abortReasonRef.current = null;
        if (decision.shouldDispatchConversationUpdated && decision.conversationId) {
          window.dispatchEvent(new CustomEvent("conversation-updated", {
            detail: buildConversationUpdatedEventDetail(decision.conversationId, new Date().toISOString()),
          }));
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
          const failureMessage = buildCreateConversationFailureMessage({
            id: uuidv4(),
            modelId: selectedModel.id,
            createdAt: Date.now(),
          }) as Message;
          setMessages((prev) => appendCreateConversationFailureMessage(prev, failureMessage));
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
        const decision = decideSingleSendError({
          error,
          abortReason: abortReasonRef.current,
          modelId: selectedModel.id,
          conversationId: convId,
          busyActivityStatus: createBusyGeneratingStatus(t),
        });
        if (decision.type !== "none") {
          setMessages((prev) => patchMessageById(prev, assistantMsg.id, decision.patch));
        }
      } finally {
        const decision = decideSingleSendFinally({
          abortReason: abortReasonRef.current,
          hasActiveTaskStream: Object.keys(taskStreamsRef.current).length > 0,
          conversationId: convId,
        });
        if (decision.shouldUpdateLoading) setIsLoading(Boolean(decision.isLoading));
        if (decision.shouldClearMainController) abortControllerRef.current = null;
        if (decision.shouldClearAbortReason) abortReasonRef.current = null;
        // 通知侧边栏仅做本地排序/时间更新，避免每次发消息都全量重拉历史列表
        if (decision.shouldDispatchConversationUpdated && decision.conversationId) {
          window.dispatchEvent(new CustomEvent("conversation-updated", {
            detail: buildConversationUpdatedEventDetail(decision.conversationId, new Date().toISOString()),
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

