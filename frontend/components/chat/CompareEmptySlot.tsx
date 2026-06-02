"use client";

import { useI18n } from "@/lib/i18n";

export default function CompareEmptySlot({ isSingleChat }: { isSingleChat: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="rounded-xl border border-dashed border-surface-border bg-surface-elevated/40 px-3 py-2 text-center text-xs text-text-tertiary">
        {isSingleChat ? t("compare.empty.singleChat") : t("compare.empty.notParticipating")}
      </div>
    </div>
  );
}
