"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChatBootstrapMediaTask, ChatBootstrapPayload } from "@/lib/chatBootstrapCoordinator";
import { fetchChatBootstrap } from "@/lib/chatBootstrapCoordinator";
import { registerBackgroundTask } from "@/lib/taskNotifications";
import type { ChatModel } from "@/lib/chatTypes";
import { useAppBootstrap } from "@/lib/appBootstrapContext";
import { getConversationSnapshot } from "@/lib/chatConversationCache";

type ChatBootstrapStatus = "idle" | "loading" | "ready" | "anonymous" | "failed";

export type ChatBootstrapRuntimeState = {
  status: ChatBootstrapStatus;
  payload?: ChatBootstrapPayload;
  models: ChatModel[];
  error?: Error;
};

function registerBootstrapMediaTask(type: "image" | "video", task: ChatBootstrapMediaTask) {
  const isChatTask = task.kind === "chat" && task.chat_id && task.message_id;
  const key = isChatTask ? `${type}-chat:${task.message_id}` : `${type}:${task.id}`;
  registerBackgroundTask({
    key,
    type,
    id: isChatTask ? task.message_id! : task.id,
    title: type === "image" ? "图片生成中" : "视频生成中",
    description: task.prompt || task.conversation_title || task.model || undefined,
    href: task.href || (type === "image" ? "/image" : "/video"),
    conversationId: task.chat_id,
    serverMessageId: task.message_id,
    conversationTitle: task.conversation_title,
  });
}

function registerBootstrapActiveMediaTasks(payload: ChatBootstrapPayload) {
  (payload.active_tasks?.image || []).forEach((task) => registerBootstrapMediaTask("image", task));
  (payload.active_tasks?.video || []).forEach((task) => registerBootstrapMediaTask("video", task));
}

function applyBootstrapClientSideEffects(payload: ChatBootstrapPayload, setChatBootstrap: (payload?: ChatBootstrapPayload) => void) {
  registerBootstrapActiveMediaTasks(payload);
  if (payload.user) {
    localStorage.setItem("user", JSON.stringify(payload.user));
  }
  if (payload.token) {
    localStorage.setItem("token", payload.token);
  }
  if (payload.workspace?.current_id) {
    localStorage.setItem("current-workspace", String(payload.workspace.current_id));
  }
  if (payload.models?.length) {
    localStorage.setItem("cached-chat-models", JSON.stringify(payload.models));
  }
  if (payload.sidebar || payload.user || payload.workspace) {
    setChatBootstrap(payload);
    window.dispatchEvent(new CustomEvent("chat-bootstrap-ready", { detail: payload }));
  }
}

export function useChatBootstrapRuntime({
  conversationId,
  enabled = true,
}: {
  conversationId?: number;
  enabled?: boolean;
}): ChatBootstrapRuntimeState {
  const [state, setState] = useState<ChatBootstrapRuntimeState>({ status: "idle", models: [] });
  const { chatBootstrap, setChatBootstrap } = useAppBootstrap();

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const injectedConversationId = chatBootstrap?.conversation?.id || chatBootstrap?.requested_conversation_id;
    const injectedMatches = chatBootstrap && (!conversationId || injectedConversationId === conversationId);
    if (injectedMatches) {
      const statusCode = chatBootstrap.http_status || 200;
      applyBootstrapClientSideEffects(chatBootstrap, setChatBootstrap);
      if (chatBootstrap.auth_status !== "authenticated" || statusCode === 401) {
        setState({ status: "anonymous", payload: chatBootstrap, models: chatBootstrap.models || [] });
        return;
      }
      if (statusCode >= 400) {
        const error = new Error(`chat bootstrap failed: ${statusCode}`) as Error & { status?: number };
        error.status = statusCode;
        setState({ status: "failed", payload: chatBootstrap, models: chatBootstrap.models || [], error });
        return;
      }
      setState({ status: "ready", payload: chatBootstrap, models: chatBootstrap.models || [] });
      return;
    }
    const controller = new AbortController();
    const storedToken = localStorage.getItem("token");
    const token = storedToken && storedToken !== "null" && storedToken !== "undefined" ? storedToken : "";

    setState((current) => ({ ...current, status: "loading", error: undefined }));
    const workspaceId = Number(localStorage.getItem("current-workspace") || 0) || undefined;
    fetchChatBootstrap({ conversationId, workspaceId, token, signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return;
        if (payload.auth_status !== "authenticated") {
          setState({ status: "anonymous", payload, models: payload.models || [] });
          return;
        }
        applyBootstrapClientSideEffects(payload, setChatBootstrap);
        setState({ status: "ready", payload, models: payload.models || [] });
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === "AbortError") return;
        const err = error instanceof Error ? error : new Error(String(error));
        // If we have a local conversation snapshot, keep ChatInterface mounted so
        // the restore runtime can display cached/streaming content while backend
        // bootstrap recovers from transient failures such as 429.
        if (conversationId && getConversationSnapshot(conversationId)) {
          setState((current) => ({
            ...current,
            status: "ready",
            payload: current.payload,
            models: current.models,
            error: err,
          }));
          return;
        }
        setState({ status: "failed", models: [], error: err });
      });

    return () => controller.abort();
  }, [conversationId, enabled, chatBootstrap, setChatBootstrap]);

  return useMemo(() => state, [state]);
}
