import { useCallback } from "react";
import {
  buildCreateConversationBody,
  buildCreatedConversationUrl,
  resolveCreatedConversationTitle,
  runCreateConversationRequest,
  shouldCreateConversation,
} from "@/lib/chatConversationCreateCoordinator";

export type UseChatConversationCreateRuntimeOptions = {
  apiBaseUrl: string;
  setCreatedConversation: (conversationId: number, title: string) => void;
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
  getToken = () => localStorage.getItem("token"),
  getWorkspaceId = () => localStorage.getItem("current-workspace"),
  getCurrentHref = () => window.location.href,
  replaceHistory = (url) => window.history.replaceState({}, "", url),
  dispatchWindowEvent = (event) => window.dispatchEvent(event),
}: UseChatConversationCreateRuntimeOptions) {
  const createConversation: CreateConversationAction = useCallback(
    async (title: string, model: string, sk?: string): Promise<number | undefined> => {
      const token = getToken();
      if (!shouldCreateConversation({ token })) return undefined;

      try {
        const body = buildCreateConversationBody({
          title,
          model,
          skillKey: sk,
          workspaceId: getWorkspaceId(),
        });
        const data = await runCreateConversationRequest({
          apiBaseUrl,
          token: token as string,
          body,
        });
        if (!data) return undefined;

        setCreatedConversation(data.id, resolveCreatedConversationTitle(data, title));
        replaceHistory(buildCreatedConversationUrl({
          currentHref: getCurrentHref(),
          conversationId: data.id,
          skillKey: sk,
        }));
        dispatchWindowEvent(new CustomEvent("conversation-created", { detail: data }));
        return data.id;
      } catch (err) {
        console.error("createConversation error:", err);
        return undefined;
      }
    },
    [apiBaseUrl, getCurrentHref, getToken, getWorkspaceId, replaceHistory, dispatchWindowEvent, setCreatedConversation]
  );

  return { createConversation };
}
