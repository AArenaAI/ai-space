"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

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

function markerClass(active: boolean) {
  return cn(
    "h-[2px] shrink-0 rounded-full",
    active
      ? "bg-brand shadow-[0_0_0_1px_rgba(255,255,255,0.16)]"
      : "bg-slate-400/55 dark:bg-slate-400/50 green:bg-[#405E3D]/55"
  );
}

const ChatMessageOverview = memo(function ChatMessageOverview({ items, visible, onJumpToMessage }: ChatMessageOverviewProps) {
  if (!visible || items.length < 2) return null;

  return (
    <div
      className="group pointer-events-none absolute right-5 top-1/2 z-[140] hidden max-h-[min(520px,calc(100%-160px))] -translate-y-1/2 items-center sm:flex"
      data-testid="chat-message-overview"
    >
      <div className="pointer-events-auto relative flex max-h-full items-center justify-end">
        <div
          className="pointer-events-none absolute inset-y-0 -left-5 right-0 opacity-0"
          data-testid="chat-message-overview-hover-target"
          aria-hidden="true"
        />
        <div
          className="flex max-h-[min(520px,calc(100vh-160px))] w-8 flex-col items-end gap-2 overflow-hidden py-2 pr-1"
          data-testid="chat-message-overview-rail"
          aria-hidden="true"
        >
          {items.map((item) => (
            <span key={item.id} className={cn(markerClass(item.active), "w-7")} />
          ))}
        </div>
        <div
          className="chat-message-overview-scrollbar invisible absolute right-8 top-1/2 z-[150] flex max-h-[min(520px,calc(100vh-160px))] w-[320px] -translate-y-1/2 flex-col gap-1.5 overflow-y-auto rounded-2xl border border-surface-border bg-surface-elevated px-2 py-2 opacity-0 shadow-2xl shadow-black/25 group-hover:visible group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:visible group-focus-within:pointer-events-auto group-focus-within:opacity-100 dark:border-[#2b2b2b] dark:bg-[#171717]"
          data-testid="chat-message-overview-panel"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onJumpToMessage(item.id)}
              className={cn(
                "group/item flex min-h-9 w-full items-center justify-between gap-3 rounded-xl px-2 text-left outline-none transition-colors duration-150 hover:bg-surface-card/70 focus-visible:ring-2 focus-visible:ring-brand/35",
                item.active ? "text-brand" : "text-text-secondary hover:text-text-primary"
              )}
              data-testid="chat-message-overview-item"
              data-message-id={item.id}
              aria-label={`跳转到用户消息：${item.label}`}
            >
              <span className="min-w-0 flex-1 truncate text-xs leading-9">{item.label}</span>
              <span
                className={cn(
                  markerClass(item.active),
                  "w-5",
                  !item.active && "group-hover/item:bg-slate-400/65 dark:group-hover/item:bg-slate-300/65 green:group-hover/item:bg-[#405E3D]/72"
                )}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});

export default ChatMessageOverview;
