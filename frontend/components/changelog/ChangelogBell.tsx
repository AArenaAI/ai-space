"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell, X, CheckCircle, ExternalLink, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface Changelog {
  id: number;
  version: string;
  title: string;
  content: string;
  category: "feature" | "fix" | "optimize" | "breaking";
  is_published: boolean;
  published_at?: string;
  is_pinned: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  feature: "新功能",
  fix: "修复",
  optimize: "优化",
  breaking: "重大变更",
};

const CATEGORY_COLORS: Record<string, string> = {
  feature: "bg-emerald-50 text-emerald-700 border-emerald-200",
  fix: "bg-red-50 text-red-700 border-red-200",
  optimize: "bg-blue-50 text-blue-700 border-blue-200",
  breaking: "bg-amber-50 text-amber-700 border-amber-200",
};

export function ChangelogBell() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [changelogs, setChangelogs] = useState<Changelog[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch("/api/changelogs/unread-count");
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.count || 0);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchChangelogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/changelogs?page=1&page_size=20");
      if (res.ok) {
        const data = await res.json();
        setChangelogs(data.changelogs || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUnreadCount();
    // 每 5 分钟刷新一次未读数
    const interval = setInterval(fetchUnreadCount, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  const handleOpen = () => {
    setOpen(true);
    fetchChangelogs();
    // 标记全部已读
    fetch("/api/changelogs/read-all", { method: "POST" }).then(() => {
      setUnreadCount(0);
    });
  };

  return (
    <div className="relative">
      <button
        onClick={handleOpen}
        className={cn(
          "relative rounded-xl p-2 transition-colors",
          open ? "bg-brand/10 text-brand" : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
        )}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-96 rounded-2xl border border-surface-border bg-surface-elevated shadow-lg">
            <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
              <h3 className="text-sm font-semibold text-text-primary">产品更新</h3>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-text-tertiary hover:bg-surface-card hover:text-text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[28rem] overflow-y-auto">
              {loading ? (
                <div className="px-4 py-8 text-center text-sm text-text-tertiary">加载中...</div>
              ) : changelogs.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-text-tertiary">
                  暂无更新日志
                </div>
              ) : (
                <div className="divide-y divide-surface-border">
                  {changelogs.map((cl) => (
                    <div key={cl.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono text-text-tertiary">{cl.version}</span>
                            <span
                              className={cn(
                                "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                                CATEGORY_COLORS[cl.category] || "bg-gray-50 text-gray-700 border-gray-200"
                              )}
                            >
                              {CATEGORY_LABELS[cl.category] || cl.category}
                            </span>
                            {cl.is_pinned && <Pin className="h-3 w-3 text-brand" />}
                          </div>
                          <h4 className="text-sm font-medium text-text-primary">{cl.title}</h4>
                          <p className="mt-1 text-xs text-text-tertiary line-clamp-3 whitespace-pre-wrap">
                            {cl.content}
                          </p>
                          {cl.published_at && (
                            <p className="mt-1 text-[10px] text-text-tertiary">
                              {new Date(cl.published_at).toLocaleDateString("zh-CN")}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-surface-border px-4 py-2">
              <Link
                href="/changelogs"
                onClick={() => setOpen(false)}
                className="flex items-center justify-center gap-1 text-xs text-text-secondary hover:text-brand"
              >
                查看全部更新
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
