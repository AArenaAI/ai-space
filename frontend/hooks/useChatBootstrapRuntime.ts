"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChatBootstrapPayload } from "@/lib/chatBootstrapCoordinator";
import { fetchChatBootstrap } from "@/lib/chatBootstrapCoordinator";
import type { ChatModel } from "@/lib/chatTypes";
import { useAppBootstrap } from "@/lib/appBootstrapContext";

type ChatBootstrapStatus = "idle" | "loading" | "ready" | "anonymous" | "failed";

export type ChatBootstrapRuntimeState = {
  status: ChatBootstrapStatus;
  payload?: ChatBootstrapPayload;
  models: ChatModel[];
  error?: Error;
};

export function useChatBootstrapRuntime({
  conversationId,
  enabled = true,
}: {
  conversationId?: number;
  enabled?: boolean;
}): ChatBootstrapRuntimeState {
  const [state, setState] = useState<ChatBootstrapRuntimeState>({ status: "idle", models: [] });
  const { setChatBootstrap } = useAppBootstrap();

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
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
        setState({ status: "ready", payload, models: payload.models || [] });
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === "AbortError") return;
        setState({ status: "failed", models: [], error: error instanceof Error ? error : new Error(String(error)) });
      });

    return () => controller.abort();
  }, [conversationId, enabled, setChatBootstrap]);

  return useMemo(() => state, [state]);
}
