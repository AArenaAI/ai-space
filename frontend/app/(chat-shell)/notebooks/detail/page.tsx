"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, BookOpen, FileText, Globe, Loader2, Plus, Trash2, UploadCloud, AlertCircle, CheckCircle2, Clock3, Check } from "lucide-react";
import { toast } from "sonner";
import ChatInterface from "@/components/chat/ChatInterface";
import { NotebookSourcePreviewDrawer } from "@/components/notebook/NotebookSourcePreviewDrawer";
import { NotebookStudioPanel, type NotebookStudioActionId, type NotebookStudioArtifact, type NotebookStudioMindmapEdge, type NotebookStudioMindmapNode, type NotebookStudioSource, type NotebookStudioTableRow, type NotebookStudioTextSection } from "@/components/notebook/NotebookStudioPanel";
import { NotebookUrlSourceDialog } from "@/components/notebook/NotebookUrlSourceDialog";
import { MODELS } from "@/hooks/useChat";
import { addNotebookFile, addNotebookUrlSource, deleteNotebookArtifact, fetchNotebook, fetchNotebookArtifacts, fetchNotebookFileContent, generateNotebookArtifact, removeNotebookFile, updateNotebook, updateNotebookArtifact } from "@/lib/notebookApi";
import { normalizeNotebookError, showNotebookError, uploadNotebookSourceFile } from "@/lib/notebookErrors";
import type { Notebook, NotebookArtifact as PersistedNotebookArtifact, NotebookFile, NotebookFileContent } from "@/lib/notebookTypes";
import { useI18n, type LanguageCode } from "@/lib/i18n";
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

function notebookSelectionStorageKey(notebookId: number) {
  return `notebook:${notebookId}:selected-file-ids`;
}

