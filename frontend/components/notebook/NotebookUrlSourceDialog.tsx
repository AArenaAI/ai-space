"use client";

import { FormEvent, useEffect, useState } from "react";
import { ChevronDown, Clipboard, Globe, Link2, Loader2, Search, UploadCloud, X, Zap } from "lucide-react";
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
  const [url, setUrl] = useState("");
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    if (!open) {
      setUrl("");
      setDragActive(false);
    }
  }, [open]);

  if (!open) return null;

  const busy = loading;
  const progress = Math.max(0, Math.min(100, sourceLimit > 0 ? (sourceCount / sourceLimit) * 100 : 0));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextUrl = url.trim();
    if (!nextUrl || busy) return;
    await onSubmit(nextUrl);
  };

  const handleUpload = (files: FileList | File[] | null) => {
    const selectedFiles = files ? Array.from(files) : [];
    if (busy || selectedFiles.length === 0) return;
    const unsupported = selectedFiles.filter((f) => !isNotebookSourceFileSupported(f));
    if (unsupported.length > 0) {
      const names = unsupported.map((f) => f.name).join(", ");
      toast.error(`暂不支持以下文件类型：${names}，请换用支持的资料文件。`);
      return;
    }
    onClose();
    void onUploadFiles?.(selectedFiles);
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

          <div className="px-10 text-center">
            <h3 className="text-xl font-semibold tracking-[-0.02em] text-text-primary">{t("notebook.addSource")}</h3>
            <p className="mt-2 text-sm leading-5 text-text-tertiary">上传文件、粘贴网站链接，或从网络搜索新的资料来源</p>
          </div>

          <div className="mt-6 rounded-[22px] border border-surface-border bg-surface-elevated p-3 shadow-sm">
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={t("notebook.searchNewSources")}
              disabled={busy}
              autoFocus
              className="h-10 w-full rounded-2xl bg-transparent px-2 text-sm text-text-primary outline-none placeholder:text-text-tertiary disabled:opacity-60"
            />
            <div className="mt-2 flex items-center gap-2">
              <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-surface-border bg-surface-card px-3 text-xs font-medium text-text-secondary">
                <Globe className="h-3.5 w-3.5" />Web<ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-surface-border bg-surface-card px-3 text-xs font-medium text-text-secondary">
                <Zap className="h-3.5 w-3.5 text-brand" />Fast Research<ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="submit"
                disabled={busy || !url.trim()}
                className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface-card text-text-secondary transition hover:bg-brand hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                title={t("notebook.addUrlSubmit")}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <label
            className={cn(
              "mt-5 flex min-h-[210px] cursor-pointer flex-col items-center justify-center rounded-[24px] border border-dashed border-surface-border bg-surface-elevated/70 px-6 text-center transition",
              dragActive && "border-brand bg-brand-muted/20",
              loading && "cursor-not-allowed opacity-70"
            )}
            onDragOver={(event) => { event.preventDefault(); if (!loading) setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => { event.preventDefault(); setDragActive(false); handleUpload(Array.from(event.dataTransfer.files)); }}
          >
            <input type="file" multiple accept={NOTEBOOK_SOURCE_FILE_ACCEPT} className="hidden" disabled={loading} onChange={(event) => handleUpload(event.target.files)} />
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-card text-brand shadow-sm">
              {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
            </div>
            <div className="mt-4 text-base font-semibold text-text-primary">或拖放文件</div>
            <div className="mt-1 text-sm text-text-tertiary">PDF、Word、Excel、PPT、图片、文本、代码等</div>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-surface-border bg-surface-card px-3 text-xs font-medium text-text-secondary"><UploadCloud className="h-3.5 w-3.5" />上传文件</span>
              <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-surface-border bg-surface-card px-3 text-xs font-medium text-text-secondary"><Link2 className="h-3.5 w-3.5" />网站</span>
              <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-surface-border bg-surface-card px-3 text-xs font-medium text-text-secondary"><Globe className="h-3.5 w-3.5" />云端硬盘</span>
              <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-surface-border bg-surface-card px-3 text-xs font-medium text-text-secondary"><Clipboard className="h-3.5 w-3.5" />复制的文字</span>
            </div>
          </label>

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
