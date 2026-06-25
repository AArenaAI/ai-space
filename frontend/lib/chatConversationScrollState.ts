export type ChatConversationScrollState = {
  conversationId: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  distanceToBottom: number;
  atBottom: boolean;
  updatedAt: number;
};

const scrollStates = new Map<number, ChatConversationScrollState>();
const MAX_STATES = 80;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const STORAGE_PREFIX = "ai-space-chat-scroll:";

function storageKey(conversationId: number) {
  return `${STORAGE_PREFIX}${conversationId}`;
}

function readStoredState(conversationId: number): ChatConversationScrollState | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(storageKey(conversationId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.conversationId !== conversationId) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function writeStoredState(state: ChatConversationScrollState) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(state.conversationId), JSON.stringify(state));
  } catch {
    // ignore storage quota / private mode
  }
}

function removeStoredState(conversationId: number) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey(conversationId));
  } catch {
    // ignore
  }
}

function pruneScrollStates() {
  const cutoff = Date.now() - MAX_AGE_MS;
  Array.from(scrollStates.entries()).forEach(([id, state]) => {
    if (state.updatedAt < cutoff) scrollStates.delete(id);
  });
  while (scrollStates.size > MAX_STATES) {
    const first = scrollStates.keys().next().value;
    if (typeof first !== "number") break;
    scrollStates.delete(first);
  }
}

export function saveConversationScrollState(state: ChatConversationScrollState) {
  if (!Number.isFinite(state.conversationId) || state.conversationId <= 0) return;
  const next = { ...state, updatedAt: Date.now() };
  scrollStates.delete(state.conversationId);
  scrollStates.set(state.conversationId, next);
  writeStoredState(next);
  pruneScrollStates();
}

export function getConversationScrollState(conversationId?: number): ChatConversationScrollState | undefined {
  if (!conversationId) return undefined;
  const state = scrollStates.get(conversationId) || readStoredState(conversationId);
  if (!state || Date.now() - state.updatedAt > MAX_AGE_MS) {
    scrollStates.delete(conversationId);
    removeStoredState(conversationId);
    return undefined;
  }
  scrollStates.set(conversationId, state);
  return state;
}

export function clearConversationScrollState(conversationId?: number) {
  if (!conversationId) return;
  scrollStates.delete(conversationId);
  removeStoredState(conversationId);
}
