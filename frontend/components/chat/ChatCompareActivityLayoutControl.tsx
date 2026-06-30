"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type CompareActivityLayout = "inline" | "split" | "dock";

const STORAGE_KEY = "ai-space:chat:compare-activity-layout";

const OPTIONS: Array<{
  value: CompareActivityLayout;
  title: string;
  badge: string;
  description: string;
}> = [
  {
    value: "inline",
    title: "列内展开",
    badge: "推荐",
    description: "保留双列宽度，思考与来源在当前模型下方展开。",
  },
  {
    value: "split",
    title: "列内侧栏",
    badge: "大屏",
    description: "当前列内并排查看正文和思考来源，适合大屏深读。",
  },
  {
    value: "dock",
    title: "右侧第三栏",
    badge: "超宽屏",
    description: "像工作台一样在右侧固定展示当前列的思考与来源。",
  },
];

function readLayout(): CompareActivityLayout {
  if (typeof window === "undefined") return "inline";
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === "split" || value === "dock" || value === "inline" ? value : "inline";
}

export function useCompareActivityLayout() {
  const [layout, setLayoutState] = useState<CompareActivityLayout>(() => readLayout());
  useEffect(() => {
    setLayoutState(readLayout());
  }, []);
  const setLayout = (value: CompareActivityLayout) => {
    setLayoutState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {}
  };
  return [layout, setLayout] as const;
}

function LayoutPreview({ value, active }: { value: CompareActivityLayout; active: boolean }) {
  const pane = "rounded-[3px] border border-current/35 bg-current/10";
  const activity = cn("rounded-[3px] border", active ? "border-brand bg-brand/30" : "border-current/35 bg-current/20");
  if (value === "dock") {
    return (
      <div className="grid h-9 grid-cols-[1fr_1fr_0.6fr] gap-1 text-current">
        <div className={pane}><div className="m-1 h-2 rounded-sm bg-current/25" /><div className="mx-1 h-1.5 rounded-sm bg-current/15" /></div>
        <div className={pane}><div className="m-1 h-2 rounded-sm bg-current/25" /><div className="mx-1 h-1.5 rounded-sm bg-current/15" /></div>
        <div className={activity}><div className="m-1 h-1.5 rounded-sm bg-current/30" /><div className="mx-1 h-1 rounded-sm bg-current/20" /></div>
      </div>
    );
  }
  if (value === "split") {
    return (
      <div className="grid h-9 grid-cols-2 gap-1 text-current">
        <div className="grid grid-cols-[1fr_0.55fr] gap-1 rounded-[3px] border border-current/35 p-0.5">
          <div><div className="mt-0.5 h-2 rounded-sm bg-current/25" /><div className="mt-1 h-1.5 rounded-sm bg-current/15" /></div>
          <div className={activity} />
        </div>
        <div className={pane}><div className="m-1 h-2 rounded-sm bg-current/25" /><div className="mx-1 h-1.5 rounded-sm bg-current/15" /></div>
      </div>
    );
  }
  return (
    <div className="grid h-9 grid-cols-2 gap-1 text-current">
      <div className="rounded-[3px] border border-current/35 p-0.5">
        <div className="h-2 rounded-sm bg-current/25" />
        <div className="mt-1 h-1.5 rounded-sm bg-current/15" />
        <div className={cn("mt-1 h-2", activity)} />
      </div>
      <div className={pane}><div className="m-1 h-2 rounded-sm bg-current/25" /><div className="mx-1 h-1.5 rounded-sm bg-current/15" /></div>
    </div>
  );
}

export default function ChatCompareActivityLayoutControl({
  value,
  onChange,
}: {
  value: CompareActivityLayout;
  onChange: (value: CompareActivityLayout) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-surface-border/70 bg-surface-card/55 px-2 py-1.5" data-chat-compare-activity-layout="true">
      <span className="hidden text-xs font-medium text-text-tertiary sm:inline">思考与来源</span>
      <div className="flex gap-1">
        {OPTIONS.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              title={`${option.title} · ${option.description}`}
              aria-label={`${option.title}，${option.description}`}
              onClick={() => onChange(option.value)}
              className={cn(
                "group w-24 rounded-xl border px-2 py-1.5 text-left transition-all",
                active
                  ? "border-brand/45 bg-brand/10 text-text-primary shadow-sm"
                  : "border-transparent text-text-tertiary hover:border-surface-border hover:bg-surface-elevated hover:text-text-primary"
              )}
            >
              <LayoutPreview value={option.value} active={active} />
              <div className="mt-1 flex items-center justify-between gap-1">
                <span className="truncate text-[11px] font-medium">{option.title}</span>
                <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[9px]", active ? "bg-brand/15 text-brand" : "bg-surface-card text-text-tertiary")}>{option.badge}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
