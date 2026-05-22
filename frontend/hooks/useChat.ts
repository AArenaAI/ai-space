"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { getGuestId } from "@/lib/guestId";
import { streamAppend, streamGet, streamClear, realtimeUpdate, realtimeGet, realtimeClear , RealtimeData } from "@/lib/streaming";

const API_BASE_URL = ""; // 使用相对路径，nginx 同域名代理 /api -> 后端

export interface SearchSource {
  title: string;
  url: string;
  description: string;
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
  searchStatus?: "searching" | "completed";
  activityStatus?: { kind: "generating" | "web_search" | "file_search" | "tool_call"; status: "running" | "searching" | "completed"; label: string };
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
}

export interface ChatModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  color: string;
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
    id: "claude-3-5-sonnet-20241022",
    name: "Claude 3.5 Sonnet",
    provider: "Anthropic",
    description: "代码和逻辑推理专家",
    color: "#cc785c",
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
    id: "moonshot-v1-8k",
    name: "Kimi k1.5",
    provider: "Moonshot",
    description: "超长上下文，文档处理专家",
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

    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/conversations/${convId}/messages/${serverMessageId}`, {
          headers,
        });
        if (!res.ok) return;
        const data = await res.json();
        const content = data?.message?.content || "";
        const status = data?.background_task?.status || "";
        const isTerminal = status === "completed" || status === "failed" || status === "cancelled" || status === "incomplete";
        const hasContent = content.trim().length > 0;
        const isFinished = (status === "completed" && hasContent) || status === "failed" || status === "cancelled" || status === "incomplete";
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== localMessageId) return m;
            return {
              ...m,
              content: content || m.content,
              serverMessageId,
              activityStatus: isFinished ? undefined : { kind: "generating", status: "running", label: "任务繁忙，正在生成中" },
              completedAt: isFinished ? Date.now() : undefined,
            };
          })
        );
        if (isFinished) {
          stopBackgroundPoller(localMessageId);
          stopTaskStream(localMessageId);
          setIsLoading(false);
        } else if (isTerminal && !hasContent) {
          // 防止后端 task 状态先完成、message.content 延迟可见时，前端把空消息误判为“生成中断”。
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
    let inReasoningBlock = false;
    let buffer = "";
    let sawDone = false;
    let doneHasContent = false;
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
        doneHasContent = hasContent;
        realtimeUpdate(localMessageId, hasContent
          ? { completedAt: Date.now(), activityStatus: undefined }
          : { completedAt: undefined, activityStatus: { kind: "generating", status: "running", label: "任务繁忙，正在生成中" } }
        );
        if (hasContent) setIsLoading(false);
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
            activityStatus: { kind: "generating", status: "running", label: "正在生成内容" },
          });
          return;
        }
        if (parsed._error || parsed._error_meta) {
          const err = parsed._error || parsed._error_meta;
          const message = err.message || err.user_message || "请求失败";
          realtimeUpdate(localMessageId, { errorCode: err.error_code || err.code || "unknown", retryable: err.retryable === true || err.retriable === true, requestId: err.request_id || realtimeGet(localMessageId)?.requestId });
          if (!accumulated) accumulated = message;
          return;
        }
        if (parsed._activity_meta) {
          const meta = parsed._activity_meta;
          const searchStatus = meta.kind === "web_search" ? (meta.status === "running" ? "searching" : "completed") : undefined;
          realtimeUpdate(localMessageId, { activityStatus: { kind: meta.kind || "generating", status: meta.status || "running", label: meta.label || "正在生成内容" }, searchStatus });
          return;
        }
        if (parsed._search_meta) {
          const meta = parsed._search_meta;
          realtimeUpdate(localMessageId, { searchStatus: meta.status, searchSources: meta.sources || [], activityStatus: { kind: "web_search", status: "completed", label: "网页搜索完成" } });
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
        } else if (contentDelta) {
          if (inReasoningBlock) {
            delta += "</think>";
            inReasoningBlock = false;
          }
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
        if (!controller.signal.aborted && serverMessageId && (!sawDone || !doneHasContent)) {
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
      if (shouldResetRef.current) {
        setMessages([]);
        setCurrentConversation(undefined);
      }
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

    // 加载对话消息：必须可取消 + 只允许最新一次切换落盘，避免快速点击历史时旧请求覆盖新会话导致白屏/卡顿
    fetch(`${API_BASE_URL}/api/conversations/${conversationId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: loadController.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`load conversation failed: ${res.status}`);
        return res.json();
      })
      .then(async (data) => {
        if (!isLatestLoad() || loadController.signal.aborted) return;
        if (data.messages) {
          const loadedMessages: Message[] = data.messages.map((m: any) => ({
            id: String(m.id || uuidv4()),
            role: m.role,
            content: m.content,
            model: m.model,
            createdAt: new Date(m.created_at).getTime(),
            completedAt: m.completed_at ? new Date(m.completed_at).getTime() : undefined,
            files: m.files || undefined,
            serverMessageId: Number(m.id || 0) || undefined,
            groupId: m.group_id || undefined,
            groupIndex: m.group_index ?? undefined,
          }));
          // 如果最后一条 assistant 仍在生成，不能用"下一条消息时间"近似完成时间；
          // 会话详情接口本身不带生成状态，必须查 /messages/:id 的 background_task.status。
          const lastAssistant = [...loadedMessages].reverse().find((m) => m.role === "assistant" && m.serverMessageId);
          let shouldResumePolling = false;
          if (lastAssistant?.serverMessageId) {
            try {
              const statusRes = await fetch(`${API_BASE_URL}/api/conversations/${conversationId}/messages/${lastAssistant.serverMessageId}`, {
                headers: { Authorization: `Bearer ${token}` },
                signal: loadController.signal,
              });
              if (statusRes.ok) {
                const statusData = await statusRes.json();
                const bgTask = statusData?.background_task || {};
                const hasTask = !!bgTask.id || !!bgTask.task_id || !!bgTask.status;
                const status = bgTask.status || "";
                const terminalStatus = status === "completed" || status === "failed" || status === "cancelled" || status === "incomplete";
                const serverContent = statusData?.message?.content || "";
                const hasContent = serverContent.trim().length > 0;
                if (serverContent) {
                  lastAssistant.content = serverContent;
                }
                // GPT 后台任务经常先返回 terminal task，再稍后才能读到 message.content。
                // 空内容时必须继续恢复轮询/事件流，不能把 assistant 标 completed，否则 UI 会显示“生成中断”。
                shouldResumePolling = hasTask && (!terminalStatus || !hasContent);
                if (hasTask && terminalStatus && hasContent && !lastAssistant.completedAt) {
                  lastAssistant.completedAt = bgTask.completed_at
                    ? new Date(bgTask.completed_at).getTime()
                    : Date.now();
                }
                lastAssistant.generationTaskId = Number(bgTask.id || bgTask.task_id || 0) || undefined;
                lastAssistant.lastSequence = Number(bgTask.last_sequence_number || 0) || 0;
                if (shouldResumePolling) {
                  lastAssistant.completedAt = undefined;
                  lastAssistant.activityStatus = { kind: "generating", status: "running", label: "任务繁忙，正在生成中" };
                }
              } else {
                shouldResumePolling = false;
              }
            } catch (err: any) {
              if (loadController.signal.aborted || err?.name === "AbortError") return;
              shouldResumePolling = false;
            }
          }
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
              activityStatus: { kind: "generating" as const, status: "running" as const, label: "正在生成内容" },
            };
          });
          setMessages(mergedMessages);
          // 从历史恢复 groupViews，默认每组显示第 0 个模型
          const newGroupViews = new Map<number, number>();
          mergedMessages.forEach((m) => {
            if (m.groupId !== undefined && !newGroupViews.has(m.groupId)) {
              newGroupViews.set(m.groupId, 0);
            }
          });
          setGroupViews(newGroupViews);
          if (shouldResumePolling && lastAssistant?.serverMessageId) {
            const active = activeByServerMessageId.get(String(lastAssistant.serverMessageId));
            if (!active) {
              setIsLoading(true);
              startTaskEventStream(conversationId, lastAssistant.id, lastAssistant.serverMessageId, lastAssistant.lastSequence || 0, lastAssistant.content || "", lastAssistant.generationTaskId);
            } else {
              setIsLoading(true);
            }
          } else {
            setIsLoading(false);
          }
        } else {
          setMessages([]);
        }
        setIsLoadingHistory(false);

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
      convId?: number
    ): Promise<void> => {
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("无法读取流");

      let accumulated = "";
      let buffer = "";
      let inReasoningBlock = false;
      let backgroundPollingStarted = false;
      let latestServerMessageId: number | undefined;
      let latestGenerationTaskId: number | undefined;
      let latestUseBackground = false;
      let sawDone = false;
      let latestSequence = 0;

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
            : { completedAt: undefined, activityStatus: { kind: "generating", status: "running", label: "任务繁忙，正在生成中" } }
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
            const generationTaskId = Number(task.id || task.task_id || 0) || undefined;
            latestUseBackground = task.use_background === true || task.background === true || task.is_complex_task === true;
            latestServerMessageId = serverMessageId;
            latestGenerationTaskId = generationTaskId;
            realtimeUpdate(assistantMsg.id, {
              serverMessageId,
              generationTaskId,
              useBackground: latestUseBackground,
              isComplexTask: task.is_complex_task === true,
              lastSequence: latestSequence,
              activityStatus: { kind: "generating", status: "running", label: "正在生成内容" },
            });
            if (generationTaskId) {
              backgroundPollingStarted = true;
            }
            return;
          }
          if (parsed._background_task) {
            const task = parsed._background_task;
            const serverMessageId = Number(task.assistant_message_id || 0) || undefined;
            latestServerMessageId = serverMessageId;
            latestUseBackground = true;
            const taskId = task.id || "";
            const placeholder = "任务繁忙，正在生成中";
            accumulated = placeholder;
            streamAppend(assistantMsg.id, placeholder);
            realtimeUpdate(assistantMsg.id, {
              serverMessageId,
              backgroundTaskId: taskId,
              useBackground: true,
              isComplexTask: true,
              activityStatus: { kind: "generating", status: "running", label: placeholder },
            });
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
              activityStatus: {
                kind: meta.kind || "generating",
                status: meta.status || "running",
                label: meta.label || "正在生成内容",
              },
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
              activityStatus: { kind: "web_search", status: "completed", label: "网页搜索完成" },
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
          } else if (contentDelta) {
            if (inReasoningBlock) {
              delta += "</think>";
              inReasoningBlock = false;
            }
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
          startTaskEventStream(convId || currentConversation, assistantMsg.id, latestServerMessageId, latestSequence, accumulated, latestGenerationTaskId);
          return;
        }
        throw err;
      } finally {
        const abortReason = abortReasonRef.current;
        reader.releaseLock();

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
          startTaskEventStream(convId || currentConversation, assistantMsg.id, latestServerMessageId, latestSequence, finalContent, latestGenerationTaskId);
          if (latestUseBackground && latestServerMessageId) {
            startBackgroundPolling(convId || currentConversation, assistantMsg.id, latestServerMessageId);
          }
          return;
        }

        const hasFinalContent = (finalContent || "").trim().length > 0;

        // OpenAI background/complex task 会先返回 _generation_task，然后主 /api/chat 很快 [DONE]，
        // 真正内容仍由后端 task runner 继续生成并落库。此时不能把空 assistant 标 completed，
        // 否则 MessageList 会因 completedAt + 空内容显示“生成中断”。主流已结束后再接 task stream，
        // 不会和 /api/chat 双通道同时写同一条消息。
        if (sawDone && !hasFinalContent && abortReason !== "navigation" && abortReason !== "user" && (latestServerMessageId || latestGenerationTaskId)) {
          startTaskEventStream(convId || currentConversation, assistantMsg.id, latestServerMessageId, latestSequence, finalContent, latestGenerationTaskId);
          if (latestUseBackground && latestServerMessageId) {
            startBackgroundPolling(convId || currentConversation, assistantMsg.id, latestServerMessageId);
          }
          return;
        }

        streamClear(assistantMsg.id);
        realtimeClear(assistantMsg.id);

        // 切会话/用户停止时不要在旧异步里把消息标 completed。
        // 切回该会话时由历史加载 + task event stream 恢复真实状态。
        if (sawDone && hasFinalContent && abortReason !== "navigation" && abortReason !== "user") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id ? { ...m, completedAt: Date.now() } : m
            )
          );
        }
      }
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
      file_ids?: string[]
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

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      } else {
        headers["X-Guest-ID"] = getGuestId();
      }

      const runModel = async (assistantMsg: Message, index: number) => {
        const controller = controllers[index];
        try {
          const response = await fetch(`${API_BASE_URL}/api/chat`, {
            method: "POST",
            headers,
            signal: controller.signal,
            body: JSON.stringify({
              model: assistantMsg.model,
              messages: contextMessages.map((m) => ({ role: m.role, content: m.content })),
              stream: true,
              conversation_id: convId,
              reasoning: reasoning.enabled,
              reasoning_effort: reasoning.effort || "high",
              search: search,
              template_id: templateId,
              skip_save_user_msg: index > 0,
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
          const now = Date.now();
          if (error.name === "AbortError") {
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
        }
      };

      try {
        await Promise.all(assistantMsgs.map((assistantMsg, index) => runModel(assistantMsg, index)));
      } finally {
        setIsLoading(false);
        compareAbortControllersRef.current = [];
        if (convId) {
          window.dispatchEvent(new CustomEvent("conversation-updated", {
            detail: { id: convId, updated_at: new Date().toISOString() },
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
      file_ids?: string[]
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
            messages: contextMessages.map((m) => ({ role: m.role, content: m.content })),
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
                  ? { ...m, stopped: true }
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
                  ? { ...m, content: m.content || "任务繁忙，正在生成中", activityStatus: { kind: "generating", status: "running", label: "任务繁忙，正在生成中" } }
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
                  ? { ...m, content: displayMsg }
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
                files: m.files || undefined,
                serverMessageId: Number(m.id || 0) || undefined,
                groupId: m.group_id || undefined,
                groupIndex: m.group_index ?? undefined,
              }));
              setMessages(loadedMessages);
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
  };
}

