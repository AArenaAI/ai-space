"use client";

import { Suspense } from "react";
import { useI18n } from "@/lib/i18n";
import ChatContent from "./ChatContent";

function ChatSkeleton() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col h-full bg-surface items-center justify-center">
      <div className="animate-pulse text-text-tertiary text-sm">{t("common.loading")}</div>
    </div>
  );
}

export default function ChatWrapper() {
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <ChatContent />
    </Suspense>
  );
}
