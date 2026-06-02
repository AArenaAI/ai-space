"use client";

import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export default function ChatHistoryLoadingState() {
  const { t } = useI18n();
  return (
    <div
      className="flex min-h-[320px] items-start justify-center px-4 pt-24 text-text-tertiary"
      data-testid="chat-history-loading-state"
    >
      <div className="flex items-center gap-2 rounded-full border border-surface-border/60 bg-surface-card/45 px-3 py-2 text-xs shadow-sm backdrop-blur-sm">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>{t("chat.history.loading")}</span>
      </div>
    </div>
  );
}
