import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Message } from "@/lib/chatTypes";
import {
  buildClearMessagesState,
  buildRegenerateRequest,
  deleteMessageById,
  switchGroupView,
} from "@/lib/chatLocalActionCoordinator";

export type SendRegenerateMessage = (
  content: string,
  reasoning: { enabled: boolean; effort?: string },
  isRegenerate: boolean,
  search: boolean
) => Promise<void>;

export function createClearMessagesAction(input: {
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setCurrentConversation: Dispatch<SetStateAction<number | undefined>>;
}) {
  return () => {
    const clearState = buildClearMessagesState();
    input.setMessages(clearState.messages as Message[]);
    input.setCurrentConversation(clearState.currentConversation);
  };
}

export function createDeleteMessageAction(input: {
  setMessages: Dispatch<SetStateAction<Message[]>>;
}) {
  return (messageId: string) => {
    input.setMessages((prev) => deleteMessageById(prev, messageId));
  };
}

export function createRegenerateMessageAction(input: {
  getMessages: () => Message[];
  getReasoning: () => { enabled: boolean; effort?: string };
  getSearch: () => boolean;
  sendMessage: SendRegenerateMessage;
}) {
  return async () => {
    const request = buildRegenerateRequest(input.getMessages());
    if (request) {
      await input.sendMessage(request.content, input.getReasoning(), request.shouldRegenerate, input.getSearch());
    }
  };
}

export function createSwitchGroupModelAction(input: {
  setGroupViews: Dispatch<SetStateAction<Map<number, number>>>;
}) {
  return (groupId: number, activeIndex: number) => {
    input.setGroupViews((prev) => switchGroupView(prev, groupId, activeIndex));
  };
}

export function useChatLocalActions(input: {
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setCurrentConversation: Dispatch<SetStateAction<number | undefined>>;
  setGroupViews: Dispatch<SetStateAction<Map<number, number>>>;
  getReasoning: () => { enabled: boolean; effort?: string };
  getSearch: () => boolean;
  sendMessage: SendRegenerateMessage;
}) {
  const clearMessages = useCallback(
    createClearMessagesAction({
      setMessages: input.setMessages,
      setCurrentConversation: input.setCurrentConversation,
    }),
    [input.setMessages, input.setCurrentConversation]
  );

  const deleteMessage = useCallback(
    createDeleteMessageAction({
      setMessages: input.setMessages,
    }),
    [input.setMessages]
  );

  const regenerateMessage = useCallback(
    createRegenerateMessageAction({
      getMessages: () => input.messages,
      getReasoning: input.getReasoning,
      getSearch: input.getSearch,
      sendMessage: input.sendMessage,
    }),
    [input.messages, input.getReasoning, input.getSearch, input.sendMessage]
  );

  const switchGroupModel = useCallback(
    createSwitchGroupModelAction({
      setGroupViews: input.setGroupViews,
    }),
    [input.setGroupViews]
  );

  return {
    clearMessages,
    deleteMessage,
    regenerateMessage,
    switchGroupModel,
  };
}
