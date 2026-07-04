"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

const MAX_VISIBLE = 9;
const CENTER = 4;

export type ChatMessageOverviewItem = {
  id: string;
  label: string;
  active: boolean;
};

export type ChatMessageOverviewProps = {
  items: ChatMessageOverviewItem[];
  visible: boolean;
  onJumpToMessage: (messageId: string) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getCenteredStart(items: ChatMessageOverviewItem[], activeId?: string) {
  if (items.length <= MAX_VISIBLE) return 0;
  const activeIdx =
    items.findIndex((i) => i.id === activeId) >= 0
      ? items.findIndex((i) => i.id === activeId)
      : items.findIndex((i) => i.active);
  const safeIdx = activeIdx >= 0 ? activeIdx : items.length - 1;
  return clamp(safeIdx - CENTER, 0, items.length - MAX_VISIBLE);
}

/** 表盘流动效果：距离中心越远，opacity 和 scale 越小 */
function getWheelStyle(index: number) {
  const distance = Math.abs(index - CENTER);
  const scale = Math.max(0.72, 1 - distance * 0.07);
  return { transform: `scaleX(${scale})` };
}

function getWheelTextStyle(index: number) {
  return undefined;
}

function markerClass(active: boolean, isWheel: boolean) {
  return cn(
    "shrink-0 rounded-full transition-all duration-300",
    isWheel ? "h-[3px]" : "h-[2px]",
    active
      ? "bg-brand shadow-[0_0_0_1px_rgba(255,255,255,0.16)]"
      : "bg-slate-400/55 dark:bg-slate-400/50"
  );
}

const ChatMessageOverview = memo(function ChatMessageOverview({
  items,
  visible,
  onJumpToMessage,
}: ChatMessageOverviewProps) {
  const { t } = useI18n();
  const [windowStart, setWindowStart] = useState(0);
  const railRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollbarTrackRef = useRef<HTMLDivElement | null>(null);
  const scrollbarDragRef = useRef<{
    pointerId: number;
    startY: number;
    startWindowStart: number;
    trackHeight: number;
  } | null>(null);

  const isWheel = items.length > MAX_VISIBLE;
  const activeId = items.find((item) => item.active)?.id;
  const maxStart = Math.max(0, items.length - MAX_VISIBLE);
  const effectiveActiveId = activeId ?? items[items.length - 1]?.id;
  const itemCount = items.length;

  // 主聊天区域滚动导致 active 改变时，重新把 active 放回中间窗口；
  // 但用户在悬浮框内滚轮/触摸板滑动时，会用 windowStart 临时浏览更早/更晚数据。
  useEffect(() => {
    if (!isWheel) {
      setWindowStart(0);
      return;
    }
    setWindowStart(getCenteredStart(items, effectiveActiveId));
  }, [effectiveActiveId, isWheel, itemCount]);

  const windowItems = useMemo(() => {
    if (!isWheel) return items;
    const start = clamp(windowStart, 0, maxStart);
    return items.slice(start, start + MAX_VISIBLE);
  }, [isWheel, items, maxStart, windowStart]);

  const scrollbarThumbHeight = isWheel
    ? clamp((MAX_VISIBLE / items.length) * 100, 18, 100)
    : 100;
  const scrollbarThumbTop =
    isWheel && maxStart > 0
      ? (clamp(windowStart, 0, maxStart) / maxStart) * (100 - scrollbarThumbHeight)
      : 0;

  const updateWindowStartFromPointer = useCallback((clientY: number) => {
    const drag = scrollbarDragRef.current;
    if (!drag || drag.trackHeight <= 0 || maxStart <= 0) return;
    const deltaY = clientY - drag.startY;
    const deltaStart = Math.round((deltaY / drag.trackHeight) * maxStart);
    setWindowStart(clamp(drag.startWindowStart + deltaStart, 0, maxStart));
  }, [maxStart]);

  const handleScrollbarPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!isWheel) return;
    event.preventDefault();
    event.stopPropagation();
    const track = scrollbarTrackRef.current;
    const trackHeight = track?.getBoundingClientRect().height ?? 0;
    scrollbarDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startWindowStart: clamp(windowStart, 0, maxStart),
      trackHeight,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [isWheel, maxStart, windowStart]);

  const handleScrollbarPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (scrollbarDragRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    updateWindowStartFromPointer(event.clientY);
  }, [updateWindowStartFromPointer]);

  const handleScrollbarPointerEnd = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (scrollbarDragRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    scrollbarDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleScrollbarTrackPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isWheel || maxStart <= 0 || event.target !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    setWindowStart(clamp(Math.round(ratio * maxStart), 0, maxStart));
  }, [isWheel, maxStart]);

  const handleOverviewWheelDelta = useCallback((deltaY: number) => {
    if (!isWheel) return;
    const direction = deltaY > 0 ? 1 : -1;
    const step = clamp(Math.ceil(Math.abs(deltaY) / 80), 1, 4);
    setWindowStart((current) => clamp(current + direction * step, 0, maxStart));
  }, [isWheel, maxStart]);

  useEffect(() => {
    if (!isWheel) return;
    const handleWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      handleOverviewWheelDelta(event.deltaY);
    };
    const rail = railRef.current;
    const panel = panelRef.current;
    rail?.addEventListener("wheel", handleWheel, { passive: false });
    panel?.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      rail?.removeEventListener("wheel", handleWheel);
      panel?.removeEventListener("wheel", handleWheel);
    };
  }, [handleOverviewWheelDelta, isWheel]);

  // 只有 1 条时不展示（< 2 已包含 0 条情况）
  if (!visible || items.length < 2) return null;

  return (
    <div
      className="group pointer-events-none absolute right-5 top-1/2 z-[140] hidden max-h-[min(520px,calc(100%-160px))] -translate-y-1/2 items-center sm:flex"
      data-testid="chat-message-overview"
    >
      <div className="pointer-events-auto relative flex max-h-full items-center justify-end">
        {/* hover 扩展区域 */}
        <div
          className="pointer-events-none absolute inset-y-0 -left-5 right-0 opacity-0"
          data-testid="chat-message-overview-hover-target"
          aria-hidden="true"
        />

        {/* Rail 小横线 */}
        <div
          ref={railRef}
          className={cn(
            "flex w-8 flex-col items-end gap-2 py-2 pr-1",
            isWheel
              ? "h-[139px] overflow-hidden"
              : "max-h-[min(520px,calc(100vh-160px))] overflow-y-auto"
          )}
          style={
            isWheel
              ? undefined
              : { scrollbarWidth: "none", msOverflowStyle: "none" }
          }
          data-testid="chat-message-overview-rail"
          aria-hidden="true"
        >
          {windowItems.map((item, idx) => {
            const wheelStyle = isWheel ? getWheelStyle(idx) : undefined;
            return (
              <span
                key={item.id}
                className={cn(
                  markerClass(item.active, isWheel),
                  item.active ? "w-7" : isWheel ? "w-5" : "w-7"
                )}
                style={wheelStyle}
              />
            );
          })}
        </div>

        {/* Panel 展开面板 */}
        <div
          ref={panelRef}
          className={cn(
            "invisible absolute right-8 top-1/2 z-[150] flex w-[320px] -translate-y-1/2 overflow-hidden rounded-2xl border border-surface-border bg-surface-elevated px-2 py-2 opacity-0 shadow-2xl shadow-black/25 group-hover:visible group-hover:pointer-events-auto group-hover:opacity-100 dark:border-[#2b2b2b] dark:bg-[#171717]",
            isWheel && "h-[378px]"
          )}
          data-testid="chat-message-overview-panel"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 pr-2">
            {windowItems.map((item, idx) => {
              const wheelTextStyle = isWheel ? getWheelTextStyle(idx) : undefined;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onJumpToMessage(item.id)}
                  className={cn(
                    "group/item flex min-h-9 w-full shrink-0 items-center justify-between gap-3 rounded-xl px-2 text-left outline-none transition-colors duration-150 hover:bg-surface-card/70 focus-visible:ring-2 focus-visible:ring-brand/35",
                    item.active
                      ? "bg-brand/5 text-brand"
                      : "text-text-secondary hover:text-text-primary"
                  )}
                  style={wheelTextStyle}
                  data-testid="chat-message-overview-item"
                  data-message-id={item.id}
                  data-overview-active={item.active ? "true" : "false"}
                  aria-current={item.active ? "true" : undefined}
                  aria-label={t("chat.overview.jumpToUserMessage", {
                    label: item.label,
                  })}
                >
                  <span className="min-w-0 flex-1 truncate text-xs leading-9">
                    {item.label}
                  </span>
                  {item.active && (
                    <span className="hidden shrink-0 rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-brand/90 sm:inline-flex">
                      正在阅读
                    </span>
                  )}
                  <span
                    className={cn(
                      "h-[3px] shrink-0 rounded-full transition-all duration-300",
                      item.active
                        ? "bg-brand w-5 shadow-[0_0_0_1px_rgba(255,255,255,0.16)]"
                        : "bg-slate-400/55 dark:bg-slate-400/50 w-5"
                    )}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>

          {isWheel && (
            <div
              ref={scrollbarTrackRef}
              className="relative my-1 w-2 shrink-0 rounded-full bg-slate-200/70 dark:bg-white/10"
              data-testid="chat-message-overview-scrollbar"
              onPointerDown={handleScrollbarTrackPointerDown}
              aria-hidden="true"
            >
              <button
                type="button"
                className="absolute left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-slate-400/80 shadow-sm transition-colors hover:bg-slate-500/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 dark:bg-slate-500/80 dark:hover:bg-slate-400/80"
                data-testid="chat-message-overview-scrollbar-thumb"
                aria-label="滚动消息概览"
                onPointerDown={handleScrollbarPointerDown}
                onPointerMove={handleScrollbarPointerMove}
                onPointerUp={handleScrollbarPointerEnd}
                onPointerCancel={handleScrollbarPointerEnd}
                style={{
                  top: `${scrollbarThumbTop}%`,
                  height: `${scrollbarThumbHeight}%`,
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default ChatMessageOverview;
