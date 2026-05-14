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
  const isAutoScrollingRef = useRef(false);

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const checkIsAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distanceToBottom <= threshold;
  }, [threshold]);

  // 监听用户手动滚动：程序自动滚动期间忽略
  const handleScroll = useCallback(() => {
    if (isAutoScrollingRef.current) return;
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

    isAutoScrollingRef.current = true;
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    setShowScrollButton(false);

    if (behavior === "smooth") {
      // block: "nearest" 避免强制将元素滚到视口最底，只需进入可见区域
      bottom.scrollIntoView({ behavior: "smooth", block: "nearest" });
      // smooth 动画结束后恢复（300ms 后大多数浏览器已完成）
      setTimeout(() => {
        isAutoScrollingRef.current = false;
      }, 300);
    } else {
      container.scrollTop = container.scrollHeight - container.clientHeight;
      isAutoScrollingRef.current = false;
    }
  }, []);

  // 流式输出跟随：只有当用户本来就在底部时才滚动
  const followIfAtBottom = useCallback(() => {
    if (!isAtBottomRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight - container.clientHeight;
  }, []);

  // 初始化时检查一次状态
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
