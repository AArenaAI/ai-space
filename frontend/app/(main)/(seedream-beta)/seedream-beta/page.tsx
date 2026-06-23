"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LegacySeedreamBetaRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const suffix = searchParams?.toString() ?? "";
    router.replace(`/ai-comic${suffix ? `?${suffix}` : ""}`);
  }, [router, searchParams]);

  return null;
}
