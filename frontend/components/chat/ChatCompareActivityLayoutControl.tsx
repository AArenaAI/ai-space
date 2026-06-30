"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, PanelTopOpen, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";

export type CompareActivityLayout = "inline" | "split";

const STORAGE_KEY = "ai-space:chat:compare-activity-layout";

const OPTIONS: Array<{
  value: CompareActivityLayout;
  title: string;
  badge: string;
  description: string;
  icon: typeof Rows3;
}> = [
  {
    value: "inline",
    title: "列内展开",
    badge: "推荐",
    description: "在已思考下方展开，左右两列都能各自打开。",
    icon: Rows3,
  },
  {
    value: "split",
    title: "列内侧栏",
    badge: "大屏",
    description: "当前列内正文与思考来源并排查看。",
    icon: PanelTopOpen,
  },
];

function readLayout(): CompareActivityLayout {
  if (typeof window === "undefined") return "inline";
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === "split" || value === "inline" ? value : "inline";
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

export default function ChatCompareActivityLayoutControl({
  value,
  onChange,
}: {
  value: CompareActivityLayout;
  onChange: (value: CompareActivityLayout) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeOption = OPTIONS.find((option) => option.value === value) || OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative" data-chat-compare-activity-layout="true">
      <button
        type="button"
        onClick={() => setOpen((next) => !next)}
        className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-surface-border/65 bg-surface-card/70 px-2.5 text-xs font-medium text-text-secondary shadow-sm transition-colors hover:bg-surface-elevated hover:text-text-primary"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`思考与来源显示：${activeOption.title}`}
      >
        <span>显示</span>
        <span className="hidden text-text-tertiary sm:inline">· {activeOption.title}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-text-tertiary transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-surface-border/75 bg-surface-elevated p-2 text-left shadow-xl animate-fade-in">
          <div className="px-2 pb-2 pt-1 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">思考与来源显示</div>
          <div className="space-y-1">
            {OPTIONS.map((option) => {
              const active = option.value === value;
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                    active ? "bg-surface-card text-text-primary" : "text-text-secondary hover:bg-surface-card/70 hover:text-text-primary"
                  )}
                >
                  <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", active ? "bg-brand/12 text-brand" : "bg-surface-card text-text-tertiary")}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {option.title}
                      <span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", active ? "bg-brand/12 text-brand" : "bg-surface-card text-text-tertiary")}>{option.badge}</span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-text-tertiary">{option.description}</span>
                  </span>
                  {active && <Check className="mt-1 h-4 w-4 shrink-0 text-brand" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
