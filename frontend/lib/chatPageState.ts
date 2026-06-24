export type ChatPageState =
  | "authenticating"
  | "anonymous"
  | "new-chat"
  | "conversation-loading"
  | "conversation-ready"
  | "conversation-not-found"
  | "conversation-forbidden"
  | "conversation-error"
  | "conversation-revalidating";

export type ChatBootstrapLikeState = {
  status: "idle" | "loading" | "ready" | "anonymous" | "failed";
  error?: Error & { status?: number };
};

export function deriveChatPageState({
  conversationId,
  bootstrap,
}: {
  conversationId?: number;
  bootstrap: ChatBootstrapLikeState;
}): ChatPageState {
  if (!conversationId) return "new-chat";
  if (bootstrap.status === "ready") return "conversation-ready";
  if (bootstrap.status === "anonymous") return "anonymous";
  if (bootstrap.status === "failed") {
    if (bootstrap.error?.status === 404) return "conversation-not-found";
    if (bootstrap.error?.status === 403) return "conversation-forbidden";
    return "conversation-error";
  }
  return "conversation-loading";
}

export function shouldShowConversationShell(pageState: ChatPageState): boolean {
  return pageState === "conversation-loading" || pageState === "conversation-revalidating";
}
