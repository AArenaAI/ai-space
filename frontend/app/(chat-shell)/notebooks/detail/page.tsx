"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, BookOpen, FileText, Loader2, Plus, Trash2, UploadCloud, AlertCircle, CheckCircle2, Clock3, Check } from "lucide-react";
import { toast } from "sonner";
import ChatInterface from "@/components/chat/ChatInterface";
import { MODELS } from "@/hooks/useChat";
import { addNotebookFile, fetchNotebook, removeNotebookFile, updateNotebook } from "@/lib/notebookApi";
import { normalizeNotebookError, showNotebookError, uploadNotebookSourceFile } from "@/lib/notebookErrors";
import type { Notebook, NotebookFile } from "@/lib/notebookTypes";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function currentWorkspaceId(): string | null {
  return localStorage.getItem("current-workspace");
}

function formatSize(bytes?: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function reconcileSelectedFileIds(previous: number[], files: NotebookFile[]) {
  const available = new Set(files.map((file) => file.file_id));
  if (previous.length === 0) return files.map((file) => file.file_id);
  const next = previous.filter((id) => available.has(id));
  return next.length === 0 && files.length > 0 ? files.map((file) => file.file_id) : next;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type Translate = (key: string, params?: Record<string, string>) => string;

function isNotebookFileReady(file: NotebookFile) {
  const parse = file.file.parse_status;
  const embed = file.file.embedding_status;
  return parse === "done" && (embed === "done" || embed === "skipped");
}

function isNotebookFileProcessing(file: NotebookFile) {
  const parse = file.file.parse_status;
  const embed = file.file.embedding_status;
  if (parse === "error" || parse === "unsupported" || embed === "error") return false;
  return !isNotebookFileReady(file);
}

function statusMeta(file: NotebookFile, t: Translate) {
  const parse = file.file.parse_status;
  const embed = file.file.embedding_status;
  if (parse === "error") return { label: t("notebook.statusParseFailed"), icon: AlertCircle, className: "text-red-500 bg-red-500/10 border-red-500/20" };
  if (parse === "unsupported") return { label: t("notebook.statusUnsupported"), icon: AlertCircle, className: "text-text-tertiary bg-surface-hover border-surface-border" };
  if (parse === "done" && embed === "error") return { label: t("notebook.statusIndexFailed"), icon: AlertCircle, className: "text-amber-600 bg-amber-500/10 border-amber-500/20 dark:text-amber-300" };
  if (isNotebookFileReady(file)) return { label: t("notebook.statusReady"), icon: CheckCircle2, className: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" };
  if (parse === "done") return { label: t("notebook.statusIndexing"), icon: Clock3, className: "text-amber-500 bg-amber-500/10 border-amber-500/20" };
  return { label: t("notebook.statusProcessing"), icon: Clock3, className: "text-amber-500 bg-amber-500/10 border-amber-500/20" };
}

function statusDetail(file: NotebookFile, t: Translate) {
  const parse = file.file.parse_status;
  const embed = file.file.embedding_status;
  if (parse === "error") return file.file.error_message || t("notebook.parseFailureHint");
  if (parse === "done" && embed === "error") return t("notebook.indexFailureHint");
  return null;
}

function NotebookDetailContent() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const notebookId = Number(searchParams.get("notebook_id") || searchParams.get("id"));
  const conversationId = searchParams.get("conversation_id") ? Number(searchParams.get("conversation_id")) : undefined;
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [files, setFiles] = useState<NotebookFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<number[]>([]);
  const [sourcesWidth, setSourcesWidth] = useState(340);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (!notebookId) { setLoading(false); return; }
    setLoading(true);
    try {
      const data = await fetchNotebook(notebookId);
      setNotebook(data.notebook);
      const nextFiles = data.files || [];
      setFiles(nextFiles);
      setSelectedFileIds((prev) => reconcileSelectedFileIds(prev, nextFiles));
      setPageError(null);
    } catch (error) {
      const normalized = showNotebookError(error, t("notebook.loadFailed"));
      setPageError(normalized.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [notebookId]);

  const readyCount = useMemo(() => files.filter(isNotebookFileReady).length, [files]);

  const hasProcessingFiles = useMemo(() => files.some(isNotebookFileProcessing), [files]);

  const selectedSourceText = useMemo(() => (
    t("notebook.selectedSources")
      .replace("{selected}", String(selectedFileIds.length))
      .replace("{total}", String(files.length))
  ), [files.length, selectedFileIds.length, t]);

  const toggleSource = (fileId: number) => {
    setSelectedFileIds((prev) => {
      if (prev.includes(fileId)) return prev.filter((id) => id !== fileId);
      return [...prev, fileId];
    });
  };

  const selectAllSources = () => setSelectedFileIds(files.map((file) => file.file_id));

  useEffect(() => {
    if (!hasProcessingFiles || !notebookId) return;
    const timer = window.setInterval(() => {
      fetchNotebook(notebookId)
        .then((data) => {
          setNotebook(data.notebook);
          const nextFiles = data.files || [];
          setFiles(nextFiles);
          setSelectedFileIds((prev) => reconcileSelectedFileIds(prev, nextFiles));
        })
        .catch((error) => {
          const normalized = normalizeNotebookError(error, t("notebook.loadFailed"));
          setPageError(normalized.message);
        });
    }, 3500);
    return () => window.clearInterval(timer);
  }, [hasProcessingFiles, notebookId, t]);

  const handleUpload = async (selected: FileList | File[] | null) => {
    const selectedFiles = Array.from(selected || []);
    if (!selectedFiles.length || !notebookId) return;
    setUploading(true);
    setPageError(null);
    try {
      const next: NotebookFile[] = [];
      const failures: string[] = [];
      for (const file of selectedFiles) {
        try {
          const publicId = await uploadNotebookSourceFile(file, currentWorkspaceId());
          next.push(await addNotebookFile(notebookId, publicId));
        } catch (error) {
          const normalized = normalizeNotebookError(error, `${file.name} ${t("notebook.uploadFailed")}`);
          failures.push(`${file.name}: ${normalized.message}`);
        }
      }
      if (next.length > 0) {
        setFiles((prev) => [...next, ...prev.filter((old) => !next.some((item) => item.file_id === old.file_id))]);
        setSelectedFileIds((prev) => reconcileSelectedFileIds(prev, [...next, ...files.filter((old) => !next.some((item) => item.file_id === old.file_id))]));
        toast.success(t("notebook.uploadSuccess"));
        window.setTimeout(load, 1200);
      }
      if (failures.length > 0) {
        const message = failures[0];
        const failureMessage = failures.length > 1
          ? t("notebook.uploadAdditionalFailures", { message, count: String(failures.length - 1) })
          : message;
        setPageError(failureMessage);
        toast.error(failureMessage);
      }
    } finally {
      setUploading(false);
      setDragActive(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleRemove = async (file: NotebookFile) => {
    try {
      await removeNotebookFile(notebookId, file.file_id);
      setFiles((prev) => prev.filter((item) => item.id !== file.id));
      setSelectedFileIds((prev) => prev.filter((id) => id !== file.file_id));
      toast.success(t("notebook.removeSuccess"));
    } catch (error) {
      showNotebookError(error, t("notebook.removeFailed"));
    }
  };

  const handleRename = async () => {
    if (!notebook) return;
    const title = window.prompt(t("notebook.renamePrompt"), notebook.title)?.trim();
    if (!title || title === notebook.title) return;
    try {
      const updated = await updateNotebook(notebook.id, { title });
      setNotebook(updated);
      toast.success(t("notebook.renameSuccess"));
    } catch (error) {
      showNotebookError(error, t("notebook.renameFailed"));
    }
  };

  const startSourcesResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sourcesWidth;
    const handlePointerMove = (moveEvent: PointerEvent) => {
      setSourcesWidth(clamp(startWidth + moveEvent.clientX - startX, 260, 520));
    };
    const handlePointerUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  };

  if (loading && !notebook) {
    return <div className="flex h-full items-center justify-center bg-surface"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div>;
  }

  if (!notebookId) {
    return <div className="flex h-full items-center justify-center bg-surface text-sm text-text-secondary">{t("notebook.loadFailed")}</div>;
  }

  return (
    <div className="flex h-full min-h-0 bg-surface text-text-primary">
      <aside className="hidden h-full shrink-0 flex-col bg-surface-elevated/80 lg:flex" style={{ width: sourcesWidth }}>
        <div className="border-b border-surface-border p-5">
          <Link href="/notebooks" className="mb-4 inline-flex items-center gap-2 text-xs font-medium text-text-tertiary transition hover:text-text-primary">
            <ArrowLeft className="h-3.5 w-3.5" />{t("notebook.back")}
          </Link>
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-muted text-brand"><BookOpen className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <button onClick={handleRename} className="block max-w-full truncate text-left text-lg font-semibold text-text-primary hover:text-brand">{notebook?.title || t("notebook.untitled")}</button>
              <p className="mt-1 text-xs text-text-tertiary">{t("notebook.readyCount").replace("{ready}", String(readyCount)).replace("{total}", String(files.length))}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">{t("notebook.sources")}</h2>
              <p className="mt-1 text-xs text-text-tertiary">{t("notebook.sourcesHint")}</p>
            </div>
            <button onClick={() => inputRef.current?.click()} disabled={uploading} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand px-3 text-xs font-medium text-white transition hover:bg-brand-hover disabled:opacity-60">
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}{t("notebook.addSource")}
            </button>
          </div>
          <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} />

          {pageError && (
            <div className="mb-3 flex items-start gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs leading-5 text-red-600 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{pageError}</span>
            </div>
          )}

          {files.length > 0 && (
            <div className="mb-3 flex items-center justify-between rounded-2xl border border-surface-border bg-surface-card px-3 py-2">
              <span className="text-xs text-text-tertiary">{selectedSourceText}</span>
              <button type="button" onClick={selectAllSources} className="text-xs font-medium text-brand transition hover:text-brand-hover">
                {t("notebook.selectAllSources")}
              </button>
            </div>
          )}

          {files.length === 0 ? (
            <button
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => { e.preventDefault(); handleUpload(Array.from(e.dataTransfer.files)); }}
              className={cn(
                "flex min-h-[220px] w-full flex-col items-center justify-center rounded-3xl border border-dashed border-surface-border bg-surface-card px-5 text-center transition hover:border-brand-border hover:bg-brand-muted/40",
                dragActive && "border-brand-border bg-brand-muted/50"
              )}
            >
              <UploadCloud className="mb-4 h-8 w-8 text-brand" />
              <span className="text-sm font-medium text-text-primary">{t("notebook.dropTitle")}</span>
              <span className="mt-2 text-xs leading-5 text-text-tertiary">{t("notebook.dropDesc")}</span>
            </button>
          ) : (
            <div
              className={cn("space-y-2.5 rounded-3xl border border-transparent p-0 transition", dragActive && "border-dashed border-brand-border bg-brand-muted/20 p-2")}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => { e.preventDefault(); handleUpload(Array.from(e.dataTransfer.files)); }}
            >
              {dragActive && <div className="rounded-2xl border border-dashed border-brand-border py-3 text-center text-xs font-medium text-brand">{t("notebook.dropTitle")}</div>}
              {files.map((file) => {
                const meta = statusMeta(file, t);
                const Icon = meta.icon;
                const detail = statusDetail(file, t);
                const selected = selectedFileIds.includes(file.file_id);
                return (
                  <div key={file.id} className={cn("group rounded-2xl border bg-surface-card p-3 transition hover:border-brand-border", selected ? "border-brand-border" : "border-surface-border opacity-70")}>
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => toggleSource(file.file_id)}
                        className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition", selected ? "border-brand bg-brand text-white" : "border-surface-border text-transparent hover:border-brand-border")}
                        aria-label={selected ? "selected" : "unselected"}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-muted text-brand"><FileText className="h-4 w-4" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-text-primary">{file.file.filename}</div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-text-tertiary"><span>{formatSize(file.file.size)}</span><span>·</span><span>{file.file.mime_type || "file"}</span></div>
                      </div>
                      <button onClick={() => handleRemove(file)} className="rounded-lg p-1.5 text-text-tertiary opacity-0 transition hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                    <div className={cn("mt-3 inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium", meta.className)}><Icon className="h-3 w-3" />{meta.label}</div>
                    {detail && <p className="mt-2 line-clamp-2 text-xs text-amber-600 dark:text-amber-300">{detail}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("notebook.resizeSources")}
        title={t("notebook.resizeSources")}
        onPointerDown={startSourcesResize}
        className="group hidden h-full w-2 shrink-0 cursor-col-resize items-stretch justify-center bg-surface-elevated/80 lg:flex"
      >
        <div className="h-full w-px bg-surface-border transition group-hover:w-0.5 group-hover:bg-brand/60" />
      </div>

      <section className="min-w-0 flex-1">
        <ChatInterface
          conversationId={conversationId}
          notebookId={notebookId}
          notebookTitle={notebook?.title}
          notebookFileCount={files.length}
          notebookFileIds={selectedFileIds}
          models={MODELS}
          welcomeTitle={notebook?.title || t("notebook.chatWelcomeTitle")}
          welcomeSubtitle={t("notebook.chatWelcomeSubtitle")}
          welcomeExamples={[
            { title: t("notebook.exampleSummary"), desc: t("notebook.exampleSummaryDesc"), prompt: t("notebook.exampleSummaryPrompt") },
            { title: t("notebook.exampleFaq"), desc: t("notebook.exampleFaqDesc"), prompt: t("notebook.exampleFaqPrompt") },
            { title: t("notebook.exampleCompare"), desc: t("notebook.exampleCompareDesc"), prompt: t("notebook.exampleComparePrompt") },
          ]}
        />
      </section>
    </div>
  );
}

export default function NotebookDetailPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center bg-surface"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div>}>
      <NotebookDetailContent />
    </Suspense>
  );
}
