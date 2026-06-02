"use client";

import { useState, useEffect } from "react";
import { Columns2, Loader2, ChevronRight, Trash2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

interface CompareRecord {
  id: number;
  query: string;
  models: string[];
  slug: string;
  created_at: string;
}

export default function CompareHistory() {
  const { t, language } = useI18n();
  const [records, setRecords] = useState<CompareRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const loadRecords = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch("/api/compare/records", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setRecords(Array.isArray(data) ? data : []);
      }
    } catch {} finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const res = await fetch(`/api/compare/record/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setRecords((prev) => prev.filter((r) => r.id !== id));
      }
    } catch {}
  };

  useEffect(() => {
    if (open) loadRecords();
  }, [open]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg border border-dashed border-surface-border text-sm text-text-secondary hover:text-text-primary hover:border-brand/50 hover:bg-surface-card transition-all"
      >
        <Columns2 className="w-4 h-4" />
        <span>{t("compare.history.title")}</span>
        <ChevronRight className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-90")} />
      </button>

      {open && (
        <div className="mt-2 max-h-[300px] overflow-y-auto space-y-1 rounded-lg border border-surface-border bg-surface-card p-1">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" />
            </div>
          ) : records.length === 0 ? (
            <div className="py-6 text-center text-xs text-text-tertiary">
              {t("compare.history.empty")}
            </div>
          ) : (
            records.map((record) => (
              <div
                key={record.id}
                className="group flex items-center gap-2 px-2.5 py-2 rounded-md hover:bg-surface-elevated transition-colors"
              >
                <a
                  href={`/share?slug=${record.slug}&type=compare`}
                  className="flex-1 min-w-0"
                >
                  <p className="text-sm text-text-primary truncate">{record.query}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-[10px] text-text-tertiary">
                      {t("compare.history.modelCount", { count: String(record.models.length) })}
                    </span>
                    <span className="text-[10px] text-text-tertiary">·</span>
                    <span className="text-[10px] text-text-tertiary">
                      {new Date(record.created_at).toLocaleDateString(language)}
                    </span>
                  </div>
                </a>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <a
                    href={`/share?slug=${record.slug}&type=compare`}
                    className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
                    title={t("compare.history.view")}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <button
                    onClick={() => handleDelete(record.id)}
                    className="p-1 rounded text-text-tertiary hover:text-red-400 hover:bg-surface-card transition-colors"
                    title={t("chat.action.delete")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
