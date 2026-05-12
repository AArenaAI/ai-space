"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";

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
  stopped?: boolean;
  search?: boolean;
  searchSources?: SearchSource[];
  searchStatus?: "searching" | "completed";
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
    id: "deepseek-v4-pro",
    name: "DeepSeek-V4 Pro",
    provider: "DeepSeek",
    description: "V4 Pro 增强版，最强推理能力",
    color: "#4d6bfa",
  },
  {
    id: "deepseek-reasoner",
    name: "DeepSeek-R1",
    provider: "DeepSeek",
    description: "深度思考模型，展示完整推理过程",
    color: "#8b5cf6",
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

export function useChat(conversationId: number | undefined, models: ChatModel[]) {
  const defaultModel = models.length > 0 ? models[0] : ({} as ChatModel);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModelState] = useState<ChatModel>(defaultModel);
  const [currentConversation, setCurrentConversation] = useState<number | undefined>(conversationId);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastReasoningRef = useRef<{ enabled: boolean; effort?: string }>({ enabled: false, effort: "high" });
  const lastSearchRef = useRef<boolean>(false);
  const [initialized, setInitialized] = useState(false);
  const [isCompare, setIsCompare] = useState(false);
  const [compareModels, setCompareModels] = useState<string[]>([]);

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
    if (!conversationId) {
      setMessages([]);
      setCurrentConversation(undefined);
      return;
    }

    const token = localStorage.getItem("token");
    if (!token) return;

    setCurrentConversation(conversationId);

    // 加载对话消息
    fetch(`${API_BASE_URL}/api/conversations/${conversationId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.messages) {
          const loadedMessages: Message[] = data.messages.map((m: any) => ({
            id: String(m.id || uuidv4()),
            role: m.role,
            content: m.content,
            model: m.model,
            createdAt: new Date(m.created_at).getTime(),
          }));
          setMessages(loadedMessages);
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
              if (Array.isArray(parsed)) setCompareModels(parsed);
            } catch {}
          }
        }
      })
      .catch(() => {
        setMessages([]);
      });
  }, [conversationId]);

  // 创建新对话
  const createConversation = useCallback(
    async (title: string, model: string): Promise<number | undefined> => {
      const token = localStorage.getItem("token");
      if (!token) return undefined;

      try {
        const res = await fetch(`${API_BASE_URL}/api/conversations`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ title, model }),
        });

        if (!res.ok) return undefined;
        const data = await res.json();
        setCurrentConversation(data.id);
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
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") break;
              try {
                const parsed = JSON.parse(data);
                // 处理搜索元数据
                if (parsed._search_meta) {
                  const meta = parsed._search_meta;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsg.id
                        ? {
                            ...m,
                            searchStatus: meta.status,
                            searchSources: meta.sources || [],
                          }
                        : m
                    )
                  );
                  continue;
                }
                const delta = parsed.choices?.[0]?.delta?.content || "";
                accumulated += delta;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsg.id
                      ? { ...m, content: accumulated }
                      : m
                  )
                );
              } catch {
                // 忽略解析失败的行
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
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
      templateId: number = 0
    ) => {
      if (!content.trim() || modelIds.length < 2) return;

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
          contextMessages = [...messages, { role: "user" as const, content: content.trim(), id: "", createdAt: 0 }];
          setMessages((prev) => [...prev, assistantMsg]);
        } else {
          // 第一个模型：添加用户消息 + 第一条 assistant
          const userMsg: Message = {
            id: uuidv4(),
            role: "user",
            content: content.trim(),
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
          const response = await fetch(`${API_BASE_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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
            }),
          });
          if (!response.ok) throw new Error("请求失败");
          await streamResponse(response, assistantMsg, controller);
        } catch (error: any) {
          if (error.name === "AbortError") {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMsg.id ? { ...m, stopped: true } : m))
            );
          } else {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id ? { ...m, content: `❌ 发送消息失败: ${error.message}` } : m
              )
            );
          }
        }
      }

      setIsLoading(false);
      abortControllerRef.current = null;
    },
    [messages, models, currentConversation, createConversation, streamResponse]
  );

  const sendMessage = useCallback(
    async (
      content: string,
      reasoning: { enabled: boolean; effort?: string } = { enabled: false },
      isRegenerate: boolean = false,
      search: boolean = false,
      templateId: number = 0,
      skipUserMsg: boolean = false
    ) => {
      if (!content.trim() && !isRegenerate) return;

      lastReasoningRef.current = reasoning;
      lastSearchRef.current = search;

      const token = localStorage.getItem("token");

      // 确定当前对话 ID（登录状态下）
      let convId = currentConversation;
      if (token && !convId && !isRegenerate) {
        // 自动创建新对话，标题用前 20 个字
        const title = content.trim().slice(0, 20) + (content.trim().length > 20 ? "..." : "");
        convId = await createConversation(title, selectedModel.id);
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
        assistantMsg = {
          id: uuidv4(),
          role: "assistant",
          content: "",
          model: selectedModel.id,
          createdAt: Date.now(),
          search: lastSearchRef.current,
          searchStatus: lastSearchRef.current ? "searching" : undefined,
        };
        contextMessages = [...messages, { role: "user", content: content.trim(), id: "", createdAt: 0 } as Message];
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        const userMsg: Message = {
          id: uuidv4(),
          role: "user",
          content: content.trim(),
          createdAt: Date.now(),
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
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
          }),
        });

        if (!response.ok) throw new Error("请求失败");

        await streamResponse(response, assistantMsg, controller);

        // 流式响应完成后，重新加载消息以同步后端持久化的 uint ID
        if (token && convId) {
          try {
            const reloadRes = await fetch(`${API_BASE_URL}/api/conversations/${convId}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (reloadRes.ok) {
              const convData = await reloadRes.json();
              if (convData.messages) {
                const reloaded: Message[] = convData.messages.map((m: any) => ({
                  id: String(m.id),
                  role: m.role,
                  content: m.content,
                  model: m.model,
                  createdAt: new Date(m.created_at).getTime(),
                  stopped: false,
                }));
                setMessages(reloaded);
              }
            }
          } catch {
            // 静默失败，不影响用户体验
          }
        }
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
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, content: `❌ 发送消息失败: ${error.message}` }
                : m
            )
          );
        }
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [messages, selectedModel, currentConversation, createConversation, streamResponse]
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
    selectedModel,
    setSelectedModel,
    sendMessage,
    stopGeneration,
    clearMessages,
    deleteMessage,
    regenerateMessage,
    currentConversation,
    isCompare,
    compareModels,
    sendCompareMessages,
  };
}
