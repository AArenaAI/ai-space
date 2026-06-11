export type ChatRenderProfileWindow = Window & {
  __AI_SPACE_CHAT_PROFILE_ENABLED?: boolean;
};

export function isChatRenderProfileEnabled() {
  return typeof window !== "undefined" && Boolean((window as ChatRenderProfileWindow).__AI_SPACE_CHAT_PROFILE_ENABLED);
}

export function emitChatRenderProfileEvent(phase: string, detail: Record<string, unknown> = {}) {
  if (!isChatRenderProfileEnabled()) return;
  const at = typeof performance !== "undefined" ? performance.now() : Date.now();
  window.dispatchEvent(new CustomEvent("chat-render-profile", {
    detail: {
      phase,
      at,
      ...detail,
    },
  }));
}
