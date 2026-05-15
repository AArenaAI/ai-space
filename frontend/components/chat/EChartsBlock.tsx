"use client";

import React, { useMemo } from "react";
import dynamic from "next/dynamic";

// 延迟加载，避免 SSR 时访问 DOM
const ReactECharts = dynamic(() => import("echarts-for-react"), {
  ssr: false,
  loading: () => (
    <div className="h-[320px] w-full flex items-center justify-center text-text-tertiary text-sm">
      加载图表中...
    </div>
  ),
});

interface EChartsBlockProps {
  value: string;
}

export default function EChartsBlock({ value }: EChartsBlockProps) {
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
        图表 JSON 解析失败
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