function readStoredSelectedFileIds(notebookId: number) {
  try {
    const raw = localStorage.getItem(notebookSelectionStorageKey(notebookId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === "number") : null;
  } catch {
    return null;
  }
}

function reconcileSelectedFileIds(previous: number[], files: NotebookFile[]) {
  const available = new Set(files.map((file) => file.file_id));
  return previous.filter((id) => available.has(id));
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

function toStudioArtifact(artifact: PersistedNotebookArtifact): NotebookStudioArtifact | null {
  const content = artifact.content as { rows?: NotebookStudioTableRow[]; sections?: NotebookStudioTextSection[]; nodes?: NotebookStudioMindmapNode[]; edges?: NotebookStudioMindmapEdge[] } | null;
  const base = {
    id: String(artifact.id),
    title: artifact.title,
    subtitle: artifact.subtitle || "",
    createdAt: artifact.created_at,
    sourceCount: artifact.source_count || 0,
  };
  if (artifact.type === "data-table") {
    return { ...base, type: "table", rows: Array.isArray(content?.rows) ? content.rows : [] };
  }
  if (artifact.type === "summary" || artifact.type === "faq" || artifact.type === "briefing") {
    return { ...base, type: artifact.type, sections: Array.isArray(content?.sections) ? content.sections : [] };
  }
  if (artifact.type === "mindmap") {
    return {
      ...base,
      type: "mindmap",
      nodes: Array.isArray(content?.nodes) ? content.nodes : [],
      edges: Array.isArray(content?.edges) ? content.edges : [],
    };
  }
  return null;
}

function safeFilename(value: string) {
  return (value || "notebook-output").replace(/[\\/:*?\"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "notebook-output";
}

function artifactToMarkdown(artifact: NotebookStudioArtifact) {
  const lines = [`# ${artifact.title}`, "", artifact.subtitle, ""].filter((line) => line !== undefined);
  switch (artifact.type) {
    case "table":
      lines.push("| 功能模块 / 来源 | 具体能力 / 内容摘要 | 状态 | 核心技术 / 处理方式 | 业务价值 | 来源 |");
      lines.push("| --- | --- | --- | --- | --- | --- |");
      artifact.rows.forEach((row) => {
        lines.push(`| ${row.module} | ${row.capability} | ${row.status} | ${row.implementation} | ${row.value} | ${row.source} |`);
      });
      break;
    case "mindmap":
      lines.push("## 节点", "");
      artifact.nodes.forEach((node) => {
        lines.push(`- ${node.label}${node.source ? ` ${node.source}` : ""}${node.summary ? `：${node.summary}` : ""}`);
      });
      if (artifact.edges.length) {
        lines.push("", "## 关系", "");
        artifact.edges.forEach((edge) => lines.push(`- ${edge.from} → ${edge.to}${edge.label ? `：${edge.label}` : ""}`));
      }
      break;
    default:
      artifact.sections.forEach((section) => {
        lines.push(`## ${section.heading}`);
        if (section.body) lines.push("", section.body);
        if (section.bullets?.length) {
          lines.push("");
          section.bullets.forEach((bullet) => lines.push(`- ${bullet}`));
        }
        lines.push("");
      });
  }
  return lines.join("\n").trim() + "\n";
}

function artifactToCsv(artifact: NotebookStudioArtifact) {
  if (artifact.type !== "table") return artifactToMarkdown(artifact);
  const escape = (value: string) => `"${String(value || "").replace(/"/g, '""')}"`;
  const rows = [
    ["功能模块 / 来源", "具体能力 / 内容摘要", "状态", "核心技术 / 处理方式", "业务价值", "来源"],
    ...artifact.rows.map((row) => [row.module, row.capability, row.status, row.implementation, row.value, row.source]),
  ];
  return rows.map((row) => row.map(escape).join(",")).join("\n") + "\n";
}

function downloadTextFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function NotebookDetailContent() {
  const { t, language } = useI18n();
  const searchParams = useSearchParams();
  const notebookId = Number(searchParams.get("notebook_id") || searchParams.get("id"));
  const conversationId = searchParams.get("conversation_id") ? Number(searchParams.get("conversation_id")) : undefined;
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [files, setFiles] = useState<NotebookFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [addingUrl, setAddingUrl] = useState(false);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<number[]>([]);
  const [sourcesWidth, setSourcesWidth] = useState(340);
  const [studioWidth, setStudioWidth] = useState(390);
  const [previewSource, setPreviewSource] = useState<NotebookFile | null>(null);
  const [previewData, setPreviewData] = useState<NotebookFileContent | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [studioArtifacts, setStudioArtifacts] = useState<NotebookStudioArtifact[]>([]);
  const [activeStudioArtifactId, setActiveStudioArtifactId] = useState<string | null>(null);
  const [generatingStudioType, setGeneratingStudioType] = useState<NotebookStudioActionId | null>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectionInitializedRef = useRef(false);
  const loadStudioArtifacts = async () => {
    if (!notebookId) return;
    try {
      const persisted = await fetchNotebookArtifacts(notebookId);
      const next = persisted.map(toStudioArtifact).filter((item): item is NotebookStudioArtifact => Boolean(item));
      setStudioArtifacts(next);
      setActiveStudioArtifactId((prev) => (prev && next.some((item) => item.id === prev) ? prev : null));
    } catch (error) {
      showNotebookError(error, t("notebook.studio.loadFailed"));
    }
  };

  const load = async () => {
    if (!notebookId) { setLoading(false); return; }
    setLoading(true);
    try {
      const data = await fetchNotebook(notebookId);
      setNotebook(data.notebook);
      const nextFiles = data.files || [];
      setFiles(nextFiles);
      setSelectedFileIds((prev) => {
        const baseline = selectionInitializedRef.current ? prev : (readStoredSelectedFileIds(notebookId) || []);
        selectionInitializedRef.current = true;
        return reconcileSelectedFileIds(baseline, nextFiles);
      });
      setPageError(null);
    } catch (error) {
      const normalized = showNotebookError(error, t("notebook.loadFailed"));
      setPageError(normalized.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    selectionInitializedRef.current = false;
    setSelectedFileIds([]);
    load();
    loadStudioArtifacts();
  }, [notebookId]);

  useEffect(() => {
    if (!notebookId || !selectionInitializedRef.current) return;
    localStorage.setItem(notebookSelectionStorageKey(notebookId), JSON.stringify(selectedFileIds));
  }, [notebookId, selectedFileIds]);

  const readyCount = useMemo(() => files.filter(isNotebookFileReady).length, [files]);

  const studioSourceFiles = useMemo<NotebookStudioSource[]>(() => files.map((file) => ({
    id: file.file_id,
    filename: file.file.filename,
    mimeType: file.file.mime_type,
  })), [files]);

  const hasProcessingFiles = useMemo(() => files.some(isNotebookFileProcessing), [files]);

  const selectedSourceText = useMemo(() => (
    t("notebook.selectedSources")
      .replace("{selected}", String(selectedFileIds.length))
      .replace("{total}", String(files.length))
  ), [files.length, selectedFileIds.length, t]);

  const allSourcesSelected = useMemo(() => (
    files.length > 0 && files.every((file) => selectedFileIds.includes(file.file_id))
  ), [files, selectedFileIds]);

  const startPaneResize = (pane: "sources" | "studio", event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startSourcesWidth = sourcesWidth;
    const startStudioWidth = studioWidth;
    const containerWidth = layoutRef.current?.clientWidth || window.innerWidth;
    const minSourcesWidth = 260;
    const maxSourcesWidth = 560;
    const minStudioWidth = 300;
    const maxStudioWidth = 760;
    const minCenterWidth = 420;
    const handleSpace = 16;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      if (pane === "sources") {
        const maxByCenter = containerWidth - startStudioWidth - minCenterWidth - handleSpace;
        setSourcesWidth(clamp(startSourcesWidth + deltaX, minSourcesWidth, Math.min(maxSourcesWidth, maxByCenter)));
        return;
      }
      const maxByCenter = containerWidth - startSourcesWidth - minCenterWidth - handleSpace;
      setStudioWidth(clamp(startStudioWidth - deltaX, minStudioWidth, Math.min(maxStudioWidth, maxByCenter)));
    };

    const stopResize = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  };

  const toggleSource = (fileId: number) => {
    setSelectedFileIds((prev) => {
      if (prev.includes(fileId)) return prev.filter((id) => id !== fileId);
      return [...prev, fileId];
    });
  };

  const selectAllSources = () => {
    if (allSourcesSelected) {
      setSelectedFileIds([]);
      return;
    }
    setSelectedFileIds(files.map((file) => file.file_id));
  };

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

  const handleAddUrlSource = async (url: string) => {
    if (!notebookId) return;
    setAddingUrl(true);
    setPageError(null);
    try {
      const next = await addNotebookUrlSource(notebookId, url);
      const nextFiles = [next, ...files.filter((old) => old.file_id !== next.file_id)];
      setFiles(nextFiles);
      setSelectedFileIds((prev) => reconcileSelectedFileIds(prev, nextFiles));
      setUrlDialogOpen(false);
      toast.success(t("notebook.addUrlSuccess"));
      window.setTimeout(load, 1200);
    } catch (error) {
      const normalized = showNotebookError(error, t("notebook.addUrlFailed"));
      setPageError(normalized.message);
    } finally {
      setAddingUrl(false);
    }
  };

  const openPreview = async (file: NotebookFile) => {
    if (!notebookId) return;
    setPreviewSource(file);
    setPreviewData(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const data = await fetchNotebookFileContent(notebookId, file.file_id);
      setPreviewData(data);
      if (data.file) {
        setPreviewSource((current) => current && current.file_id === file.file_id ? { ...current, file: data.file } : current);
        setFiles((prev) => prev.map((item) => item.file_id === file.file_id ? { ...item, file: data.file } : item));
      }
    } catch (error) {
      const normalized = normalizeNotebookError(error, t("notebook.previewLoadFailed"));
      setPreviewError(normalized.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setPreviewSource(null);
    setPreviewData(null);
    setPreviewError(null);
    setPreviewLoading(false);
  };

  const handleRemove = async (file: NotebookFile) => {
    try {
      await removeNotebookFile(notebookId, file.file_id);
      setFiles((prev) => prev.filter((item) => item.id !== file.id));
      setSelectedFileIds((prev) => prev.filter((id) => id !== file.file_id));
      if (previewSource?.id === file.id) closePreview();
      toast.success(t("notebook.removeSuccess"));
    } catch (error) {
      showNotebookError(error, t("notebook.removeFailed"));
    }
  };

  const buildStudioTableRows = (): NotebookStudioTableRow[] => {
    const selected = files.filter((file) => selectedFileIds.includes(file.file_id));
    const scopedFiles = selected.length > 0 ? selected : files;
    if (scopedFiles.length === 0) {
      return [{
        module: t("notebook.studio.tableEmptyModule"),
        capability: t("notebook.studio.tableEmptyCapability"),
        status: t("notebook.studio.tableEmptyStatus"),
        implementation: t("notebook.studio.tableEmptyImplementation"),
        value: t("notebook.studio.tableEmptyValue"),
        source: "—",
      }];
    }

    return scopedFiles.map((file, index) => {
      const ready = isNotebookFileReady(file);
      const parseStatus = file.file.parse_status || "—";
      const embeddingStatus = file.file.embedding_status || "—";
      const details = [
        file.file.mime_type || "file",
        formatSize(file.file.size),
        file.file.page_count ? t("notebook.studio.tablePages", { count: String(file.file.page_count) }) : null,
        file.file.token_count ? t("notebook.studio.tableTokens", { count: String(file.file.token_count) }) : null,
      ].filter(Boolean).join(" · ");
      return {
        module: file.file.filename,
        capability: file.file.summary || details || t("notebook.studio.tableCapabilityFallback"),
        status: ready ? t("notebook.statusReady") : `${parseStatus} / ${embeddingStatus}`,
        implementation: t("notebook.studio.tableImplementation", { parse: parseStatus, embedding: embeddingStatus }),
        value: ready ? t("notebook.studio.tableReadyValue") : t("notebook.studio.tablePendingValue"),
        source: `[${index + 1}]`,
      };
    });
  };

  const scopedStudioFiles = () => {
    const selected = files.filter((file) => selectedFileIds.includes(file.file_id));
    return selected.length > 0 ? selected : files;
  };

  const sourceRef = (index: number) => `[${index + 1}]`;

  const buildStudioTextSections = (type: "summary" | "faq" | "briefing"): NotebookStudioTextSection[] => {
    const scopedFiles = scopedStudioFiles();
    if (scopedFiles.length === 0) {
      return [{ heading: t("notebook.studio.noSourcesHeading"), body: t("notebook.studio.noSourcesBody") }];
    }
    const readyFiles = scopedFiles.filter(isNotebookFileReady);
    const sourceBullets = scopedFiles.map((file, index) => {
      const summary = file.file.summary || [file.file.mime_type || "file", formatSize(file.file.size)].filter(Boolean).join(" · ");
      return `${sourceRef(index)} ${file.file.filename}: ${summary || t("notebook.studio.sourceNoSummary")}`;
    });
    if (type === "summary") {
      return [
        {
          heading: t("notebook.studio.summarySectionOverview"),
          body: t("notebook.studio.summaryOverviewBody", { count: String(scopedFiles.length), ready: String(readyFiles.length) }),
        },
        { heading: t("notebook.studio.summarySectionSources"), bullets: sourceBullets },
        {
          heading: t("notebook.studio.summarySectionNext"),
          bullets: [
            t("notebook.studio.summaryNextVerify"),
            t("notebook.studio.summaryNextAsk"),
            t("notebook.studio.summaryNextTable"),
          ],
        },
      ];
    }
    if (type === "faq") {
      return [
        {
          heading: t("notebook.studio.faqQuestionScope"),
          body: t("notebook.studio.faqAnswerScope", { count: String(scopedFiles.length), ready: String(readyFiles.length) }),
        },
        {
          heading: t("notebook.studio.faqQuestionSources"),
          bullets: sourceBullets,
        },
        {
          heading: t("notebook.studio.faqQuestionFollowup"),
          bullets: [
            t("notebook.studio.faqFollowupCompare"),
            t("notebook.studio.faqFollowupRisks"),
            t("notebook.studio.faqFollowupTimeline"),
          ],
        },
      ];
    }
    return [
      {
        heading: t("notebook.studio.briefingSectionSituation"),
        body: t("notebook.studio.briefingSituationBody", { title: notebook?.title || t("notebook.untitled"), count: String(scopedFiles.length) }),
      },
      {
        heading: t("notebook.studio.briefingSectionSignals"),
        bullets: sourceBullets.slice(0, 6),
      },
      {
        heading: t("notebook.studio.briefingSectionActions"),
        bullets: [
          t("notebook.studio.briefingActionValidate"),
          t("notebook.studio.briefingActionDeepDive"),
          t("notebook.studio.briefingActionExport"),
        ],
      },
    ];
  };

  const handleStudioGenerate = async (type: NotebookStudioActionId) => {
    if (type === "slides") {
      toast.info(t("notebook.studio.comingSoon"));
      return;
    }
    if (!notebookId) return;
    if (selectedFileIds.length === 0) {
      toast.info(t("notebook.studio.selectSourcesFirst"));
      return;
    }
    setGeneratingStudioType(type);
    try {
      const saved = await generateNotebookArtifact({
        notebookId,
        type,
        file_ids: selectedFileIds,
        language: language as LanguageCode,
      });
      const artifact = toStudioArtifact(saved);
      if (artifact) {
        setStudioArtifacts((prev) => [artifact, ...prev.filter((item) => item.id !== artifact.id)]);
        setActiveStudioArtifactId(artifact.id);
      }
      toast.success(type === "table" ? t("notebook.studio.tableGenerated") : t("notebook.studio.textGenerated"));
    } catch (error) {
      showNotebookError(error, t("notebook.studio.saveFailed"));
    } finally {
      setGeneratingStudioType(null);
    }
  };

  const handleRenameArtifact = async (artifact: NotebookStudioArtifact) => {
    if (!notebookId) return;
    const title = window.prompt(t("notebook.studio.renamePrompt"), artifact.title)?.trim();
    if (!title || title === artifact.title) return;
    try {
      const updated = await updateNotebookArtifact(notebookId, Number(artifact.id), { title, subtitle: artifact.subtitle });
      const next = toStudioArtifact(updated);
      if (next) {
        setStudioArtifacts((prev) => prev.map((item) => item.id === next.id ? next : item));
        setActiveStudioArtifactId(next.id);
      }
      toast.success(t("notebook.studio.renameSuccess"));
    } catch (error) {
      showNotebookError(error, t("notebook.studio.renameFailed"));
    }
  };

  const handleDeleteArtifact = async (artifact: NotebookStudioArtifact) => {
    if (!notebookId) return;
    if (!window.confirm(t("notebook.studio.deleteConfirm", { title: artifact.title }))) return;
    try {
      await deleteNotebookArtifact(notebookId, Number(artifact.id));
      setStudioArtifacts((prev) => {
        const next = prev.filter((item) => item.id !== artifact.id);
        setActiveStudioArtifactId((current) => current === artifact.id ? next[0]?.id || null : current);
        return next;
      });
      toast.success(t("notebook.studio.deleteSuccess"));
    } catch (error) {
      showNotebookError(error, t("notebook.studio.deleteFailed"));
    }
  };

  const handleCopyArtifact = async (artifact: NotebookStudioArtifact) => {
    try {
      await navigator.clipboard.writeText(artifactToMarkdown(artifact));
      toast.success(t("notebook.studio.copySuccess"));
    } catch {
      toast.error(t("notebook.studio.copyFailed"));
    }
  };

  const handleDownloadArtifact = (artifact: NotebookStudioArtifact) => {
    const base = safeFilename(artifact.title);
    if (artifact.type === "table") {
      downloadTextFile(`${base}.csv`, artifactToCsv(artifact), "text/csv;charset=utf-8");
    } else {
      downloadTextFile(`${base}.md`, artifactToMarkdown(artifact), "text/markdown;charset=utf-8");
    }
    toast.success(t("notebook.studio.downloadSuccess"));
  };

  const handleExportTableToGoogleSheets = (artifact: Extract<NotebookStudioArtifact, { type: "table" }>) => {
    const base = safeFilename(artifact.title);
    downloadTextFile(`${base}.csv`, artifactToCsv(artifact), "text/csv;charset=utf-8");
    toast.success(t("notebook.studio.googleSheetsExportHint"));
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

  if (loading && !notebook) {
    return <div className="flex h-full items-center justify-center bg-surface"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div>;
  }

  if (!notebookId) {
    return <div className="flex h-full items-center justify-center bg-surface text-sm text-text-secondary">{t("notebook.loadFailed")}</div>;
  }

  return (
    <>
    <div ref={layoutRef} className="flex h-full min-h-0 overflow-x-auto bg-surface text-text-primary">
      <aside className="flex h-full shrink-0 flex-col bg-surface-elevated/80" style={{ width: sourcesWidth }}>
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
            <div className="flex items-center gap-2">
              <button onClick={() => setUrlDialogOpen(true)} disabled={addingUrl} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-surface-border bg-surface-card px-3 text-xs font-medium text-text-secondary transition hover:border-brand-border hover:text-brand disabled:opacity-60">
                {addingUrl ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}{t("notebook.addUrl")}
              </button>
              <button onClick={() => inputRef.current?.click()} disabled={uploading} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand px-3 text-xs font-medium text-white transition hover:bg-brand-hover disabled:opacity-60">
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}{t("notebook.addSource")}
              </button>
            </div>
          </div>
          <button type="button" onClick={() => setUrlDialogOpen(true)} className="mb-3 flex w-full items-center gap-2 rounded-2xl border border-surface-border bg-surface-card px-3 py-2.5 text-left text-xs text-text-tertiary transition hover:border-brand-border hover:bg-brand-muted/30 hover:text-brand">
            <Globe className="h-4 w-4" />
            <span>{t("notebook.searchNewSources")}</span>
          </button>
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
              <button type="button" onClick={selectAllSources} className="rounded-lg px-2.5 py-1 text-sm font-semibold text-brand transition hover:bg-brand-muted hover:text-brand-hover">
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
                  <div key={file.id} role="button" tabIndex={0} onClick={() => openPreview(file)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openPreview(file); }} className={cn("group w-full cursor-pointer rounded-2xl border bg-surface-card p-3 text-left transition hover:border-brand-border", selected ? "border-brand-border" : "border-surface-border opacity-70")}>
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); toggleSource(file.file_id); }}
                        className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition", selected ? "border-brand bg-brand text-white" : "border-surface-border text-transparent hover:border-brand-border")}
                        aria-label={selected ? "selected" : "unselected"}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-muted text-brand"><FileText className="h-4 w-4" /></div>
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <div className="truncate text-sm font-medium text-text-primary">{file.file.filename}</div>
                        <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-text-tertiary">
                          <span className="shrink-0">{formatSize(file.file.size)}</span>
                          <span className="shrink-0">·</span>
                          <span className="min-w-0 truncate" title={file.file.mime_type || "file"}>{file.file.mime_type || "file"}</span>
                        </div>
                      </div>
                      <button onClick={(event) => { event.stopPropagation(); handleRemove(file); }} className="shrink-0 rounded-lg p-1.5 text-text-tertiary opacity-0 transition hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
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
        onPointerDown={(event) => startPaneResize("sources", event)}
        className="group relative z-10 h-full w-2 shrink-0 cursor-col-resize touch-none bg-transparent"
      >
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-surface-border transition group-hover:w-1 group-hover:bg-brand" />
      </div>

      <section className="min-w-[420px] flex-1">
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
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("notebook.resizeStudio")}
        title={t("notebook.resizeStudio")}
        onPointerDown={(event) => startPaneResize("studio", event)}
        className="group relative z-10 h-full w-2 shrink-0 cursor-col-resize touch-none bg-transparent"
      >
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-surface-border transition group-hover:w-1 group-hover:bg-brand" />
      </div>
      <NotebookStudioPanel
        width={studioWidth}
        artifacts={studioArtifacts}
        activeArtifactId={activeStudioArtifactId}
        generatingType={generatingStudioType}
        selectedSourceCount={selectedFileIds.length}
        sourceFiles={studioSourceFiles}
        onGenerate={handleStudioGenerate}
        onOpenArtifact={setActiveStudioArtifactId}
        onRenameArtifact={handleRenameArtifact}
        onDeleteArtifact={handleDeleteArtifact}
        onCopyArtifact={handleCopyArtifact}
        onDownloadArtifact={handleDownloadArtifact}
        onExportTableToGoogleSheets={handleExportTableToGoogleSheets}
      />
    </div>
    <NotebookUrlSourceDialog
      open={urlDialogOpen}
      loading={addingUrl}
      onClose={() => setUrlDialogOpen(false)}
      onSubmit={handleAddUrlSource}
    />
    <NotebookSourcePreviewDrawer
      open={Boolean(previewSource)}
      source={previewSource}
      data={previewData}
      loading={previewLoading}
      error={previewError}
      onClose={closePreview}
    />
    </>
  );
}

export default function NotebookDetailPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center bg-surface"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div>}>
      <NotebookDetailContent />
    </Suspense>
  );
}
