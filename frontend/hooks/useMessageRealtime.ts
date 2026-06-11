import { useCallback, useSyncExternalStore } from "react";
import { realtimeGet, realtimeSubscribe, type RealtimeData } from "@/lib/streaming";

/**
 * 订阅消息的实时状态（包括 content、activityStatus、searchStatus 等元数据）。
 * 流式阶段只写外部 store，消息组件通过此 hook 订阅自己的数据变化，
 * 避免整个 MessageList 因 setMessages 而重渲染。
 */
export function useMessageRealtime(messageId: string, enabled = true): RealtimeData | undefined {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!enabled || !messageId) return () => {};
      return realtimeSubscribe(messageId, listener);
    },
    [enabled, messageId]
  );

  const getSnapshot = useCallback(() => {
    if (!enabled || !messageId) return undefined;
    return realtimeGet(messageId);
  }, [enabled, messageId]);

  return useSyncExternalStore(subscribe, getSnapshot, () => undefined);
}
