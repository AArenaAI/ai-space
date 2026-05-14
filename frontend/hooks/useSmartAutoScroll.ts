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
  const autoScrollRafRef = useRef(0);

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const checkIsAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distanceToBottom <= threshold;
  }, [threshold]);

  // 监听滚动：程序自动滚动期间屏蔽，避免按钮闪烁
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

    // 清理之前的 RAF
    if (autoScrollRafRef.current) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = 0;
    }

    isAutoScrollingRef.current = true;
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    setShowScrollButton(false);

    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distance <= 1) {
      isAutoScrollingRef.current = false;
      return;
    }

    if (behavior === "smooth") {
      // block: "end" 确保空 div 的底部（=内容末尾）对齐到视口底部
      bottom.scrollIntoView({ behavior: "smooth", block: "end" });

      // RAF 轮询检测滚动是否完成
      const check = () => {
        if (!container) {
          isAutoScrollingRef.current = false;
          return;
        }
        const d = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (d <= 1) {
          isAutoScrollingRef.current = false;
        } else {
          autoScrollRafRef.current = requestAnimationFrame(check);
        }
      };
      autoScrollRafRef.current = requestAnimationFrame(check);

      // 安全超时：最多 1 秒后强制恢复
      setTimeout(() => {
        if (autoScrollRafRef.current) {
          cancelAnimationFrame(autoScrollRafRef.current);
          autoScrollRafRef.current = 0;
        }
        isAutoScrollingRef.current = false;
      }, 1000);
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
