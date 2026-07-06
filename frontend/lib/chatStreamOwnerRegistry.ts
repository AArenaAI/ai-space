export type ChatStreamOwner = {
  conversationId: number;
  taskId?: number | string;
  serverMessageId?: number | string;
  streamId: string;
  sequence?: number;
  [key: string]: unknown;
};

export type ChatStreamOwnerAbortReason = "replaced" | "navigation" | "stop" | "cleanup" | string;

type AbortOwner = (owner: ChatStreamOwner, reason: ChatStreamOwnerAbortReason) => void;

function ownerKey(owner: ChatStreamOwner) {
  if (owner.taskId !== undefined) return `task:${owner.conversationId}:${owner.taskId}`;
  if (owner.serverMessageId !== undefined) return `message:${owner.conversationId}:${owner.serverMessageId}`;
  return `stream:${owner.conversationId}:${owner.streamId}`;
}

function isSameOwner(a?: ChatStreamOwner, b?: ChatStreamOwner) {
  return Boolean(a && b && a.conversationId === b.conversationId && a.streamId === b.streamId);
}

export function createStreamOwnerRegistry(options: { abortOwner?: AbortOwner } = {}) {
  const owners = new Map<string, ChatStreamOwner>();

  const removeMatching = (owner: ChatStreamOwner) => {
    for (const [key, current] of Array.from(owners.entries())) {
      if (isSameOwner(current, owner)) owners.delete(key);
    }
  };

  return {
    register(owner: ChatStreamOwner) {
      const key = ownerKey(owner);
      const previous = owners.get(key);
      if (previous && !isSameOwner(previous, owner)) {
        options.abortOwner?.(previous, "replaced");
      }
      owners.set(key, { ...owner });
      return key;
    },
    canFinalize(owner: ChatStreamOwner) {
      return isSameOwner(owners.get(ownerKey(owner)), owner);
    },
    finalize(owner: ChatStreamOwner) {
      if (!this.canFinalize(owner)) return false;
      owners.delete(ownerKey(owner));
      return true;
    },
    abortConversation(conversationId: number, reason: ChatStreamOwnerAbortReason = "navigation") {
      for (const [key, owner] of Array.from(owners.entries())) {
        if (owner.conversationId !== conversationId) continue;
        owners.delete(key);
        options.abortOwner?.(owner, reason);
      }
    },
    getOwner(owner: ChatStreamOwner) {
      const current = owners.get(ownerKey(owner));
      return current ? { ...current } : undefined;
    },
    size() {
      return owners.size;
    },
    clear(reason: ChatStreamOwnerAbortReason = "cleanup") {
      for (const [key, owner] of Array.from(owners.entries())) {
        owners.delete(key);
        options.abortOwner?.(owner, reason);
      }
    },
  };
}
