import { useCallback, useEffect, useRef, useState } from "react";

type UseSmartAutoScrollOptions = {
  deps: unknown[];
  threshold?: number;
  enabled?: boolean;
};

export function useSmartAutoScroll({
  deps,
  threshold = 120,
  enabled = true,
}: UseSmartAutoScrollOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

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
    setIsAtBottom(atBottom);
    setShowScrollButton(!atBottom);
  }, [checkIsAtBottom]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      bottomRef.current?.scrollIntoView({
        behavior,
        block: "end",
      });
      setIsAtBottom(true);
      setShowScrollButton(false);
    },
    [],
  );

  useEffect(() => {
    if (!enabled) return;

    if (isAtBottom) {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({
          behavior: "auto",
          block: "end",
        });
      });
    } else {
      setShowScrollButton(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return {
    containerRef,
    bottomRef,
    isAtBottom,
    showScrollButton,
    handleScroll,
    scrollToBottom,
  };
}
