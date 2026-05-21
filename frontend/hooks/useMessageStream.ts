import { useCallback, useSyncExternalStore } from "react";
import { streamSubscribe, streamGet } from "@/lib/streaming";

/**
 * AMC-WebUI 风格的流式消息订阅 hook。
 * 用 useSyncExternalStore 订阅外部 streaming store，React 会智能合并高频变更，
 * 避免组件因高频 delta 而 60fps 重渲染。
 */
export function useMessageStream(messageId: string, isStreaming: boolean): string {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!isStreaming || !messageId) {
        return () => {};
      }
      return streamSubscribe(messageId, () => listener());
    },
    [isStreaming, messageId]
  );

  // getSnapshot 不受 isStreaming 影响，始终返回 store 中的值。
  // 这样流结束瞬间不会从累积文本突然跳变为空字符串。
  const getSnapshot = useCallback(() => {
    if (!messageId) return "";
    return streamGet(messageId) || "";
  }, [messageId]);

  return useSyncExternalStore(subscribe, getSnapshot, () => "");
}
