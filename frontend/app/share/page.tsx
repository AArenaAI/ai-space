"use client";

import { Suspense } from "react";
import ShareContent from "@/components/share/ShareContent";

function ShareSkeleton() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <div className="animate-pulse text-text-tertiary text-sm">加载中...</div>
    </div>
  );
}

export default function SharePage() {
  return (
    <Suspense fallback={<ShareSkeleton />}>
      <ShareContent />
    </Suspense>
  );
}
