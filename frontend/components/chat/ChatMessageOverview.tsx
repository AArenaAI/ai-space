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

const ChatMessageOverview = memo(function ChatMessageOverview({ items, visible, onJumpToMessage }: ChatMessageOverviewProps) {
  if (!visible || items.length < 2) return null;

  return (
    <div
      className="group pointer-events-none absolute right-5 top-1/2 z-[110] hidden max-h-[min(520px,calc(100%-160px))] -translate-y-1/2 items-center sm:flex"
      data-testid="chat-message-overview"
    >
      <div className="pointer-events-auto relative flex max-h-full items-center justify-end">
        {/* Invisible hover target to make right-edge hover stable */}
        <div
          className="absolute inset-y-0 right-0 w-10 opacity-0"
          data-testid="chat-message-overview-hover-target"
          aria-hidden="true"
        />
        <div
          className="chat-message-overview-scrollbar flex max-h-[min(520px,calc(100vh-160px))] w-8 flex-col items-end gap-2 overflow-hidden rounded-full bg-transparent py-2 pr-1 transition-[width,background-color,box-shadow,padding,border-color] duration-200 group-hover:w-[320px] group-hover:items-stretch group-hover:gap-1.5 group-hover:overflow-y-auto group-hover:rounded-2xl group-hover:border group-hover:border-surface-border/70 group-hover:bg-surface-elevated/95 group-hover:px-2 group-hover:pr-2 group-hover:shadow-2xl group-hover:shadow-black/20 dark:group-hover:bg-[#171717]/95"
          data-testid="chat-message-overview-panel"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onJumpToMessage(item.id)}
              className={cn(
                "group/item flex h-4 w-full items-center justify-end rounded-xl text-left outline-none transition-[min-height,color,background-color] duration-200 focus-visible:ring-2 focus-visible:ring-brand/35 group-hover:min-h-9 group-hover:justify-between group-hover:gap-3 group-hover:px-2 group-hover:hover:bg-surface-card/70",
                item.active ? "text-brand" : "text-text-secondary hover:text-text-primary"
              )}
              data-testid="chat-message-overview-item"
              data-message-id={item.id}
              aria-label={`跳转到用户消息：${item.label}`}
            >
              <span className="min-w-0 flex-1 truncate text-xs leading-9 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                {item.label}
              </span>
              <span
                className={cn(
                  "h-[2px] w-7 shrink-0 rounded-full transition-[width,background-color,box-shadow] duration-200 group-hover:w-5",
                  item.active
                    ? "bg-brand shadow-[0_0_0_1px_rgba(255,255,255,0.16)]"
                    : "bg-slate-400/55 group-hover:bg-slate-400/65 dark:bg-slate-400/50 dark:group-hover:bg-slate-300/65 green:bg-[#405E3D]/55 green:group-hover:bg-[#405E3D]/72"
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
