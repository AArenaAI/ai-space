"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { getGuestId } from "@/lib/guestId";

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
    id: "gemini-2.0-flash-exp",
    name: "Gemini 2.0 Flash",
    provider: "Google",
    description: "超快响应速度",
    color: "#4285f4",
  },
  {
    id: "deepseek-chat",
    name: "DeepSeek Chat",
    provider: "DeepSeek",
    description: "DeepSeek 官方通用对话模型",
    color: "#4d6bfa",
  },
  {
    id: "deepseek-reasoner",
    name: "DeepSeek-R1",
    provider: "DeepSeek",
    description: "DeepSeek 官方深度推理模型",
    color: "#8b5cf6",
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
  const conversationLoadSeqRef = useRef(0);
  const lastReasoningRef = useRef<{ enabled: boolean; effort?: string }>({ enabled: false, effort: "high" });
  const lastSearchRef = useRef<boolean>(false);
  const [initialized, setInitialized] = useState(false);
  const [isCompare, setIsCompare] = useState(false);
  const [compareModels, setCompareModels] = useState<string[]>([]);
  // 从对话历史或 prop 恢复的有效 skillKey（优先级：历史 > prop）
  const [effectiveSkillKey, setEffectiveSkillKey] = useState<string | undefined>(skillKey);

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
  useEffect(() => {
    const loadSeq = ++conversationLoadSeqRef.current;
    const loadController = new AbortController();
    const isLatestLoad = () => conversationLoadSeqRef.current === loadSeq;

    // 切换历史对话时立即停止还在跑的 SSE，避免旧流继续改当前消息列表
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (!conversationId) {
      setMessages([]);
      setIsLoadingHistory(false);
      setCurrentConversation(undefined);
      setIsCompare(false);
      setCompareModels([]);
      setEffectiveSkillKey(skillKey);
      return () => loadController.abort();
    }

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
      .then((data) => {
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
          }));
          // 如果后端没有返回 completedAt，用下一条消息的 createdAt 近似
          for (let i = 0; i < loadedMessages.length - 1; i++) {
            if (!loadedMessages[i].completedAt) {
              loadedMessages[i].completedAt = loadedMessages[i + 1].createdAt;
            }
          }
          setMessages(loadedMessages);
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
  }, [conversationId, models, setSelectedModel, skillKey]);

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

        if (!res.ok) return undefined;
        const data = await res.json();
        setCurrentConversation(data.id);
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
      } catch {
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
      controller: AbortController
    ): Promise<void> => {
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("无法读取流");

      let accumulated = "";
      let pendingDelta = "";
      let buffer = "";
      let inReasoningBlock = false;
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      const flush = () => {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        const text = pendingDelta;
        pendingDelta = "";
        if (!text) return;
        accumulated += text;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: accumulated } : m
          )
        );
      };

      const processEvent = (eventText: string) => {
        const lines = eventText.split("\n");
        let data = "";
        for (const line of lines) {
          if (line.startsWith(":")) continue; // SSE comment
          if (line.startsWith("data: ")) {
            data = line.slice(6);
          }
        }
        if (!data) return;
        if (data === "[DONE]") {
          if (inReasoningBlock) {
            pendingDelta += "</think>";
            inReasoningBlock = false;
          }
          flush();
          return;
        }
        try {
          const parsed = JSON.parse(data);
          // 处理 chat meta（请求追踪 ID 等）
          if (parsed._chat_meta) {
            const meta = parsed._chat_meta;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, requestId: meta.request_id || "" }
                  : m
              )
            );
            return;
          }
          // 处理统一错误结构
          if (parsed._error) {
            const err = parsed._error;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? {
                      ...m,
                      content: err.message || "请求失败",
                      errorCode: err.error_code || "unknown",
                      retryable: err.retryable === true,
                      requestId: err.request_id || m.requestId,
                    }
                  : m
              )
            );
            return;
          }
          // 处理活动状态元数据（实时，不缓冲）
          if (parsed._activity_meta) {
            const meta = parsed._activity_meta;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? {
                      ...m,
                      activityStatus: {
                        kind: meta.kind || "generating",
                        status: meta.status || "running",
                        label: meta.label || "正在生成内容",
                      },
                      searchStatus: meta.kind === "web_search" ? meta.status : m.searchStatus,
                    }
                  : m
              )
            );
            return;
          }
          // 处理搜索元数据（实时，不缓冲）
          if (parsed._search_meta) {
            const meta = parsed._search_meta;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? {
                      ...m,
                      searchStatus: meta.status,
                      searchSources: meta.sources || [],
                      activityStatus: { kind: "web_search", status: "completed", label: "网页搜索完成" },
                    }
                  : m
              )
            );
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
          pendingDelta += delta;
          if (delta) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, activityStatus: { kind: "generating", status: "running", label: "正在生成内容" } }
                  : m
              )
            );
          }

          if (!flushTimer) {
            flushTimer = setTimeout(() => {
              flushTimer = null;
              flush();
            }, 50);
          }
        } catch {
          // JSON 解析失败时，当作文本兑底追加
          pendingDelta += data;
          if (!flushTimer) {
            flushTimer = setTimeout(() => {
              flushTimer = null;
              flush();
            }, 50);
          }
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
      } finally {
        flush(); // 流结束时强制 flush 剩余内容
        reader.releaseLock();
        // 记录完成时间
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id ? { ...m, completedAt: Date.now() } : m
          )
        );
      }
    },
    []
  );

  // 对比模式：依次向多个模型发送同一条消息，流式展示
  const sendCompareMessages = useCallback(
    async (
      content: string,
      modelIds: string[],
      reasoning: { enabled: boolean; effort?: string } = { enabled: false },
      search: boolean = false,
      templateId: number = 0,
      attachments?: { filename: string; content: string }[],
      file_ids?: string[]
    ) => {
      if (!content.trim() && (!attachments || attachments.length === 0)) return;

      lastReasoningRef.current = reasoning;
      lastSearchRef.current = search;

      const token = localStorage.getItem("token");

      // 确定当前对话 ID
      let convId = currentConversation;
      if (token && !convId) {
        const title = content.trim().slice(0, 20) + (content.trim().length > 20 ? "..." : "");
        convId = await createConversation(title, modelIds[0]);
        // 如果创建了新对话，需要更新 currentConversation
      }

      // 第一个模型：带用户消息
      // 后续模型：跳过用户消息
      let finalContent = content.trim();

      for (let i = 0; i < modelIds.length; i++) {
        const modelId = modelIds[i];
        const model = models.find((m) => m.id === modelId);
        if (!model) continue;

        const skipUser = i > 0;

        let contextMessages: Message[];
        let assistantMsg: Message;

        if (skipUser) {
          // 后续模型：不添加用户消息
          assistantMsg = {
            id: uuidv4(),
            role: "assistant",
            content: "",
            model: modelId,
            createdAt: Date.now(),
            search: lastSearchRef.current,
            searchStatus: lastSearchRef.current ? "searching" : undefined,
          };
          contextMessages = [...messages, { role: "user" as const, content: finalContent, id: "", createdAt: 0 }];
          setMessages((prev) => [...prev, assistantMsg]);
        } else {
          // 第一个模型：添加用户消息 + 第一条 assistant
          const userMsg: Message = {
            id: uuidv4(),
            role: "user",
            content: finalContent,
            createdAt: Date.now(),
          };
          assistantMsg = {
            id: uuidv4(),
            role: "assistant",
            content: "",
            model: modelId,
            createdAt: Date.now(),
            search: lastSearchRef.current,
            searchStatus: lastSearchRef.current ? "searching" : undefined,
          };
          contextMessages = [...messages, userMsg];
          setMessages((prev) => [...prev, userMsg, assistantMsg]);
        }

        setIsLoading(true);
        const controller = new AbortController();
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
              model: modelId,
              messages: contextMessages.map((m) => ({ role: m.role, content: m.content })),
              stream: true,
              conversation_id: convId,
              reasoning: reasoning.enabled,
              reasoning_effort: reasoning.effort || "high",
              search: search,
              template_id: templateId,
              skip_save_user_msg: skipUser,
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
          await streamResponse(response, assistantMsg, controller);
        } catch (error: any) {
          const now = Date.now();
          if (error.name === "AbortError") {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMsg.id ? { ...m, stopped: true, completedAt: now } : m))
            );
          } else {
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
                m.id === assistantMsg.id ? { ...m, content: displayMsg, completedAt: now } : m
              )
            );
          }
        }
      }

      setIsLoading(false);
      abortControllerRef.current = null;
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

        await streamResponse(response, assistantMsg, controller);
      } catch (error: any) {
        if (error.name === "AbortError") {
          // 用户主动停止
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, stopped: true }
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
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
        // 通知侧边栏刷新对话列表（updated_at 可能已变化）
        window.dispatchEvent(new CustomEvent("conversation-updated"));
      }
    },
    [messages, selectedModel, currentConversation, createConversation, streamResponse, effectiveSkillKey]
  );

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

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
    compareModels,
    sendCompareMessages,
  };
}
