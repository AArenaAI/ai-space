"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Download, Upload, Save, X, FileJson, AlertTriangle } from "lucide-react";
import type { CanvasNode, CanvasConnection } from "./ManjuCanvas";

export interface ManjuProjectIOProps {
  projectName: string;
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  onSave?: (data: ProjectData) => void;
  onExport?: (data: ProjectData) => void;
  onImport?: (data: ProjectData) => void;
  onClose?: () => void;
}

export interface ProjectData {
  version: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  nodes: CanvasNode[];
  connections: CanvasConnection[];
}

export default function ManjuProjectIO({
  projectName,
  nodes,
  connections,
  onSave,
  onExport,
  onImport,
  onClose,
}: ManjuProjectIOProps) {
  const [tab, setTab] = useState<"save" | "export" | "import">("save");
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");

  const buildProjectData = (): ProjectData => ({
    version: "1.0",
    name: projectName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes,
    connections,
  });

  const handleExport = () => {
    const data = buildProjectData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName || "project"}.manju.json`;
    a.click();
    URL.revokeObjectURL(url);
    onExport?.(data);
  };

  const handleSave = () => {
    const data = buildProjectData();
    localStorage.setItem(`manju-project-${projectName}`, JSON.stringify(data));
    onSave?.(data);
  };

  const handleImport = () => {
    setImportError("");
    try {
      const data = JSON.parse(importText) as ProjectData;
      if (!data.nodes || !Array.isArray(data.nodes)) {
        throw new Error("无效的项目数据：缺少 nodes 数组");
      }
      onImport?.(data);
      setImportText("");
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "导入失败");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImportText(String(ev.target?.result || ""));
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-surface-border px-3 py-2">
        <span className="text-xs font-semibold text-text-primary">项目操作</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-text-tertiary hover:bg-surface-card hover:text-text-secondary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tab */}
      <div className="flex border-b border-surface-border">
        {(["save", "export", "import"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 py-2 text-[11px] font-medium transition-colors",
              tab === t ? "border-b-2 border-brand text-brand" : "text-text-tertiary hover:text-text-secondary"
            )}
          >
            {t === "save" && "保存"}
            {t === "export" && "导出"}
            {t === "import" && "导入"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {tab === "save" && (
          <div className="space-y-3">
            <div className="rounded-lg bg-surface-card p-3 space-y-2">
              <div className="text-[10px] font-medium text-text-tertiary">保存到本地</div>
              <div className="text-[11px] text-text-secondary">
                项目数据将保存到浏览器 localStorage，同一浏览器可恢复。
              </div>
              <button
                type="button"
                onClick={handleSave}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand/10 py-2 text-[11px] font-medium text-brand hover:bg-brand/20"
              >
                <Save className="h-3.5 w-3.5" />
                保存项目
              </button>
            </div>
            <div className="text-[10px] text-text-tertiary">
              项目名：{projectName || "未命名"} · 节点数：{nodes.length} · 连接数：{connections.length}
            </div>
          </div>
        )}

        {tab === "export" && (
          <div className="space-y-3">
            <div className="rounded-lg bg-surface-card p-3 space-y-2">
              <div className="text-[10px] font-medium text-text-tertiary">导出 JSON</div>
              <div className="text-[11px] text-text-secondary">
                下载 .manju.json 文件，包含所有节点、连接线和项目元数据。
              </div>
              <button
                type="button"
                onClick={handleExport}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand/10 py-2 text-[11px] font-medium text-brand hover:bg-brand/20"
              >
                <Download className="h-3.5 w-3.5" />
                下载项目文件
              </button>
            </div>
            <div className="text-[10px] text-text-tertiary">
              文件名：{projectName || "project"}.manju.json
            </div>
          </div>
        )}

        {tab === "import" && (
          <div className="space-y-3">
            <div className="rounded-lg bg-surface-card p-3 space-y-2">
              <div className="text-[10px] font-medium text-text-tertiary">导入项目</div>
              <div className="text-[11px] text-text-secondary">
                粘贴 JSON 或上传 .manju.json 文件。
              </div>
              <input
                type="file"
                accept=".json,.manju.json"
                onChange={handleFileUpload}
                className="block w-full text-[11px] text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-surface-base file:px-2 file:py-1 file:text-[11px] file:text-text-primary"
              />
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="粘贴项目 JSON..."
                className="h-32 w-full rounded-lg border border-surface-border bg-surface-base p-2 text-[11px] text-text-primary outline-none focus:border-brand"
              />
              {importError && (
                <div className="flex items-center gap-1 text-[11px] text-red-500">
                  <AlertTriangle className="h-3 w-3" />
                  {importError}
                </div>
              )}
              <button
                type="button"
                onClick={handleImport}
                disabled={!importText.trim()}
                className={cn(
                  "flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-medium",
                  importText.trim()
                    ? "bg-brand/10 text-brand hover:bg-brand/20"
                    : "bg-surface-card text-text-tertiary"
                )}
              >
                <Upload className="h-3.5 w-3.5" />
                导入
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
