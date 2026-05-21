import { useState, useEffect, useRef, useCallback } from "react";

/**
 * AMC-WebUI 风格的平滑流式文字显示 hook。
 * 通过 requestAnimationFrame 驱动打字机效果，自适应追赶速度。
 * 渲染节流限制为 ~16fps（60ms），避免高频 state update 导致的性能问题。
 *
 * 关键优化：RAF 动画循环不依赖 safeText，只依赖 isStreaming。
 * safeText 变化时只更新 targetTextRef，RAF 继续运行，不会被取消重启，避免追赶永远落后一帧。
 */
export function useSmoothStreaming(text: string | undefined | null, isStreaming: boolean): string {
  const safeText = text || "";
  const [displayedText, setDisplayedText] = useState(isStreaming ? "" : safeText);

  const displayedTextRef = useRef(isStreaming ? "" : safeText);
  const targetTextRef = useRef(safeText);
  const animationFrameRef = useRef<number | null>(null);
  const lastRenderTimeRef = useRef<number>(0);
  const isStreamingRef = useRef(isStreaming);

  // 同步 isStreaming ref，供 RAF 回调内部使用
  isStreamingRef.current = isStreaming;

  // RAF 动画函数，用 useCallback 包裹以确保引用稳定
  const animate = useCallback((time: number) => {
    // 已停止流式，终止动画
    if (!isStreamingRef.current) {
      animationFrameRef.current = null;
      return;
    }

    // 页面隐藏时停止调度，切换回来后从当前进度继续
    if (typeof document !== "undefined" && document.hidden) {
      animationFrameRef.current = null;
      return;
    }

    const currentLen = displayedTextRef.current.length;
    const targetLen = targetTextRef.current.length;

    if (currentLen < targetLen) {
      const lag = targetLen - currentLen;

      // 更平滑的追赶曲线：最大每帧 5 字，避免大 lag 时"一坨"蹦出来
      let charsToAdd = 1;
      if (lag > 200) charsToAdd = 5;
      else if (lag > 100) charsToAdd = 4;
      else if (lag > 50) charsToAdd = 3;
      else if (lag > 20) charsToAdd = 2;
      else if (lag > 5) charsToAdd = 1; // lag 小就逐字

      const nextText = targetTextRef.current.slice(0, currentLen + charsToAdd);

      // 总是更新内部 ref 以跟踪进度
      displayedTextRef.current = nextText;

      // 渲染节流：每 60ms 或追赶完成时才触发 React state update
      const isFinishedCatchingUp = nextText.length >= targetLen;
      if (isFinishedCatchingUp || time - lastRenderTimeRef.current > 60) {
        setDisplayedText(nextText);
        lastRenderTimeRef.current = time;
      }

      if (isFinishedCatchingUp) {
        animationFrameRef.current = null;
      } else {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    } else if (currentLen > targetLen) {
      // 目标文本变短了（如 think 标签关闭后内容重组），直接同步
      displayedTextRef.current = targetTextRef.current;
      setDisplayedText(targetTextRef.current);
      lastRenderTimeRef.current = time;
      animationFrameRef.current = null;
    } else {
      // 已追上，停止 RAF
      animationFrameRef.current = null;
    }
  }, []);

  // Effect 1：同步目标文本。safeText 变化时只更新 ref，不触发 RAF 重启。
  // 如果动画已停止但 target 又变长了，启动新的 RAF。
  useEffect(() => {
    const prevTarget = targetTextRef.current;
    targetTextRef.current = safeText;

    if (!isStreaming) {
      displayedTextRef.current = safeText;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    // 动画已停止但目标又变长了，需要重新启动
    if (!animationFrameRef.current && displayedTextRef.current.length < targetTextRef.current.length) {
      animationFrameRef.current = requestAnimationFrame(animate);
    }
  }, [safeText, isStreaming, animate]);

  // Effect 2：isStreaming 变化时管理 RAF。只依赖 isStreaming，不依赖 safeText。
  useEffect(() => {
    if (!isStreaming) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    // 流式状态下，如果需要追赶且没有动画在运行，启动 RAF
    if (!animationFrameRef.current && displayedTextRef.current.length < targetTextRef.current.length) {
      animationFrameRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isStreaming, animate]);

  return isStreaming ? displayedText : safeText;
}
