import { useCallback } from "react";
import {
  buildCreateConversationBody,
  buildCreatedConversationUrl,
  resolveCreatedConversationTitle,
  runCreateConversationRequest,
  shouldCreateConversation,
} from "@/lib/chatConversationCreateCoordinator";
import { readAuthState } from "@/lib/auth/state";
import { chatRuntimeStore } from "@/lib/chatRuntime";

export type UseChatConversationCreateRuntimeOptions = {
  apiBaseUrl: string;
  setCreatedConversation: (conversationId: number, title: string) => void;
  notebookId?: number;
  getToken?: () => string | null;
  getWorkspaceId?: () => string | null;
  getCurrentHref?: () => string;
  replaceHistory?: (url: string) => void;
  dispatchWindowEvent?: (event: Event) => void;
};

export type CreateConversationAction = (
  title: string,
  model: string,
  sk?: string
) => Promise<number | undefined>;

export function useChatConversationCreateRuntime({
  apiBaseUrl,
  setCreatedConversation,
  notebookId,
  getToken = () => readAuthState().token,
  getWorkspaceId = () => localStorage.getItem("current-workspace"),
  getCurrentHref = () => window.location.href,
  replaceHistory = (url) => window.history.replaceState({}, "", url),
  dispatchWindowEvent = (event) => window.dispatchEvent(event),
}: UseChatConversationCreateRuntimeOptions) {
  const createConversation: CreateConversationAction = useCallback(
    async (title: string, model: string, sk?: string): Promise<number | undefined> => {
      const token = getToken();
      if (!shouldCreateConversation({ token })) return undefined;

      const clientTempId = `chat-create-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tempConversationId = -Date.now();
      const optimisticUpdatedAt = new Date().toISOString();
      try {
        const body = buildCreateConversationBody({
          title,
          model,
          skillKey: sk,
          workspaceId: getWorkspaceId(),
        });
        if (!notebookId) {
          chatRuntimeStore.patchConversation(tempConversationId, {
            messages: [],
            pendingOptimisticMessages: [],
            compareModels: [],
            updatedAt: Date.parse(optimisticUpdatedAt),
          });
          chatRuntimeStore.setActiveConversation(tempConversationId);
          dispatchWindowEvent(new CustomEvent("conversation-updated", {
            detail: {
              id: tempConversationId,
              client_temp_id: clientTempId,
              title,
              model,
              skill_key: sk,
              source: "local-create",
              updated_at: optimisticUpdatedAt,
            },
          }));
        }
        const data = await runCreateConversationRequest({
          apiBaseUrl,
          token,
          body,
        });
        if (!data) {
          if (!notebookId) {
            chatRuntimeStore.deleteConversation(tempConversationId);
            dispatchWindowEvent(new CustomEvent("conversation-deleted", { detail: { id: tempConversationId } }));
          }
          return undefined;
        }

        setCreatedConversation(data.id, resolveCreatedConversationTitle(data, title));
        if (!notebookId) {
          chatRuntimeStore.deleteConversation(tempConversationId);
          chatRuntimeStore.patchConversation(data.id, {
            messages: [],
            compareModels: [],
            updatedAt: Date.parse(data.updated_at || optimisticUpdatedAt),
          });
          chatRuntimeStore.setActiveConversation(data.id);
        }
        replaceHistory(buildCreatedConversationUrl({
          currentHref: getCurrentHref(),
          conversationId: data.id,
          skillKey: sk,
        }));
        if (!notebookId) {
          dispatchWindowEvent(new CustomEvent("conversation-created", { detail: { ...data, client_temp_id: clientTempId, replaceClientTempId: clientTempId } }));
        }
        return data.id;
      } catch (err) {
        console.error("createConversation error:", err);
        if (!notebookId) {
          chatRuntimeStore.deleteConversation(tempConversationId);
          dispatchWindowEvent(new CustomEvent("conversation-deleted", { detail: { id: tempConversationId } }));
        }
        return undefined;
      }
    },
    [apiBaseUrl, getCurrentHref, getToken, getWorkspaceId, replaceHistory, dispatchWindowEvent, setCreatedConversation, notebookId]
  );

  return { createConversation };
}
