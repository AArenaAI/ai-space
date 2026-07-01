import type { ChatBootstrapPayload } from "@/lib/chatBootstrapCoordinator";

const BOOTSTRAP_SCRIPT_ID = "__AI_SPACE_BOOTSTRAP__";

export function readInjectedChatBootstrap(): ChatBootstrapPayload | undefined {
  if (typeof document === "undefined") return undefined;
  const element = document.getElementById(BOOTSTRAP_SCRIPT_ID);
  const text = element?.textContent?.trim();
  if (!text) return undefined;
  try {
    const payload = JSON.parse(text) as ChatBootstrapPayload;
    if (!payload || typeof payload !== "object") return undefined;
    return payload;
  } catch {
    return undefined;
  }
}

export function clearInjectedChatBootstrap() {
  if (typeof document === "undefined") return;
  document.getElementById(BOOTSTRAP_SCRIPT_ID)?.remove();
}
