"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

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
  const { t } = useI18n();
  // 暂时隐藏右侧消息导航悬浮条
  return null;
});

export default ChatMessageOverview;
