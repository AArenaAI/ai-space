"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { getGuestId } from "@/lib/guestId";
import { streamAppend, streamGet, streamClear, realtimeUpdate, realtimeGet, realtimeClear , RealtimeData } from "@/lib/streaming";
import {
  BUSY_GENERATING_LABEL,
  createActivityStatusFromMeta,
  createBusyGeneratingStatus,
  createFinalizingStatus,
  createGeneratingStatus,
  createWebSearchDoneStatus,
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

function stripReasoningBlocks(content: string): string {
  if (!content) return content;
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .trim();
}

const ASSISTANT_HISTORY_TRUNCATE_THRESHOLD = 1500;
const ASSISTANT_HISTORY_TRUNCATE_TO = 300;

function truncateAssistantHistory(content: string): string {
  if (!content || content.length <= ASSISTANT_HISTORY_TRUNCATE_THRESHOLD) return content;
  const truncated = content.slice(0, ASSISTANT_HISTORY_TRUNCATE_TO).trim();
  return truncated + "\n\n[前文已省略，如需回顾请重新提问]";
}

function toModelMessages(messages: Message[]) {
  return messages
    .map((m) => ({
      role: m.role,
      content: m.role === "assistant"
        ? truncateAssistantHistory(stripReasoningBlocks(m.content))
        : m.content,
    }))
    .filter((m) => m.role !== "assistant" || m.content.trim() !== "");
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

type CompareGroupContext = {
  groupId?: number;
  userMessageId?: number;
  groupModels: string[];
};

type StreamRunResult = {
  groupContext?: CompareGroupContext;
  serverMessageId?: number;
  generationTaskId?: number;
  lastSequence: number;
  content: string;
  useBackground: boolean;
  sawDone: boolean;
  recoverable?: boolean;
};

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

    let terminalStableCount = 0;
    let lastContent = "";
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/conversations/${convId}/messages/${serverMessageId}`, {
          headers,
        });
        if (!res.ok) return;
        const data = await res.json();
        const content = data?.message?.content || "";
        const status = data?.background_task?.status || "";
        const hasContent = content.trim().length > 0;
        const isCompleted = status === "completed" && hasContent;
        const isHardStopped = status === "cancelled";
        const isSoftTerminal = status === "failed" || status === "incomplete";
        if (isSoftTerminal) {
          terminalStableCount = content === lastContent ? terminalStableCount + 1 : 0;
        } else {
          terminalStableCount = 0;
        }
        lastContent = content;
        const isFinished = isCompleted || isHardStopped || (isSoftTerminal && terminalStableCount >= 3);
        const streamActive = !!taskStreamsRef.current[localMessageId];
        const liveContent = streamGet(localMessageId) || realtimeGet(localMessageId)?.content || "";
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== localMessageId) return m;
            // SSE / task event stream 仍在追加时，polling 只能更新状态，不能用 DB 全文覆盖内容。
            // 否则 OpenAI completed 后 message.content 已是全文，但补尾 delta 还在路上，UI 会从半截直接跳全文。
            const nextContent = streamActive ? (liveContent || m.content) : (content || m.content);
            return {
              ...m,
              content: nextContent,
              serverMessageId,
              activityStatus: isFinished ? undefined : createBusyGeneratingStatus(),
              completedAt: isFinished ? Date.now() : undefined,
            };
          })
        );
        if (isFinished && !streamActive) {
          stopBackgroundPoller(localMessageId);
          stopTaskStream(localMessageId);
          const hasOtherTaskStream = Object.keys(taskStreamsRef.current).some((id) => id !== localMessageId);
          const hasOtherPoller = Object.keys(backgroundPollersRef.current).some((id) => id !== localMessageId);
          setIsLoading(hasOtherTaskStream || hasOtherPoller);
        } else if (status === "failed" || status === "cancelled" || status === "incomplete" || !hasContent) {
          // terminal 状态可能先于最终 message.content 可见；多轮确认稳定前继续轮询，避免刷新后才完整。
          setIsLoading(true);
        }
      } catch {}
    };

    poll();
    backgroundPollersRef.current[localMessageId] = window.setInterval(poll, 2000);
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

    let accumulated = initialContent || "";
    const lastThinkOpen = accumulated.lastIndexOf("<think>");
    const lastThinkClose = accumulated.lastIndexOf("</think>");
    let inReasoningBlock = lastThinkOpen !== -1 && lastThinkOpen > lastThinkClose;
    let buffer = "";
    let sawDone = false;
    let latestSequence = after || 0;

    const stringifyDelta = (value: unknown): string => {
      if (typeof value === "string") return value;
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      if (Array.isArray(value)) return value.map((item) => stringifyDelta(item)).filter(Boolean).join("");
      if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        return stringifyDelta(obj.text || obj.content || obj.summary || obj.delta || obj.value || "");
      }
      return "";
    };

    const processEvent = (eventText: string) => {
      const lines = eventText.split("\n");
      let data = "";
      for (const line of lines) {
        if (line.startsWith("id: ")) {
          latestSequence = Number(line.slice(4)) || latestSequence;
          activeTaskStreamsRef.current[localMessageId] = {
            ...(activeTaskStreamsRef.current[localMessageId] || {}),
            convId,
            serverMessageId,
            generationTaskId,
            lastSequence: latestSequence,
            content: accumulated,
          };
        }
        if (line.startsWith(":")) continue;
        if (line.startsWith("data: ")) data = line.slice(6);
      }
      if (!data) return;
      if (data === "[DONE]") {
        if (inReasoningBlock) {
          accumulated += "</think>";
          streamAppend(localMessageId, "</think>");
          inReasoningBlock = false;
        }
        delete activeTaskStreamsRef.current[localMessageId];
        sawDone = true;
        const hasContent = (accumulated || streamGet(localMessageId) || realtimeGet(localMessageId)?.content || "").trim().length > 0;
        // [DONE] 只代表 event stream 结束，不代表 message.content 已经是 DB 最终值。
        // OpenAI Responses 可能在 completed/final content 阶段补尾；交给 DB polling 校准最终内容。
        realtimeUpdate(localMessageId, {
          completedAt: undefined,
          activityStatus: createFinalizingStatus(hasContent),
        });
        if (hasContent && serverMessageId) {
          startBackgroundPolling(convId, localMessageId, serverMessageId);
        }
        return;
      }
      try {
        const parsed = JSON.parse(data);
        if (parsed._generation_task) {
          const task = parsed._generation_task;
          const parsedTaskId = Number(task.id || task.task_id || generationTaskId || 0) || undefined;
          const parsedServerMessageId = Number(task.assistant_message_id || serverMessageId || 0) || undefined;
          activeTaskStreamsRef.current[localMessageId] = {
            ...(activeTaskStreamsRef.current[localMessageId] || {}),
            convId,
            serverMessageId: parsedServerMessageId,
            generationTaskId: parsedTaskId,
            lastSequence: latestSequence,
            content: accumulated,
          };
          realtimeUpdate(localMessageId, {
            serverMessageId: parsedServerMessageId,
            generationTaskId: parsedTaskId,
            useBackground: task.use_background === true || task.background === true || task.is_complex_task === true,
            isComplexTask: task.is_complex_task === true,
            lastSequence: latestSequence,
            activityStatus: createGeneratingStatus(),
          });
          return;
        }
        if (parsed._error || parsed._error_meta) {
          const err = parsed._error || parsed._error_meta;
          const message = err.message || err.user_message || "请求失败";
          realtimeUpdate(localMessageId, {
            errorCode: err.error_code || err.code || "unknown",
            retryable: err.retryable === true || err.retriable === true,
            requestId: err.request_id || realtimeGet(localMessageId)?.requestId,
            activityStatus: undefined,
            searchStatus: undefined,
            searchSources: undefined,
          });
          if (!accumulated) accumulated = message;
          return;
        }
        if (parsed._activity_meta) {
          const meta = parsed._activity_meta;
          const searchStatus = meta.kind === "web_search" ? (meta.status === "running" ? "searching" : "completed") : undefined;
          realtimeUpdate(localMessageId, { activityStatus: createActivityStatusFromMeta(meta), searchStatus });
          return;
        }
        if (parsed._search_meta) {
          const meta = parsed._search_meta;
          realtimeUpdate(localMessageId, { searchStatus: meta.status, searchSources: meta.sources || [], searchSourcesCount: typeof meta.sources_count === "number" ? meta.sources_count : undefined, activityStatus: createWebSearchDoneStatus() });
          return;
        }
        const rawDelta = parsed.choices?.[0]?.delta || {};
        const contentDelta = stringifyDelta(rawDelta.content);
        const reasoningDelta = stringifyDelta(rawDelta.reasoning_content || rawDelta.reasoning);
        let delta = "";
        if (reasoningDelta) {
          if (!inReasoningBlock) {
            delta += "<think>";
            inReasoningBlock = true;
          }
          delta += reasoningDelta;
        }
        // OpenAI Responses can occasionally emit reasoning and visible text in the same delta.
        // Handle content independently instead of `else if`, otherwise the visible answer may
        // stay inside the open <think> block until a full page refresh reloads DB content.
        if (contentDelta) {
          if (inReasoningBlock) {
            delta += "</think>";
            inReasoningBlock = false;
          }
          realtimeUpdate(localMessageId, {
            activityStatus: createGeneratingStatus(),
          });
          delta += contentDelta;
        }
        if (delta) {
          accumulated += delta;
          activeTaskStreamsRef.current[localMessageId] = {
            ...(activeTaskStreamsRef.current[localMessageId] || {}),
            convId,
            serverMessageId,
            generationTaskId,
            lastSequence: latestSequence,
            content: accumulated,
          };
          streamAppend(localMessageId, delta);
        }
      } catch {
        accumulated += data;
        streamAppend(localMessageId, data);
      }
    };

    (async () => {
      try {
        const streamUrl = generationTaskId
          ? `${API_BASE_URL}/api/tasks/${generationTaskId}/stream?after=${after}`
          : `${API_BASE_URL}/api/chat/tasks/${serverMessageId}/events?after=${after}`;
        const res = await fetch(streamUrl, { headers, signal: controller.signal });
        if (!res.ok || !res.body) throw new Error("task stream unavailable");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx;
            const events: string[] = [];
            while ((idx = buffer.indexOf("\n\n")) >= 0) {
              events.push(buffer.slice(0, idx));
              buffer = buffer.slice(idx + 2);
            }
            for (const eventText of events) {
              processEvent(eventText);
            }
          }
          buffer += decoder.decode();
          if (buffer.trim()) processEvent(buffer.trim());
        } finally {
          reader.releaseLock();
        }
      } catch {
        if (!controller.signal.aborted) startBackgroundPolling(convId, localMessageId, serverMessageId);
      } finally {
        // 同步 streaming store 到 messages state
        const finalData = realtimeGet(localMessageId);
        if (finalData || accumulated) {
          setMessages((prev) => prev.map((m) => {
            if (m.id !== localMessageId) return m;
            const next = { ...m, content: finalData?.content || accumulated, lastSequence: Math.max(m.lastSequence || 0, latestSequence) };
            if (finalData) Object.assign(next, finalData);
            return next as Message;
          }));
        }
        realtimeClear(localMessageId);
        delete taskStreamsRef.current[localMessageId];
        // 无论是否被 abort，只要 serverMessageId 存在就兜底轮询，避免 task stream 异常中断后前端悬停
        if (serverMessageId) {
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
              activityStatus: createGeneratingStatus(),
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
                      ? createBusyGeneratingStatus()
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
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("无法读取流");

      let accumulated = "";
      let buffer = "";
      let inReasoningBlock = false;
      let backgroundPollingStarted = false;
      let latestServerMessageId: number | undefined;
      let latestGroupId: number | undefined = assistantMsg.groupId;
      let latestGroupIndex: number | undefined = assistantMsg.groupIndex;
      let latestGroupModels: string[] | undefined = assistantMsg.groupModels;
      let latestUserMessageId: number | undefined = assistantMsg.userMessageId;
      let groupContextNotified = false;
      let latestGenerationTaskId: number | undefined;
      let latestUseBackground = false;
      let sawDone = false;
      let recoverable = false;
      let latestSequence = 0;

      const currentGroupContext = (): CompareGroupContext | undefined =>
        latestGroupId || latestUserMessageId
          ? {
              groupId: latestGroupId,
              userMessageId: latestUserMessageId,
              groupModels: latestGroupModels || [],
            }
          : undefined;

      const notifyGroupContext = () => {
        const context = currentGroupContext();
        if (groupContextNotified || !context?.groupId || !context.userMessageId) return;
        groupContextNotified = true;
        onGroupContext?.(context);
      };

      const processEvent = (eventText: string) => {
        const lines = eventText.split("\n");
        let data = "";
        for (const line of lines) {
          if (line.startsWith("id: ")) latestSequence = Number(line.slice(4)) || latestSequence;
          if (line.startsWith(":")) continue; // SSE comment
          if (line.startsWith("data: ")) {
            data = line.slice(6);
          }
        }
        if (!data) return;
        if (data === "[DONE]") {
          if (inReasoningBlock) {
            accumulated += "</think>";
            streamAppend(assistantMsg.id, "</think>");
            inReasoningBlock = false;
          }
          sawDone = true;
          const hasContent = (accumulated || streamGet(assistantMsg.id) || realtimeGet(assistantMsg.id)?.content || "").trim().length > 0;
          realtimeUpdate(assistantMsg.id, hasContent
            ? { completedAt: Date.now(), activityStatus: undefined }
            : { completedAt: undefined, activityStatus: createBusyGeneratingStatus() }
          );
          return;
        }
        try {
          const parsed = JSON.parse(data);
          // 处理 chat meta（请求追踪 ID 等）
          if (parsed._chat_meta) {
            const meta = parsed._chat_meta;
            realtimeUpdate(assistantMsg.id, { requestId: meta.request_id || "" });
            return;
          }
          if (parsed._generation_task) {
            const task = parsed._generation_task;
            const serverMessageId = Number(task.assistant_message_id || 0) || undefined;
            const groupId = Number(task.group_id || 0) || undefined;
            const groupIndex = task.group_index === 0 || task.group_index ? Number(task.group_index) : undefined;
            const userMessageId = Number(task.user_message_id || 0) || undefined;
            const groupModels = Array.isArray(task.group_models) ? task.group_models.filter((m: unknown): m is string => typeof m === "string" && m.length > 0) : undefined;
            const generationTaskId = Number(task.id || task.task_id || 0) || undefined;
            latestUseBackground = task.use_background === true || task.background === true || task.is_complex_task === true;
            latestServerMessageId = serverMessageId;
            latestGroupId = groupId || latestGroupId;
            latestGroupIndex = groupIndex ?? latestGroupIndex;
            latestUserMessageId = userMessageId || latestUserMessageId;
            latestGroupModels = groupModels?.length ? groupModels : latestGroupModels;
            latestGenerationTaskId = generationTaskId;
            realtimeUpdate(assistantMsg.id, {
              serverMessageId,
              groupId: latestGroupId,
              groupIndex: latestGroupIndex,
              groupModels: latestGroupModels,
              userMessageId: latestUserMessageId,
              generationTaskId,
              useBackground: latestUseBackground,
              isComplexTask: task.is_complex_task === true,
              lastSequence: latestSequence,
              activityStatus: createGeneratingStatus(),
            });
            notifyGroupContext();
            if (generationTaskId) {
              backgroundPollingStarted = true;
            }
            return;
          }
          if (parsed._background_task) {
            const task = parsed._background_task;
            const serverMessageId = Number(task.assistant_message_id || 0) || undefined;
            const groupId = Number(task.group_id || 0) || undefined;
            const groupIndex = task.group_index === 0 || task.group_index ? Number(task.group_index) : undefined;
            const userMessageId = Number(task.user_message_id || 0) || undefined;
            const groupModels = Array.isArray(task.group_models) ? task.group_models.filter((m: unknown): m is string => typeof m === "string" && m.length > 0) : undefined;
            latestServerMessageId = serverMessageId;
            latestGroupId = groupId || latestGroupId;
            latestGroupIndex = groupIndex ?? latestGroupIndex;
            latestUserMessageId = userMessageId || latestUserMessageId;
            latestGroupModels = groupModels?.length ? groupModels : latestGroupModels;
            latestUseBackground = true;
            const taskId = task.id || "";
            realtimeUpdate(assistantMsg.id, {
              serverMessageId,
              groupId: latestGroupId,
              groupIndex: latestGroupIndex,
              groupModels: latestGroupModels,
              userMessageId: latestUserMessageId,
              backgroundTaskId: taskId,
              useBackground: true,
              isComplexTask: true,
              activityStatus: createBusyGeneratingStatus(),
            });
            notifyGroupContext();
            backgroundPollingStarted = true;
            return;
          }
          // 处理统一错误结构 / provider 错误元数据。错误不能继续当 delta 追加，否则 429 会重复刷屏卡死。
          if (parsed._error || parsed._error_meta) {
            const err = parsed._error || parsed._error_meta;
            const message = err.message || err.user_message || "请求失败";
            realtimeUpdate(assistantMsg.id, {
              content: accumulated || message,
              errorCode: err.error_code || err.code || "unknown",
              retryable: err.retryable === true || err.retriable === true,
              requestId: err.request_id || realtimeGet(assistantMsg.id)?.requestId,
              activityStatus: undefined,
              searchStatus: undefined,
              searchSources: undefined,
            });
            if (!accumulated) {
              accumulated = message;
            }
            return;
          }
          // 处理活动状态元数据（实时，不缓冲）
          if (parsed._activity_meta) {
            const meta = parsed._activity_meta;
            const patch: Partial<RealtimeData> = {
              activityStatus: createActivityStatusFromMeta(meta),
            };
            if (meta.kind === "web_search") {
              patch.searchStatus = meta.status;
            }
            realtimeUpdate(assistantMsg.id, patch);
            return;
          }
          // 处理搜索元数据（实时，不缓冲）
          if (parsed._search_meta) {
            const meta = parsed._search_meta;
            realtimeUpdate(assistantMsg.id, {
              searchStatus: meta.status,
              searchSources: meta.sources || [],
              searchSourcesCount: typeof meta.sources_count === "number" ? meta.sources_count : undefined,
              activityStatus: createWebSearchDoneStatus(),
            });
            return;
          }
          const rawDelta = parsed.choices?.[0]?.delta || {};
          const stringifyDelta = (value: unknown): string => {
            if (typeof value === "string") return value;
            if (typeof value === "number" || typeof value === "boolean") return String(value);
            if (Array.isArray(value)) {
              return value
                .map((item) => stringifyDelta(item))
                .filter(Boolean)
                .join("");
            }
            if (value && typeof value === "object") {
              const obj = value as Record<string, unknown>;
              return stringifyDelta(
                obj.text || obj.content || obj.summary || obj.delta || obj.value || ""
              );
            }
            return "";
          };
          const contentDelta = stringifyDelta(rawDelta.content);
          const reasoningDelta = stringifyDelta(rawDelta.reasoning_content || rawDelta.reasoning);
          let delta = "";
          if (reasoningDelta) {
            if (!inReasoningBlock) {
              delta += "<think>";
              inReasoningBlock = true;
            }
            delta += reasoningDelta;
          }
          // OpenAI Responses can occasionally emit reasoning and visible text in the same delta.
          // Handle content independently instead of `else if`, otherwise the visible answer may
          // stay inside the open <think> block until a full page refresh reloads DB content.
          if (contentDelta) {
            if (inReasoningBlock) {
              delta += "</think>";
              inReasoningBlock = false;
            }
            realtimeUpdate(assistantMsg.id, {
              activityStatus: createGeneratingStatus(),
            });
            delta += contentDelta;
          }
          if (delta) {
            accumulated += delta;
            streamAppend(assistantMsg.id, delta);
          }
        } catch {
          // JSON 解析失败时，当作文本免底追加
          accumulated += data;
          streamAppend(assistantMsg.id, data);
        }
      };

      const buildStreamRunResult = (contentOverride?: string): StreamRunResult => ({
        groupContext: currentGroupContext(),
        serverMessageId: latestServerMessageId,
        generationTaskId: latestGenerationTaskId,
        lastSequence: latestSequence,
        content: contentOverride ?? (streamGet(assistantMsg.id) || accumulated),
        useBackground: latestUseBackground,
        sawDone,
        recoverable,
      });

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // 按 \n\n 分割完整 SSE event
          let idx;
          while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const eventText = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            processEvent(eventText);
          }
        }

        // 最终 flush decoder
        buffer += decoder.decode();
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const eventText = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          processEvent(eventText);
        }
        if (buffer.trim()) {
          processEvent(buffer.trim());
        }
      } catch (err: any) {
        const isAbort = err?.name === "AbortError" || controller.signal.aborted;
        const abortReason = abortReasonRef.current;

        // 切换会话只断开当前页面这条 SSE，后端任务继续跑；这里不能重新接 task stream，
        // 否则旧会话的本地消息会被标成“重新执行/生成中”，并和新会话加载互相抢状态。
        if (isAbort && abortReason === "navigation") {
          return;
        }

        // 用户主动停止才真正停在当前 UI，不做后台续流。
        if (isAbort && abortReason === "user") {
          return;
        }

        // 非导航的异常断线：如果已经拿到服务端消息/任务 ID，再接后端 task event stream 续流。
        if (latestServerMessageId || latestGenerationTaskId) {
          recoverable = true;
          startTaskEventStream(convId || currentConversation, assistantMsg.id, latestServerMessageId, latestSequence, accumulated, latestGenerationTaskId);
          return;
        }
        throw err;
      } finally {
        const abortReason = abortReasonRef.current;
        reader.releaseLock();

        // 如果 reasoning 块未关闭，自动关闭
        if (inReasoningBlock) {
          accumulated += "</think>";
          streamAppend(assistantMsg.id, "</think>");
        }

        // 同步 streaming store 到 messages state
        const finalContent = streamGet(assistantMsg.id) || accumulated;
        const finalData = realtimeGet(assistantMsg.id);
        if (finalContent || finalData) {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantMsg.id) return m;
              const next = { ...m };
              if (finalContent) next.content = finalContent;
              if (finalData) {
                Object.assign(next, finalData);
              }
              return next;
            })
          );
        }

        // SSE 自然断开但没有收到 DONE：不能把空 assistant 标 completed。
        // 后端 task runner 仍可能在生成/落库，转为可恢复 task stream / polling。
        if (!sawDone && abortReason !== "navigation" && abortReason !== "user" && (latestServerMessageId || latestGenerationTaskId)) {
          recoverable = true;
          startTaskEventStream(convId || currentConversation, assistantMsg.id, latestServerMessageId, latestSequence, finalContent, latestGenerationTaskId);
          if (latestUseBackground && latestServerMessageId) {
            startBackgroundPolling(convId || currentConversation, assistantMsg.id, latestServerMessageId);
          }
          return buildStreamRunResult(finalContent);
        }

        const hasFinalContent = (finalContent || "").trim().length > 0;

        // OpenAI background/complex task 的 [DONE] 只代表当前 SSE/event stream 结束，
        // 不代表已展示内容就是 DB 最终内容。即使已有部分内容，也要继续通过
        // task stream / DB polling 校准，否则会出现“输出一半直接 DONE，刷新后变完整”。
        if (sawDone && abortReason !== "navigation" && abortReason !== "user" && (latestServerMessageId || latestGenerationTaskId)) {
          recoverable = true;
          // The initial /chat request is itself a task event stream. Its controller is
          // still registered until this finally block finishes, so an immediate
          // startTaskEventStream() would no-op and leave the UI stuck on partial text.
          // DB polling is the correct post-DONE reconciler here; explicit task
          // stream reattach is reserved for abnormal disconnects before DONE.
          if (latestServerMessageId) {
            startBackgroundPolling(convId || currentConversation, assistantMsg.id, latestServerMessageId);
          }
          return buildStreamRunResult(finalContent);
        }

        streamClear(assistantMsg.id);
        realtimeClear(assistantMsg.id);

        // 切会话/用户停止时不要在旧异步里把消息标 completed。
        // 切回该会话时由历史加载 + task event stream 恢复真实状态。
        if (sawDone && hasFinalContent && abortReason !== "navigation" && abortReason !== "user") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id ? { ...m, completedAt: Date.now(), activityStatus: undefined } : m
            )
          );
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

      const compareModelIds = modelIds.filter((id) => models.some((m) => m.id === id)).slice(0, 4);
      if (compareModelIds.length < 2) return;

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
      const userFiles =
        attachments
          ?.filter((a) => a.public_id)
          .map((a) => ({ public_id: a.public_id!, type: a.type || "file", filename: a.filename })) || [];
      const userMsg: Message = {
        id: uuidv4(),
        role: "user",
        content: finalContent,
        createdAt: Date.now(),
        files: userFiles,
      };
      const assistantMsgs: Message[] = compareModelIds.map((modelId) => ({
        id: uuidv4(),
        role: "assistant",
        content: "",
        model: modelId,
        createdAt: Date.now(),
        search: lastSearchRef.current,
        searchStatus: lastSearchRef.current ? "searching" : undefined,
      }));
      const contextMessages = [...messages, userMsg];

      setIsCompare(true);
      setCompareModels(compareModelIds);
      setMessages((prev) => [...prev, userMsg, ...assistantMsgs]);
      setIsLoading(true);

      const controllers = assistantMsgs.map(() => new AbortController());
      compareAbortControllersRef.current = controllers;
      abortControllerRef.current = null;
      abortReasonRef.current = null;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      } else {
        headers["X-Guest-ID"] = getGuestId();
      }

      let compareGroupContext: CompareGroupContext | undefined;
      let resolveGroupContextReady: (context: CompareGroupContext | undefined) => void = () => {};
      const groupContextReady = new Promise<CompareGroupContext | undefined>((resolve) => {
        resolveGroupContextReady = resolve;
      });
      let groupContextResolved = false;
      const setCompareGroupContext = (context?: CompareGroupContext) => {
        if (!context) return;
        compareGroupContext = {
          groupId: context.groupId || compareGroupContext?.groupId,
          userMessageId: context.userMessageId || compareGroupContext?.userMessageId,
          groupModels: context.groupModels.length > 0 ? context.groupModels : compareModelIds,
        };
        if (!groupContextResolved && compareGroupContext.groupId && compareGroupContext.userMessageId) {
          groupContextResolved = true;
          const resolvedContext = compareGroupContext;
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id === userMsg.id) {
                return { ...m, serverMessageId: resolvedContext.userMessageId };
              }
              if (assistantMsgs.some((assistant) => assistant.id === m.id)) {
                const groupIndex = assistantMsgs.findIndex((assistant) => assistant.id === m.id);
                return {
                  ...m,
                  groupId: resolvedContext.groupId,
                  userMessageId: resolvedContext.userMessageId,
                  groupModels: resolvedContext.groupModels,
                  groupIndex: groupIndex >= 0 ? groupIndex : m.groupIndex,
                };
              }
              return m;
            })
          );
          resolveGroupContextReady(resolvedContext);
        }
      };

      const handleCompareRunError = (assistantMsg: Message, error: any, streamResult?: StreamRunResult) => {
        const now = Date.now();
        const realtime = realtimeGet(assistantMsg.id);
        const serverMessageId = streamResult?.serverMessageId || realtime?.serverMessageId;
        const generationTaskId = streamResult?.generationTaskId || realtime?.generationTaskId;
        const hasRecoverableStream = !!serverMessageId || !!generationTaskId || !!taskStreamsRef.current[assistantMsg.id] || !!backgroundPollersRef.current[assistantMsg.id];
        const isBackgroundModel = !!assistantMsg.model && (assistantMsg.model === "gpt-5.5-pro" || assistantMsg.model.startsWith("gpt-5.5-pro-"));

        if (hasRecoverableStream || (isBackgroundModel && convId)) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? {
                    ...m,
                    serverMessageId: serverMessageId || m.serverMessageId,
                    generationTaskId: generationTaskId || m.generationTaskId,
                    activityStatus: createBusyGeneratingStatus(),
                    completedAt: undefined,
                  }
                : m
            )
          );
          if (serverMessageId) startBackgroundPolling(convId, assistantMsg.id, serverMessageId);
          return;
        }

        let displayMsg: string;
        if (error.errorCode === "file_not_ready") {
          displayMsg = `⏳ 文件解析中，请稍后再问`;
        } else if (error.errorCode === "guest_limit_exceeded") {
          displayMsg = `⚠️ ${error.message || "匿名用户每日额度已用完，请登录后继续"}`;
        } else {
          displayMsg = `❌ ${error.message || "请求失败"}`;
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: displayMsg, completedAt: now, activityStatus: undefined }
              : m
          )
        );
      };

      const runModel = async (assistantMsg: Message, index: number, groupContext?: CompareGroupContext) => {
        const controller = controllers[index];
        let streamResult: StreamRunResult | undefined;
        try {
          const requestGroupContext = groupContext || (index === 0 ? undefined : compareGroupContext);
          const response = await fetch(`${API_BASE_URL}/api/chat`, {
            method: "POST",
            headers,
            signal: controller.signal,
            body: JSON.stringify({
              model: assistantMsg.model,
              messages: toModelMessages(contextMessages),
              stream: true,
              conversation_id: convId,
              reasoning: reasoning.enabled,
              reasoning_effort: reasoning.effort || "high",
              search: search,
              template_id: templateId,
              template_prefix: templatePrefix,
              skip_save_user_msg: index > 0,
              group_id: requestGroupContext?.groupId,
              user_message_id: requestGroupContext?.userMessageId,
              group_index: index,
              group_models: requestGroupContext?.groupModels?.length ? requestGroupContext.groupModels : compareModelIds,
              skill_key: effectiveSkillKey || undefined,
              message_file_ids: file_ids || undefined,
            }),
          });
          if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            const errorCode = errorBody.error || "unknown";
            const errorMsg = errorBody.message || "请求失败";
            throw Object.assign(new Error(errorMsg), { errorCode });
          }
          streamResult = await streamResponse(response, assistantMsg, controller, convId, index === 0 ? setCompareGroupContext : undefined);
          if (index === 0) {
            setCompareGroupContext(streamResult?.groupContext);
          }
          // 对比模式里，streamResponse 可能已把异常断线/后台任务切到 task stream 或 DB polling。
          // 这不是失败，不要让外层状态把空内容渲染成“生成中断/重新生成”。
          if (streamResult?.recoverable) {
            const recoverableResult = streamResult;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? {
                      ...m,
                      serverMessageId: recoverableResult.serverMessageId || m.serverMessageId,
                      generationTaskId: recoverableResult.generationTaskId || m.generationTaskId,
                      activityStatus: createBusyGeneratingStatus(),
                      completedAt: undefined,
                    }
                  : m
              )
            );
          }
        } catch (error: any) {
          const now = Date.now();
          if (error.name === "AbortError") {
            if (index === 0 && !groupContextResolved) {
              groupContextResolved = true;
              resolveGroupContextReady(undefined);
            }
            if (abortReasonRef.current !== "user") return;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, stopped: true, completedAt: now, activityStatus: undefined }
                  : m
              )
            );
            return;
          }

          handleCompareRunError(assistantMsg, error, streamResult);
          if (index === 0 && !groupContextResolved) {
            groupContextResolved = true;
            resolveGroupContextReady(undefined);
          }
        }
      };

      try {
        const firstRun = runModel(assistantMsgs[0], 0);
        const context = await groupContextReady;
        if (!context?.groupId || !context.userMessageId) {
          await firstRun;
          return;
        }
        const restRuns = assistantMsgs.slice(1).map((assistantMsg, offset) => runModel(assistantMsg, offset + 1, context));
        await Promise.all([firstRun, ...restRuns]);
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
      if (!content.trim() && !isRegenerate && (!attachments || attachments.length === 0)) return;

      lastReasoningRef.current = reasoning;
      lastSearchRef.current = search;

      const token = localStorage.getItem("token");

      // 确定当前对话 ID（登录状态下）
      let convId = currentConversation;
      if (token && !convId && !isRegenerate) {
        // 自动创建新对话，标题用前 20 个字
        const title = content.trim().slice(0, 20) + (content.trim().length > 20 ? "..." : "");
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

      let contextMessages: Message[];
      let assistantMsg: Message;

      if (isRegenerate) {
        // 重新生成：找到最后一条 user 消息，删掉后面的 assistant
        const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
        if (!lastUserMsg) return;
        const lastUserIndex = messages.findIndex((m) => m.id === lastUserMsg.id);
        contextMessages = messages.slice(0, lastUserIndex + 1);

        assistantMsg = {
          id: uuidv4(),
          role: "assistant",
          content: "",
          model: selectedModel.id,
          createdAt: Date.now(),
          search: lastSearchRef.current,
          searchStatus: lastSearchRef.current ? "searching" : undefined,
        };

        // 更新 messages：保留到 lastUser 的消息，去掉后面的 assistant，添加新的 assistant
        setMessages((prev) => {
          const trimmed = prev.filter((m, i) => i <= lastUserIndex || m.role !== "assistant");
          return [...trimmed, assistantMsg];
        });
      } else if (skipUserMsg) {
        // 对比模式中后续模型：不添加用户消息，只添加 assistant
        let finalContent = content.trim();
        const userFiles = attachments?.filter(a => a.public_id).map(a => ({ public_id: a.public_id!, type: a.type, filename: a.filename })) || [];
        assistantMsg = {
          id: uuidv4(),
          role: "assistant",
          content: "",
          model: selectedModel.id,
          createdAt: Date.now(),
          search: lastSearchRef.current,
          searchStatus: lastSearchRef.current ? "searching" : undefined,
        };
        contextMessages = [...messages, { role: "user" as const, content: finalContent, id: "", createdAt: 0, files: userFiles }];
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        let finalContent = content.trim();
        const userFiles = attachments?.filter(a => a.public_id).map(a => ({ public_id: a.public_id!, type: a.type, filename: a.filename })) || [];
        const userMsg: Message = {
          id: uuidv4(),
          role: "user",
          content: finalContent,
          createdAt: Date.now(),
          files: userFiles,
        };

        assistantMsg = {
          id: uuidv4(),
          role: "assistant",
          content: "",
          model: selectedModel.id,
          createdAt: Date.now(),
          search: lastSearchRef.current,
          searchStatus: lastSearchRef.current ? "searching" : undefined,
        };

        contextMessages = [...messages, userMsg];
        setMessages((prev) => [...prev, userMsg, assistantMsg]);
      }

      setIsLoading(true);
      const controller = new AbortController();
      abortReasonRef.current = null;
      abortControllerRef.current = controller;

      try {
        const token = localStorage.getItem("token");
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        } else {
          headers["X-Guest-ID"] = getGuestId();
        }
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            model: selectedModel.id,
            messages: toModelMessages(contextMessages),
            stream: true,
            conversation_id: convId,
            reasoning: reasoning.enabled,
            reasoning_effort: reasoning.effort || "high",
            search: search,
            template_id: templateId,
            skip_save_user_msg: skipUserMsg,
            skill_key: effectiveSkillKey || undefined,
            message_file_ids: file_ids || undefined,
          }),
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}));
          const errorCode = errorBody.error || "unknown";
          const errorMsg = errorBody.message || "请求失败";
          throw Object.assign(new Error(errorMsg), { errorCode });
        }

        await streamResponse(response, assistantMsg, controller, convId);
      } catch (error: any) {
        if (error.name === "AbortError") {
          // 只有点击“停止生成”才显示中断；切换会话/页面导致的 Abort 不污染消息状态。
          if (abortReasonRef.current === "user") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, stopped: true, activityStatus: undefined }
                  : m
              )
            );
          }
        } else {
          const isBackgroundModel = selectedModel.id === "gpt-5.5-pro" || selectedModel.id.startsWith("gpt-5.5-pro-");
          if (isBackgroundModel && convId) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, activityStatus: createBusyGeneratingStatus() }
                  : m
              )
            );
          } else {
            let displayMsg: string;
            if (error.errorCode === "file_not_ready") {
              displayMsg = `⏳ 文件解析中，请稍后再问`;
            } else if (error.errorCode === "guest_limit_exceeded") {
              displayMsg = `⚠️ 匿名用户每日次数用完，请登录后继续`;
            } else {
              displayMsg = `❌ ${error.message || "请求失败"}`;
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, content: displayMsg, activityStatus: undefined }
                  : m
              )
            );
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

    const runningTasks = messages
      .filter((m) => m.role === "assistant" && !m.completedAt && m.generationTaskId)
      .map((m) => m.generationTaskId as number);

    Array.from(new Set(runningTasks)).forEach((taskId) => {
      fetch(`${API_BASE_URL}/api/tasks/${taskId}/cancel`, {
        method: "POST",
        headers,
      }).catch(() => undefined);
    });

    Object.values(taskStreamsRef.current).forEach((controller) => controller.abort());
    taskStreamsRef.current = {};

    if (abortControllerRef.current) {
      abortReasonRef.current = "user";
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (compareAbortControllersRef.current.length > 0) {
      abortReasonRef.current = "user";
      compareAbortControllersRef.current.forEach((controller) => controller.abort());
      compareAbortControllersRef.current = [];
    }
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
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      } else {
        headers["X-Guest-ID"] = getGuestId();
      }
      const res = await fetch(`${API_BASE_URL}/api/chat/${messageId}/fork`, {
        method: "POST",
        headers,
        body: JSON.stringify({ models: modelIds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Fork 对比失败");
      }
      const data = await res.json();

      // 进入对比模式
      setIsCompare(true);
      const forkedModels = data.models || modelIds;
      setCompareModels(forkedModels);

      // 刷新消息列表（新 fork 的 assistant 消息已被后端创建，可立即展示占位）
      const convId = data.conversation_id || currentConversation;
      if (convId && token) {
        try {
          const refreshRes = await fetch(`${API_BASE_URL}/api/conversations/${convId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            if (refreshData.messages) {
              const loadedMessages: Message[] = refreshData.messages.map((m: any) => ({
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
                groupModels: Array.isArray(m.group_models) ? m.group_models : undefined,
              }));
              setMessages(loadedMessages);
              setLoadedPersistedMessages(loadedMessages.length);
              const newGroupViews = new Map<number, number>();
              loadedMessages.forEach((m) => {
                if (m.groupId !== undefined && !newGroupViews.has(m.groupId)) {
                  newGroupViews.set(m.groupId, 0);
                }
              });
              setGroupViews(newGroupViews);
            }
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

