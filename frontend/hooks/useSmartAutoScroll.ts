import { useCallback, useEffect, useRef, useState } from "react";

type UseSmartAutoScrollOptions = {
  threshold?: number;
  enabled?: boolean;
};

export function useSmartAutoScroll({
  threshold = 120,
  enabled = true,
}: UseSmartAutoScrollOptions) {
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainerEl(node);
  }, []);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  const isAutoScrollingRef = useRef(false);
  const autoScrollRafRef = useRef(0);

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const checkIsAtBottom = useCallback(() => {
    const el = containerEl;
    if (!el) return true;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distanceToBottom <= threshold;
  }, [containerEl, threshold]);

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
    const container = containerEl;
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
  }, [containerEl]);

  // 流式输出跟随：只有当用户本来就在底部时才滚动
  const followIfAtBottom = useCallback(() => {
    if (!isAtBottomRef.current) return;
    const container = containerEl;
    if (!container) return;
    container.scrollTop = container.scrollHeight - container.clientHeight;
  }, [containerEl]);

  // 初始化 + DOM 就绪/外部依赖变化时主动检查一次
  useEffect(() => {
    if (!enabled || !containerEl) return;
    const atBottom = checkIsAtBottom();
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
    setShowScrollButton(!atBottom);
  }, [enabled, containerEl, checkIsAtBottom]);

  // MutationObserver：DOM 变化时自动跟随（仅当用户在底部时）
  useEffect(() => {
    if (!enabled || !containerEl) return;

    const handleMutation = () => {
      const c = containerEl;
      if (!c) return;
      if (!isAtBottomRef.current) return;
      c.scrollTop = c.scrollHeight - c.clientHeight;
    };

    const mo = new MutationObserver(handleMutation);
    mo.observe(containerEl, { childList: true, subtree: true, characterData: true });

    return () => {
      mo.disconnect();
    };
  }, [enabled, containerEl]);

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
