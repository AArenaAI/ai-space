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
  const userScrollTimestampRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const followRafRef = useRef(0);
  const isProgrammaticScrollRef = useRef(false);

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const checkIsAtBottom = useCallback(() => {
    const el = containerEl;
    if (!el) return true;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distanceToBottom <= threshold;
  }, [containerEl, threshold]);

  // 监听滚动：记录用户主动滚动时间；检测向上滑动意图并立即取消自动滚动
  const handleScroll = useCallback(() => {
    const el = containerEl;
    if (el) {
      // 程序触发的滚动（scrollIntoView / scrollTop 赋值）直接过滤，不当作用户主动滚动
      if (isProgrammaticScrollRef.current) {
        lastScrollTopRef.current = el.scrollTop;
        return;
      }

      const isScrollingUp = el.scrollTop < lastScrollTopRef.current;
      lastScrollTopRef.current = el.scrollTop;

      if (isScrollingUp) {
        // 只有真正向上滑才记录时间戳；向下滑不应该影响自动跟底
        userScrollTimestampRef.current = Date.now();

        // 用户主动向上滑：立即取消自动滚动状态，避免被拉回底部抖动
        isAutoScrollingRef.current = false;
        if (autoScrollRafRef.current) {
          cancelAnimationFrame(autoScrollRafRef.current);
          autoScrollRafRef.current = 0;
        }
        if (!isAtBottomRef.current) {
          return;
        }
        isAtBottomRef.current = false;
        setIsAtBottom(false);
        setShowScrollButton(true);
        return;
      }
    }

    if (isAutoScrollingRef.current) return;

    const atBottom = checkIsAtBottom();
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
    setShowScrollButton(!atBottom);
  }, [checkIsAtBottom, containerEl]);

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
      isProgrammaticScrollRef.current = true;
      bottom.scrollIntoView({ behavior: "smooth", block: "end" });
      isProgrammaticScrollRef.current = false;
      lastScrollTopRef.current = container.scrollTop;

      // RAF 轮询检测滚动是否完成
      const check = () => {
        if (!container) {
          isAutoScrollingRef.current = false;
          return;
        }
        lastScrollTopRef.current = container.scrollTop;
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
      isProgrammaticScrollRef.current = true;
      container.scrollTop = container.scrollHeight - container.clientHeight;
      isProgrammaticScrollRef.current = false;
      lastScrollTopRef.current = container.scrollTop;
      isAutoScrollingRef.current = false;
    }
  }, [containerEl]);

  // 流式输出跟随：只有当用户本来就在底部时才滚动
  const followIfAtBottom = useCallback(() => {
    if (!isAtBottomRef.current) return;
    const container = containerEl;
    const bottom = bottomRef.current;
    if (!container || !bottom) return;

    // 去重：若已有待执行的 RAF，先取消
    if (followRafRef.current) {
      cancelAnimationFrame(followRafRef.current);
    }

    followRafRef.current = requestAnimationFrame(() => {
      followRafRef.current = 0;
      if (!container || !bottom) return;
      if (!isAtBottomRef.current) return;

      // 布局完成后再次检查距离，若已贴底则不再干预
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distance <= 2) return;

      // 用 scrollIntoView 把内容末尾精确对齐到视口底部，避免 padding/margin 导致的残余空白
      isProgrammaticScrollRef.current = true;
      bottom.scrollIntoView({ block: "end" });
      isProgrammaticScrollRef.current = false;
      lastScrollTopRef.current = container.scrollTop;
    });
  }, [containerEl]);

  // 初始化 + DOM 就绪/外部依赖变化时主动检查一次
  useEffect(() => {
    if (!enabled || !containerEl) return;
    const atBottom = checkIsAtBottom();
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
    setShowScrollButton(!atBottom);
    // 同步滚动位置，确保第一次向上滑动能正确检测意图
    lastScrollTopRef.current = containerEl.scrollTop;
  }, [enabled, containerEl, checkIsAtBottom]);

  // MutationObserver：DOM 变化时自动跟随（仅当用户在底部且最近没有主动滚动时）
  useEffect(() => {
    if (!enabled || !containerEl) return;

    const handleMutation = () => {
      const c = containerEl;
      const b = bottomRef.current;
      if (!c || !b) return;
      // 用户最近 50ms 内有主动滚动，跳过（避免滚轮连续事件干扰）
      if (Date.now() - userScrollTimestampRef.current < 50) return;
      if (!isAtBottomRef.current) return;

      // 去重：若已有待执行的 RAF，先取消
      if (followRafRef.current) {
        cancelAnimationFrame(followRafRef.current);
      }

      followRafRef.current = requestAnimationFrame(() => {
        followRafRef.current = 0;
        if (!c || !b) return;
        if (!isAtBottomRef.current) return;

        // 布局完成后再次检查距离，若已贴底则不再干预
        const distance = c.scrollHeight - c.scrollTop - c.clientHeight;
        if (distance <= 2) return;

        isProgrammaticScrollRef.current = true;
        b.scrollIntoView({ block: "end" });
        isProgrammaticScrollRef.current = false;
        lastScrollTopRef.current = c.scrollTop;
      });
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
