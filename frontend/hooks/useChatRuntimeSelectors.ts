"use client";

import { useSyncExternalStore } from "react";
import type { Message } from "@/lib/chatTypes";
import { chatRuntimeStore } from "@/lib/chatRuntime";
import type { ConversationRuntimeSlice } from "@/lib/chatRuntimeStore";

const EMPTY_MESSAGES = Object.freeze([]) as unknown as Partial<Message>[];
const EMPTY_COMPARE_MODELS = Object.freeze([]) as unknown as string[];

const EMPTY_RUNTIME_SLICE: ConversationRuntimeSlice = Object.freeze({
  conversationId: -1,
  messages: EMPTY_MESSAGES,
  generationTasks: Object.freeze({}) as Record<string, unknown>,
  activeStreams: Object.freeze({}) as Record<string, unknown>,
  pendingOptimisticMessages: EMPTY_MESSAGES,
  compareModels: EMPTY_COMPARE_MODELS,
});
const EMPTY_SLICE_BY_CONVERSATION = new Map<number, ConversationRuntimeSlice>();

function getEmptyConversationSlice(conversationId: number): ConversationRuntimeSlice {
  const existing = EMPTY_SLICE_BY_CONVERSATION.get(conversationId);
  if (existing) return existing;
  const created = Object.freeze({ ...EMPTY_RUNTIME_SLICE, conversationId });
  EMPTY_SLICE_BY_CONVERSATION.set(conversationId, created);
  return created;
}

function getConversationSlice(conversationId: number | undefined): ConversationRuntimeSlice {
  if (conversationId === undefined) return EMPTY_RUNTIME_SLICE;
  return chatRuntimeStore.getSnapshot().conversations.get(conversationId) || getEmptyConversationSlice(conversationId);
}

export function useConversationRuntimeSlice(conversationId: number | undefined): ConversationRuntimeSlice {
  return useSyncExternalStore(
    chatRuntimeStore.subscribe,
    () => getConversationSlice(conversationId),
    () => getConversationSlice(conversationId)
  );
}

export function useConversationRuntimeMessages(conversationId: number | undefined): Message[] {
  return useConversationRuntimeSlice(conversationId).messages as Message[];
}

export function useConversationRuntimeCompareModels(conversationId: number | undefined): string[] {
  return useConversationRuntimeSlice(conversationId).compareModels;
}
