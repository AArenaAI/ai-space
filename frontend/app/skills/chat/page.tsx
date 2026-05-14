"use client";

import { Suspense } from "react";
import SkillChatContent from "@/components/skills/SkillChatContent";

function ChatSkeleton() {
  return (
    <div className="flex flex-col h-full bg-surface items-center justify-center">
      <div className="animate-pulse text-text-tertiary text-sm">加载中...</div>
    </div>
  );
}

export default function SkillChatPage() {
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <SkillChatContent />
    </Suspense>
  );
}
