"use client";

import React, { useMemo } from "react";
import dynamic from "next/dynamic";
import { useI18n } from "@/lib/i18n";

// 延迟加载，避免 SSR 时访问 DOM
function EChartsLoading() {
  const { t } = useI18n();
  return (
    <div className="h-[320px] w-full flex items-center justify-center text-text-tertiary text-sm">
      {t("chat.chart.loading")}
    </div>
  );
}

const ReactECharts = dynamic(() => import("echarts-for-react"), {
  ssr: false,
  loading: () => <EChartsLoading />,
});

interface EChartsBlockProps {
  value: string;
}

export default function EChartsBlock({ value }: EChartsBlockProps) {
  const { t } = useI18n();
  const option = useMemo(() => {
    try {
      return JSON.parse(value.trim());
    } catch {
      return null;
    }
  }, [value]);

  if (!option) {
    return (
      <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">
        {t("chat.chart.parseFailed")}
      </div>
    );
  }

  return (
    <div className="my-4 rounded-xl border border-surface-border bg-surface-card overflow-hidden">
      <ReactECharts
        option={option}
        style={{ height: 320, width: "100%" }}
        opts={{ renderer: "canvas" }}
        notMerge={true}
        lazyUpdate={true}
      />
    </div>
  );
}
