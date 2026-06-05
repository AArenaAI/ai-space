"use client";

import { FormEvent, useEffect, useState } from "react";
import { Globe, Loader2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface NotebookUrlSourceDialogProps {
  open: boolean;
  loading?: boolean;
  onClose: () => void;
  onSubmit: (url: string) => void | Promise<void>;
}

export function NotebookUrlSourceDialog({ open, loading = false, onClose, onSubmit }: NotebookUrlSourceDialogProps) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!open) setUrl("");
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextUrl = url.trim();
    if (!nextUrl || loading) return;
    await onSubmit(nextUrl);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-3xl border border-surface-border bg-surface-elevated p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-muted text-brand">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text-primary">{t("notebook.addUrlTitle")}</h3>
              <p className="mt-1 text-sm leading-5 text-text-tertiary">{t("notebook.addUrlDesc")}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={loading} className="rounded-xl p-2 text-text-tertiary transition hover:bg-surface-card hover:text-text-primary disabled:opacity-50" aria-label={t("common.cancel")}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="mt-5 block text-xs font-medium text-text-secondary" htmlFor="notebook-url-source">
          {t("notebook.addUrlLabel")}
        </label>
        <input
          id="notebook-url-source"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/article"
          disabled={loading}
          autoFocus
          className="mt-2 h-11 w-full rounded-2xl border border-surface-border bg-surface px-4 text-sm text-text-primary outline-none transition placeholder:text-text-tertiary focus:border-brand-border focus:ring-2 focus:ring-brand/15 disabled:opacity-60"
        />
        <p className="mt-2 text-xs leading-5 text-text-tertiary">{t("notebook.addUrlHint")}</p>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={loading} className="rounded-xl border border-surface-border px-4 py-2 text-sm font-medium text-text-secondary transition hover:bg-surface-card disabled:opacity-50">
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={loading || !url.trim()} className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("notebook.addUrlSubmit")}
          </button>
        </div>
      </form>
    </div>
  );
}
