import { useCallback, useEffect, useRef, useState } from "react";

type UseSmartAutoScrollOptions = {
  threshold?: number;
  enabled?: boolean;
};

export function useSmartAutoScroll({
  threshold = 120,
  enabled = true,
}: UseSmartAutoScrollOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const checkIsAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distanceToBottom <= threshold;
  }, [threshold]);

  // 监听滚动：总是根据当前位置更新状态，不忽略任何 scroll 事件
  const handleScroll = useCallback(() => {
    const atBottom = checkIsAtBottom();
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
    setShowScrollButton(!atBottom);
  }, [checkIsAtBottom]);

  // 强制滚到底部
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = containerRef.current;
    const bottom = bottomRef.current;
    if (!container || !bottom) return;

    isAtBottomRef.current = true;
    setIsAtBottom(true);
    setShowScrollButton(false);

    if (behavior === "smooth") {
      bottom.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      container.scrollTop = container.scrollHeight - container.clientHeight;
    }
  }, []);

  // 流式输出跟随：只有当用户本来就在底部时才滚动
  const followIfAtBottom = useCallback(() => {
    if (!isAtBottomRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight - container.clientHeight;
  }, []);

  // 初始化 + 外部依赖变化时主动检查一次
  useEffect(() => {
    if (!enabled) return;
    const atBottom = checkIsAtBottom();
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
    setShowScrollButton(!atBottom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return {
    containerRef,
    bottomRef,
    isAtBottom,
    showScrollButton,
    handleScroll,
    scrollToBottom,
    followIfAtBottom,
  };
}
