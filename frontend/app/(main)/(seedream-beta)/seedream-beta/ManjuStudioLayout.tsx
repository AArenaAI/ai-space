"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Download,
  FolderOpen,
  LayoutGrid,
  MoreHorizontal,
  Plus,
  Save,
  Settings,
  Upload,
} from "lucide-react";
import ManjuFlowSidebar, { buildFlowSteps, type FlowStep } from "./ManjuFlowSidebar";
import ManjuCanvas, { type CanvasNode, type CanvasConnection } from "./ManjuCanvas";
import ManjuNodePanel from "./ManjuNodePanel";
import ManjuProjectIO from "./ManjuProjectIO";
import type { WorkflowMode } from "./types";
import { toast } from "sonner";

export interface ManjuStudioLayoutProps {
  /* 项目信息 */
  projectName: string;
  projectId?: string;

  /* 流程导航 */
  activeStep: WorkflowMode | "overview";
  onStepChange: (step: WorkflowMode | "overview") => void;
  onGenerate?: (step: WorkflowMode) => void;
  generating?: WorkflowMode | null;

  /* 画布数据 */
  nodes: CanvasNode[];
  connections?: CanvasConnection[];
  onNodeMove?: (id: string, x: number, y: number) => void;
  onNodeSelect?: (id: string | null) => void;
  onNodeDoubleClick?: (node: CanvasNode) => void;
  onAddNode?: (type: CanvasNode["type"], x: number, y: number) => void;
  onDeleteNode?: (id: string) => void;
  onToggleCollapse?: (id: string) => void;
  selectedNodeId?: string | null;

  /* 项目操作 */
  onGenerateAsset?: (assetId: string) => void;
  onAutoLayout?: () => void;
  onSave?: () => void;
  onExport?: () => void;
  onImport?: () => void;
  onNewProject?: () => void;
  onOpenProject?: () => void;
  onSettings?: () => void;

  /* 子内容（右侧详情面板或浮层） */
  children?: React.ReactNode;
  rightPanel?: React.ReactNode;
}

export default function ManjuStudioLayout({
  projectName,
  activeStep,
  onStepChange,
  onGenerate,
  generating,
  nodes,
  connections,
  onNodeMove,
  onNodeSelect,
  onNodeDoubleClick,
  onAddNode,
  onDeleteNode,
  onToggleCollapse,
  selectedNodeId,
  onSave,
  onGenerateAsset,
  onAutoLayout,
  onExport,
  onImport,
  onNewProject,
  onOpenProject,
  onSettings,
  children,
  rightPanel,
}: ManjuStudioLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [internalSelectedNodeId, setInternalSelectedNodeId] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<"node" | "project">("node");

  /* 从 nodes 推导步骤状态（简化版） */
  const steps: FlowStep[] = buildFlowSteps({
    script: nodes.find((n) => n.type === "script")?.data?.content as string,
    assets: nodes.filter((n) => n.type === "assets"),
    storyboardShots: nodes.filter((n) => n.type === "shot" || n.type === "image"),
    generationQueue: nodes.filter((n) => n.type === "video"),
  });

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-base">
      {/* ===== 顶部项目栏 ===== */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-surface-border bg-surface-elevated px-4">
        {/* 左侧：项目操作 */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onNewProject}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-text-secondary hover:bg-surface-card hover:text-text-primary"
            title="新建项目"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">新建</span>
          </button>
          <button
            type="button"
            onClick={onOpenProject}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-text-secondary hover:bg-surface-card hover:text-text-primary"
            title="打开项目"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">打开</span>
          </button>
        </div>

        <span className="h-5 w-px bg-surface-border" />

        {/* 中间：项目名 + 保存状态 */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Clapperboard className="h-4 w-4 shrink-0 text-brand" />
          <span className="truncate text-sm font-semibold text-text-primary">
            {projectName || "未命名漫剧"}
          </span>
          <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand">
            Studio
          </span>
        </div>

        {/* 右侧：操作按钮 */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setRightPanelTab("project");
              setRightPanelOpen(true);
            }}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-text-secondary hover:bg-surface-card hover:text-text-primary"
            title="保存/导出/导入"
          >
            <Save className="h-3.5 w-3.5" />
            <span className="hidden md:inline">保存</span>
          </button>
          <button
            type="button"
            onClick={() => toast.info("开发中")}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-text-secondary hover:bg-surface-card hover:text-text-primary"
            title="自动布局"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span className="hidden md:inline">布局</span>
          </button>
          <span className="h-5 w-px bg-surface-border" />
          <button
            type="button"
            onClick={onSettings}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-card hover:text-text-primary"
            title="设置"
          >
            <Settings className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setRightPanelOpen((v) => !v)}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
              rightPanelOpen
                ? "bg-brand/10 text-brand"
                : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
            )}
            title="详情面板"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ===== 主体：Sidebar + Canvas + 可选右侧面板 ===== */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧流程导航 */}
        <ManjuFlowSidebar
          steps={steps}
          activeStep={activeStep}
          onStepChange={onStepChange}
          onGenerate={onGenerate}
          generating={generating}
          projectName={projectName}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        />

        {/* 中央画布区 */}
        <div className="relative flex-1 overflow-hidden">
          <ManjuCanvas
            nodes={nodes}
            connections={connections}
            onNodeMove={onNodeMove}
            onNodeSelect={(id) => {
              setInternalSelectedNodeId(id);
              setRightPanelOpen(!!id);
              onNodeSelect?.(id);
            }}
            onNodeDoubleClick={onNodeDoubleClick}
            onAddNode={onAddNode}
            onDeleteNode={onDeleteNode}
            onToggleCollapse={onToggleCollapse}
            selectedNodeId={internalSelectedNodeId}
            onDropAddNode={(type: string, x: number, y: number) => {
              onAddNode?.(type as CanvasNode["type"], x, y);
            }}
            onGenerateAsset={onGenerateAsset}
            />
          {/* 浮层子内容（如节点编辑器弹窗） */}
          {children}
        </div>

        {/* 右侧面板（详情/属性） */}
        {rightPanel && (
          <div
            className={cn(
              "flex flex-col border-l border-surface-border bg-surface-elevated transition-all duration-200",
              rightPanelOpen ? "w-80" : "w-0 overflow-hidden"
            )}
          >
            {rightPanelOpen && (
              <div className="flex h-full flex-col">
                <div className="flex h-10 items-center justify-between border-b border-surface-border px-3">
                  <span className="text-xs font-semibold text-text-primary">属性</span>
                  <button
                    type="button"
                    onClick={() => setRightPanelOpen(false)}
                    className="rounded p-1 text-text-tertiary hover:bg-surface-card hover:text-text-secondary"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  {rightPanelTab === "node" ? (
                    <ManjuNodePanel
                      node={nodes.find((n) => n.id === internalSelectedNodeId) || null}
                      onClose={() => {
                        setRightPanelOpen(false);
                        setInternalSelectedNodeId(null);
                      }}
                      onDeleteNode={onDeleteNode}
                    />
                  ) : (
                    <ManjuProjectIO
                      projectName={projectName}
                      nodes={nodes}
                      connections={connections || []}
                      onSave={(data) => {
                        onSave?.();
                        toast.success("已保存到本地");
                      }}
                      onExport={(data) => {
                        onExport?.();
                        toast.success("已导出 JSON");
                      }}
                      onImport={(data) => {
                        onImport?.();
                        toast.success("已导入项目");
                      }}
                      onClose={() => setRightPanelOpen(false)}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
