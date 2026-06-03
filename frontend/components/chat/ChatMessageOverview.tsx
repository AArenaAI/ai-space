"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
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

function getCenteredStart(items: ChatMessageOverviewItem[]) {
  if (items.length <= MAX_VISIBLE) return 0;
  const activeIdx = items.findIndex((i) => i.active);
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
  const panelRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);

  const isWheel = items.length > MAX_VISIBLE;
  const activeId = items.find((item) => item.active)?.id;
  const maxStart = Math.max(0, items.length - MAX_VISIBLE);

  // 主聊天区域滚动导致 active 改变时，重新把 active 放回中间窗口；
  // 但用户在悬浮框内滚轮/触摸板滑动时，会用 windowStart 临时浏览更早/更晚数据。
  useEffect(() => {
    if (!isWheel) {
      setWindowStart(0);
      return;
    }
    setWindowStart(getCenteredStart(items));
  }, [activeId, isWheel, items]);

  const windowItems = useMemo(() => {
    if (!isWheel) return items;
    const start = clamp(windowStart, 0, maxStart);
    return items.slice(start, start + MAX_VISIBLE);
  }, [isWheel, items, maxStart, windowStart]);

  const thumbHeightPercent = isWheel ? clamp((MAX_VISIBLE / items.length) * 100, 18, 72) : 100;
  const thumbTopPercent = isWheel && maxStart > 0
    ? (windowStart / maxStart) * (100 - thumbHeightPercent)
    : 0;

  const updateWindowStartFromPointer = useCallback((clientY: number) => {
    if (!isWheel || maxStart <= 0) return;
    const panel = panelRef.current;
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    const usableHeight = Math.max(1, rect.height * (1 - thumbHeightPercent / 100));
    const offsetY = clamp(clientY - rect.top - (rect.height * thumbHeightPercent) / 200, 0, usableHeight);
    const nextStart = Math.round((offsetY / usableHeight) * maxStart);
    setWindowStart(clamp(nextStart, 0, maxStart));
  }, [isWheel, maxStart, thumbHeightPercent]);

  const handleOverviewWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (!isWheel) return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.deltaY > 0 ? 1 : -1;
    const step = clamp(Math.ceil(Math.abs(event.deltaY) / 80), 1, 4);
    setWindowStart((current) => clamp(current + direction * step, 0, maxStart));
  }, [isWheel, maxStart]);

  const handleScrollbarPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!isWheel) return;
    event.preventDefault();
    event.stopPropagation();
    isDraggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateWindowStartFromPointer(event.clientY);
  }, [isWheel, updateWindowStartFromPointer]);

  const handleScrollbarPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    updateWindowStartFromPointer(event.clientY);
  }, [updateWindowStartFromPointer]);

  const handleScrollbarPointerEnd = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    isDraggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

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
          onWheel={handleOverviewWheel}
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
            "invisible absolute right-8 top-1/2 z-[150] flex w-[320px] -translate-y-1/2 overflow-hidden rounded-2xl border border-surface-border bg-surface-elevated px-2 py-2 opacity-0 shadow-2xl shadow-black/25 group-hover:visible group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:visible group-focus-within:pointer-events-auto group-focus-within:opacity-100 dark:border-[#2b2b2b] dark:bg-[#171717]",
            isWheel && "h-[378px]"
          )}
          onWheel={handleOverviewWheel}
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
                      ? "text-brand"
                      : "text-text-secondary hover:text-text-primary"
                  )}
                  style={wheelTextStyle}
                  data-testid="chat-message-overview-item"
                  data-message-id={item.id}
                  aria-label={t("chat.overview.jumpToUserMessage", {
                    label: item.label,
                  })}
                >
                  <span className="min-w-0 flex-1 truncate text-xs leading-9">
                    {item.label}
                  </span>
                  <span
                    className={cn(
                      "h-[3px] shrink-0 rounded-full transition-all duration-300",
                      item.active
                        ? "bg-brand w-5 shadow-[0_0_0_1px_rgba(255,255,255,0.16)]"
                        : "bg-slate-400/55 dark:bg-slate-400/50 w-3"
                    )}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>

          {isWheel && (
            <div
              className="relative my-1 w-3 shrink-0 cursor-grab rounded-full active:cursor-grabbing"
              role="scrollbar"
              aria-orientation="vertical"
              aria-valuemin={0}
              aria-valuemax={maxStart}
              aria-valuenow={windowStart}
              aria-label={t("chat.overview.scrollbar", {
                current: String(windowStart + 1),
                total: String(maxStart + 1),
              })}
              onPointerDown={handleScrollbarPointerDown}
              onPointerMove={handleScrollbarPointerMove}
              onPointerUp={handleScrollbarPointerEnd}
              onPointerCancel={handleScrollbarPointerEnd}
              data-testid="chat-message-overview-scrollbar"
            >
              <div className="absolute inset-x-[5px] inset-y-0 rounded-full bg-slate-500/15 dark:bg-white/10" />
              <div
                className="absolute inset-x-[3px] rounded-full bg-slate-400/70 shadow-sm transition-[top,height,background-color] duration-150 hover:bg-brand/80 dark:bg-slate-300/55"
                style={{
                  top: `${thumbTopPercent}%`,
                  height: `${thumbHeightPercent}%`,
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
