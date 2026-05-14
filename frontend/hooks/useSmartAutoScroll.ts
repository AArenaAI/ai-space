import { useCallback, useEffect, useRef, useState } from "react";

type UseSmartAutoScrollOptions = {
  deps?: unknown[];
  threshold?: number;
  enabled?: boolean;
};

export function useSmartAutoScroll({
  deps = [],
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

  const handleScroll = useCallback(() => {
    const atBottom = checkIsAtBottom();
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
    setShowScrollButton(!atBottom);
  }, [checkIsAtBottom]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = containerRef.current;
    const bottom = bottomRef.current;
    if (!container || !bottom) return;

    if (behavior === "smooth") {
      bottom.scrollIntoView({ behavior: "smooth", block: "end" });
    } else {
      container.scrollTop = container.scrollHeight - container.clientHeight;
    }

    isAtBottomRef.current = true;
    setIsAtBottom(true);
    setShowScrollButton(false);
  }, []);

  const followIfAtBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceToBottom > threshold) return;

    container.scrollTop = container.scrollHeight - container.clientHeight;
  }, [threshold]);

  // deps 变化时只同步状态，不做滚动（避免与外部 scrollToBottom 冲突）
  useEffect(() => {
    if (!enabled) return;
    const atBottom = checkIsAtBottom();
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
    setShowScrollButton(!atBottom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return {
    containerRef,
    bottomRef,
    isAtBottom,
    isAtBottomRef,
    showScrollButton,
    handleScroll,
    scrollToBottom,
    followIfAtBottom,
  };
}