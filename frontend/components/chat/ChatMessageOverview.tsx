"use client";

import { memo, useMemo } from "react";
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

function getWindow(items: ChatMessageOverviewItem[]) {
  if (items.length <= MAX_VISIBLE) {
    return { windowItems: items, isWheel: false };
  }

  const activeIdx = items.findIndex((i) => i.active);
  const safeIdx = Math.max(0, Math.min(items.length - 1, activeIdx));

  let start = safeIdx - CENTER;
  if (start < 0) start = 0;
  if (start + MAX_VISIBLE > items.length) start = items.length - MAX_VISIBLE;

  return {
    windowItems: items.slice(start, start + MAX_VISIBLE),
    isWheel: true,
  };
}

/** 表盘流动效果：距离中心越远，opacity 和 scale 越小 */
function getWheelStyle(index: number) {
  const distance = Math.abs(index - CENTER);
  const opacity = Math.max(0.12, 1 - distance * 0.22);
  const scale = Math.max(0.72, 1 - distance * 0.07);
  return { opacity, transform: `scaleX(${scale})` };
}

function getWheelTextStyle(index: number) {
  const distance = Math.abs(index - CENTER);
  const opacity = Math.max(0.25, 1 - distance * 0.18);
  return { opacity };
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

  const { windowItems, isWheel } = useMemo(() => getWindow(items), [items]);

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
          className={cn(
            "invisible absolute right-8 top-1/2 z-[150] flex w-[320px] -translate-y-1/2 flex-col gap-1.5 overflow-hidden rounded-2xl border border-surface-border bg-surface-elevated px-2 py-2 opacity-0 shadow-2xl shadow-black/25 group-hover:visible group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:visible group-focus-within:pointer-events-auto group-focus-within:opacity-100 dark:border-[#2b2b2b] dark:bg-[#171717]",
            isWheel && "h-[378px]"
          )}
          data-testid="chat-message-overview-panel"
        >
          {/* 顶部渐隐遮罩 */}
          {isWheel && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-10 bg-gradient-to-b from-surface-elevated via-surface-elevated/80 to-transparent" />
          )}

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

          {/* 底部渐隐遮罩 */}
          {isWheel && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10 bg-gradient-to-t from-surface-elevated via-surface-elevated/80 to-transparent" />
          )}
        </div>
      </div>
    </div>
  );
});

export default ChatMessageOverview;
