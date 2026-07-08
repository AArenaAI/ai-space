"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ACTIVE_GENERATION_STATUS_SLOT_MIN_HEIGHT, isActiveGenerationPhase, type AssistantGenerationPhase } from "@/lib/chatGenerationState";

const HEIGHT_TRANSITION_MS = 180;

export default function AssistantGenerationFrame({
  phase,
  children,
  className,
}: {
  phase: AssistantGenerationPhase;
  children: ReactNode;
  className?: string;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const previousPhaseRef = useRef<AssistantGenerationPhase>(phase);
  const previousHeightRef = useRef<number | null>(null);
  const releaseTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const activeGenerationPhase = isActiveGenerationPhase(phase);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return;
    previousHeightRef.current = frame.getBoundingClientRect().height;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (typeof height === "number" && Number.isFinite(height) && !transitioning) {
        previousHeightRef.current = height;
      }
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [transitioning]);

  useLayoutEffect(() => {
    const previousPhase = previousPhaseRef.current;
    const inner = innerRef.current;
    const frame = frameRef.current;
    if (!inner || !frame) {
      previousPhaseRef.current = phase;
      return;
    }

    const nextHeight = inner.getBoundingClientRect().height;
    if (previousPhase === phase) {
      previousHeightRef.current = frame.getBoundingClientRect().height || nextHeight;
      return;
    }

    // Lock the visible frame height, not only the inner content height. Pending uses
    // a first-frame min-height, so reading the inner dot height would make the row
    // shrink before expanding into reasoning/answering.
    const previousHeight = frame.getBoundingClientRect().height || previousHeightRef.current || nextHeight;
    previousPhaseRef.current = phase;
    previousHeightRef.current = previousHeight;

    if (releaseTimerRef.current) window.clearTimeout(releaseTimerRef.current);
    if (rafRef.current) window.cancelAnimationFrame(rafRef.current);

    if (phase === "completed" || phase === "empty") {
      setTransitioning(false);
      setLockedHeight(null);
      return;
    }

    setTransitioning(false);
    setLockedHeight(previousHeight);
    rafRef.current = window.requestAnimationFrame(() => {
      const measuredHeight = innerRef.current?.getBoundingClientRect().height || previousHeight;
      const targetHeight = Math.max(previousHeight, measuredHeight);
      if (Math.abs(previousHeight - targetHeight) <= 1) {
        setTransitioning(false);
        setLockedHeight(previousHeight);
        releaseTimerRef.current = window.setTimeout(() => {
          setLockedHeight(null);
          previousHeightRef.current = frameRef.current?.getBoundingClientRect().height || targetHeight;
        }, HEIGHT_TRANSITION_MS + 40);
        return;
      }
      setTransitioning(true);
      setLockedHeight(targetHeight);
      releaseTimerRef.current = window.setTimeout(() => {
        setTransitioning(false);
        setLockedHeight(null);
        previousHeightRef.current = frameRef.current?.getBoundingClientRect().height || targetHeight;
      }, HEIGHT_TRANSITION_MS + 40);
    });

    return () => {
      if (releaseTimerRef.current) window.clearTimeout(releaseTimerRef.current);
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    };
  }, [phase]);

  return (
    <div
      ref={frameRef}
      data-chat-generation-frame="true"
      data-chat-generation-phase={phase}
      data-chat-generation-height-locked={lockedHeight === null ? "false" : "true"}
      className={cn(
        "relative w-full min-w-0 overflow-hidden",
        transitioning && "transition-[height]",
        className,
      )}
      style={{
        ...(activeGenerationPhase ? { minHeight: ACTIVE_GENERATION_STATUS_SLOT_MIN_HEIGHT } : {}),
        ...(lockedHeight === null ? {} : {
          height: lockedHeight,
          transitionDuration: `${HEIGHT_TRANSITION_MS}ms`,
          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
        }),
      }}
    >
      <div ref={innerRef} data-chat-generation-frame-inner="true" className="w-full min-w-0">
        {children}
      </div>
    </div>
  );
}
