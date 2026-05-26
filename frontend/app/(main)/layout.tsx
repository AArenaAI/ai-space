"use client";

import { Suspense } from "react";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center bg-surface">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          </div>
        }
      >
        {children}
      </Suspense>
    </div>
  );
}
