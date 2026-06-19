"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, Clipboard, Link2, Loader2, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { isNotebookSourceFileSupported, NOTEBOOK_SOURCE_FILE_ACCEPT } from "@/lib/notebookErrors";

interface NotebookUrlSourceDialogProps {
  open: boolean;
  loading?: boolean;
  uploading?: boolean;
  sourceCount?: number;
  sourceLimit?: number;
  onClose: () => void;
  onSubmit: (url: string) => void | Promise<void>;
  onUploadFiles?: (files: FileList | File[] | null) => void | Promise<void>;
}

export function NotebookUrlSourceDialog({
  open,
  loading = false,
  uploading = false,
  sourceCount = 0,
  sourceLimit = 50,
  onClose,
  onSubmit,
  onUploadFiles,
}: NotebookUrlSourceDialogProps) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<"choices" | "url" | "text">("choices");
  const [url, setUrl] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    if (!open) {
      setMode("choices");
      setUrl("");
      setPastedText("");
      setDragActive(false);
    }
  }, [open]);

  if (!open) return null;

  const busy = loading;
  const progress = Math.max(0, Math.min(100, sourceLimit > 0 ? (sourceCount / sourceLimit) * 100 : 0));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === "url") {
      const nextUrl = url.trim();
      if (!nextUrl || busy) return;
      await onSubmit(nextUrl);
      return;
    }
    if (mode === "text") {
      const text = pastedText.trim();
      if (!text || busy) return;
      const filename = `${t("notebook.pastedTextFilename") || "pasted-text"}-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.txt`;
      handleUpload([new File([text], filename, { type: "text/plain;charset=utf-8" })]);
    }
  };

  const handleUpload = (files: FileList | File[] | null) => {
    const selectedFiles = files ? Array.from(files) : [];
    if (busy || selectedFiles.length === 0) return;
    const unsupported = selectedFiles.filter((f) => !isNotebookSourceFileSupported(f));
    if (unsupported.length > 0) {
      const names = unsupported.map((f) => f.name).join(", ");
      toast.error(t("notebook.fileTypeUnsupported", { names }));
      return;
    }
    onClose();
    void onUploadFiles?.(selectedFiles);
  };

  const goBack = () => {
    if (busy) return;
    setMode("choices");
    setUrl("");
    setPastedText("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 backdrop-blur-[2px]">
      <form onSubmit={handleSubmit} className="relative w-full max-w-[680px] overflow-hidden rounded-[28px] border border-surface-border bg-surface-card shadow-2xl">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-br from-brand/14 via-emerald-300/12 to-transparent" />
        <div className="relative px-7 pb-6 pt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="absolute right-4 top-4 rounded-full p-2 text-text-tertiary transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
            aria-label={t("common.cancel")}
          >
            <X className="h-4 w-4" />
          </button>

          {mode !== "choices" && (
            <button
              type="button"
              onClick={goBack}
              disabled={busy}
              className="absolute left-4 top-4 rounded-full p-2 text-text-tertiary transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
              aria-label={t("common.back")}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}

          <div className="px-10 text-center">
            <h3 className="text-xl font-semibold tracking-[-0.02em] text-text-primary">
              {mode === "url" ? t("notebook.websiteTitle") : mode === "text" ? t("notebook.pasteTextTitle") : t("notebook.addSource")}
            </h3>
            <p className="mt-2 text-sm leading-5 text-text-tertiary">
              {mode === "url" ? t("notebook.websiteDesc") : mode === "text" ? t("notebook.pasteTextDesc") : t("notebook.addSourceDesc")}
            </p>
          </div>

          {mode === "url" && (
            <div className="mt-6 space-y-4">
              <textarea
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={t("notebook.websitePlaceholder")}
                disabled={busy}
                autoFocus
                rows={5}
                className="min-h-[150px] w-full resize-y rounded-[18px] border border-brand/50 bg-surface-elevated px-4 py-3 text-sm text-text-primary outline-none transition placeholder:text-text-tertiary focus:border-brand disabled:opacity-60"
              />
              <ul className="space-y-2 pl-5 text-sm leading-5 text-text-tertiary">
                <li className="list-disc">{t("notebook.websiteHintMultiple")}</li>
                <li className="list-disc">{t("notebook.websiteHintVisibleText")}</li>
                <li className="list-disc">{t("notebook.websiteHintPaid")}</li>
              </ul>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={busy || !url.trim()}
                  className="inline-flex h-10 items-center justify-center rounded-full bg-brand px-5 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-text-tertiary"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t("notebook.insert")}
                </button>
              </div>
            </div>
          )}

          {mode === "text" && (
            <div className="mt-6 space-y-4">
              <textarea
                value={pastedText}
                onChange={(event) => setPastedText(event.target.value)}
                placeholder={t("notebook.pasteTextPlaceholder")}
                disabled={busy}
                autoFocus
                rows={9}
                className="min-h-[240px] w-full resize-y rounded-[18px] border border-brand/50 bg-surface-elevated px-4 py-3 text-sm text-text-primary outline-none transition placeholder:text-text-tertiary focus:border-brand disabled:opacity-60"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={busy || !pastedText.trim()}
                  className="inline-flex h-10 items-center justify-center rounded-full bg-brand px-5 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-text-tertiary"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : t("notebook.insert")}
                </button>
              </div>
            </div>
          )}

          {mode === "choices" && (
            <>
              <div
                className={cn(
                  "mt-6 flex min-h-[210px] flex-col items-center justify-center rounded-[24px] border border-dashed border-surface-border bg-surface-elevated/70 px-6 text-center transition",
                  dragActive && "border-brand bg-brand-muted/20",
                  loading && "opacity-70"
                )}
                onDragOver={(event) => { event.preventDefault(); if (!loading) setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(event) => { event.preventDefault(); setDragActive(false); handleUpload(Array.from(event.dataTransfer.files)); }}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-card text-brand shadow-sm">
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
                </div>
                <div className="mt-4 text-base font-semibold text-text-primary">{t("notebook.dragDropFiles")}</div>
                <div className="mt-1 text-sm text-text-tertiary">{t("notebook.supportedFormats")}</div>
              </div>

              <input ref={fileInputRef} type="file" multiple accept={NOTEBOOK_SOURCE_FILE_ACCEPT} className="hidden" disabled={loading} onChange={(event) => handleUpload(event.target.files)} />
              <div className="mt-5 grid gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-surface-border bg-surface-card px-4 text-sm font-medium text-text-secondary transition hover:border-brand/40 hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <UploadCloud className="h-4 w-4" />{t("notebook.uploadFile")}
                </button>
                <button
                  type="button"
                  onClick={() => setMode("url")}
                  disabled={busy}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-surface-border bg-surface-card px-4 text-sm font-medium text-text-secondary transition hover:border-brand/40 hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Link2 className="h-4 w-4" />{t("notebook.website")}
                </button>
                <button
                  type="button"
                  onClick={() => setMode("text")}
                  disabled={busy}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-surface-border bg-surface-card px-4 text-sm font-medium text-text-secondary transition hover:border-brand/40 hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Clipboard className="h-4 w-4" />{t("notebook.copiedText")}
                </button>
              </div>
            </>
          )}

          <div className="mt-5 flex items-center gap-3 text-xs text-text-tertiary">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-hover">
              <div className="h-full rounded-full bg-brand" style={{ width: `${progress}%` }} />
            </div>
            <span className="font-medium text-text-secondary">{sourceCount}/{sourceLimit}</span>
          </div>
        </div>
      </form>
    </div>
  );
}
