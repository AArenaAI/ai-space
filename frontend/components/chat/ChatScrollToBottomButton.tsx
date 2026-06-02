"use client";

import { ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export type ChatScrollToBottomButtonProps = {
  visible: boolean;
  bottomOffset: number;
  onClick: () => void;
};

export default function ChatScrollToBottomButton({ visible, bottomOffset, onClick }: ChatScrollToBottomButtonProps) {
  const { t } = useI18n();
  if (!visible) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-[75] mx-auto max-w-[1440px]"
      style={{ bottom: bottomOffset }}
    >
      <button
        type="button"
        onClick={onClick}
        className="pointer-events-auto absolute left-1/2 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full
          border border-surface-border bg-surface-elevated/75 text-text-secondary shadow-lg backdrop-blur-md transition-all
          hover:border-surface-border/80 hover:bg-surface-card/85 hover:text-text-primary hover:shadow-xl
          active:scale-95 active:bg-surface-card active:shadow-sm"
        aria-label={t("chat.scroll.toBottom")}
      >
        <ChevronDown className="h-5 w-5" />
      </button>
    </div>
  );
}
