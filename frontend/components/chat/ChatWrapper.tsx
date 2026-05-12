"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";

function ChatSkeleton() {
  return (
    <div className="flex flex-col h-full bg-surface items-center justify-center">
      <div className="animate-pulse text-text-tertiary text-sm">加载中...</div>
    </div>
  );
}

const ChatContent = dynamic(() => import("./ChatContent"), {
  ssr: false,
  loading: () => <ChatSkeleton />,
});

export default function ChatWrapper() {
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <ChatContent />
    </Suspense>
  );
}
