"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { UploadCloud, FileText, Trash2, X, Check, Loader2, FolderOpen, CloudUpload } from "lucide-react";
import DialogShell, { THEMES } from "./DialogShell";
import { getClipboardFiles } from "@/lib/clipboardFiles";
import { readApiError, showUserError } from "@/lib/errors";

interface FileItem {
  id: number;
  public_id: string;
  original_name: string;
  file_type: string;
  file_size: number;
  created_at: string;
}

export default function UploadDialog({ open, onClose, workspaceId }: { open: boolean; onClose: () => void; workspaceId: number }) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const theme = THEMES.blue;

  const loadFiles = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token || !workspaceId) return;
    try {
      const res = await fetch(`/api/files?workspace_id=${workspaceId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setFiles(Array.isArray(data) ? data : []);
      }
    } catch { /* ignore */ }
  }, [workspaceId]);

  useEffect(() => {
    if (open) loadFiles();
  }, [open, loadFiles]);

  const handleUpload = async (fileList: FileList | File[] | null) => {
    if (!fileList || fileList.length === 0 || !workspaceId) return;
    setUploading(true);
    const token = localStorage.getItem("token");
    const uploaded: FileItem[] = [];
    for (const file of Array.from(fileList)) {
      const form = new FormData();
      form.append("file", file);
      form.append("workspace_id", String(workspaceId));
      try {
        const res = await fetch("/api/files/upload", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        if (!res.ok) throw await readApiError(res);
        const data = await res.json();
        uploaded.push(data);
      } catch (err) {
        showUserError(err, {
          module: "file",
          fallbackTitle: "上传失败",
          fallbackMessage: `${file.name} 上传失败，请重新选择文件。`,
        });
      }
    }
    setFiles((prev) => [...uploaded, ...prev]);
    setUploading(false);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const pastedFiles = getClipboardFiles(e);
    if (pastedFiles.length === 0) return;
    e.preventDefault();
    handleUpload(pastedFiles);
  };

  const handleDelete = async (id: number) => {
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`/api/files/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setFiles((prev) => prev.filter((f) => f.id !== id));
    } catch { /* ignore */ }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <DialogShell open={open} onClose={onClose} title="文件上传站" icon={<CloudUpload className={`h-4 w-4 ${theme.primary}`} />} size="lg" theme={theme} onPaste={handlePaste}>
      {/* 空间统计条 */}
      <div className={`mb-4 flex items-center gap-3 rounded-xl ${theme.primaryBg} ${theme.primaryBorder} border px-4 py-2.5`}>
        <FolderOpen className={`h-4 w-4 ${theme.primary}`} />
        <div className="flex-1">
          <p className="text-xs font-medium text-text-primary">当前空间</p>
          <p className="text-[10px] text-text-tertiary">{files.length} 个文件 · 拖拽上传至仓库</p>
        </div>
      </div>

      {/* 上传区域 - 蓝色主题 */}
      <div
        className={`mb-4 rounded-xl border-2 border-dashed p-8 text-center transition-all duration-300 ${
          dragOver ? `${theme.primaryBorder} ${theme.primaryBg} scale-[1.01]` : "border-surface-border bg-surface-card"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files); }}
        onClick={() => fileInputRef.current?.click()}
      >
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} />
        <div className={`mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl ${theme.primaryBg} ${theme.primaryBorder} border`}>
          <UploadCloud className={`h-7 w-7 ${theme.primary}`} />
        </div>
        <p className="text-sm font-medium text-text-primary">点击或拖拽文件到此处</p>
        <p className="mt-1 text-[11px] text-text-tertiary">支持 PDF、图片、文档等格式，也可直接粘贴文件</p>
        {uploading && (
          <div className={`mt-3 flex items-center justify-center gap-2 text-xs ${theme.primary}`}>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在存入仓库...
          </div>
        )}
      </div>

      {/* 文件列表 */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-text-primary">
          <FileText className={`h-3.5 w-3.5 ${theme.primary}`} />
          仓库文件 ({files.length})
        </h3>
        {files.length === 0 ? (
          <div className="rounded-xl border border-dashed border-surface-border bg-surface-card p-8 text-center">
            <FolderOpen className="mx-auto mb-2 h-8 w-8 text-text-tertiary/50" />
            <p className="text-xs text-text-tertiary">仓库空空如也，上传第一个文件吧</p>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto scrollbar-hide">
            {files.map((f) => (
              <div key={f.id} className="group flex items-center gap-3 rounded-xl border border-surface-border bg-surface-card p-2.5 transition-colors hover:border-blue-500/20">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${theme.primaryBg}`}>
                  <FileText className={`h-4 w-4 ${theme.primary}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-text-primary">{f.original_name}</p>
                  <p className="text-[10px] text-text-tertiary">{formatSize(f.file_size)} · {f.file_type}</p>
                </div>
                <button onClick={() => handleDelete(f.id)} className="rounded-lg p-1.5 text-text-tertiary opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </DialogShell>
  );
}
