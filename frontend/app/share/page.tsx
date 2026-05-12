"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";

function ShareSkeleton() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <div className="animate-pulse text-text-tertiary text-sm">加载中...</div>
    </div>
  );
}

const ShareContent = dynamic(() => import("@/components/share/ShareContent"), {
  ssr: false,
  loading: () => <ShareSkeleton />,
});

export default function SharePage() {
  return (
    <Suspense fallback={<ShareSkeleton />}>
      <ShareContent />
    </Suspense>
  );
}
