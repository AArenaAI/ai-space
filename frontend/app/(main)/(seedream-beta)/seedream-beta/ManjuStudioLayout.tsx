"use client";

import { Children, cloneElement, isValidElement, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Box,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  LayoutGrid,
  MoreHorizontal,
  Search,
  Settings,
  Sparkles,
  TreePine,
  UploadCloud,
  Users,
  Video,
  X,
} from "lucide-react";
import ManjuCanvas, { type CanvasAssetDropPayload, type CanvasConnection, type CanvasNode } from "./ManjuCanvas";
import type { ComposerSettings } from "./BottomNodeComposer";
import ManjuNodePanel from "./ManjuNodePanel";
import ManjuProjectIO from "./ManjuProjectIO";
import type { WorkflowMode } from "./types";
import { toast } from "sonner";

export interface ManjuStudioLayoutProps {
  projectName: string;
  projectId?: string;

  activeStep: WorkflowMode | "overview";
  onStepChange: (step: WorkflowMode | "overview") => void;
  onGenerate?: (step: WorkflowMode) => void;
  generating?: WorkflowMode | null;

  nodes: CanvasNode[];
  connections?: CanvasConnection[];
  onNodeMove?: (id: string, x: number, y: number) => void;
  onNodeSelect?: (id: string | null) => void;
  onNodeDoubleClick?: (node: CanvasNode) => void;
  onUpdateNodeContent?: (nodeId: string, updates: { title?: string; body?: string }) => void;
  onAddNode?: (type: CanvasNode["type"], x: number, y: number, sourceNodeId?: string, sourceSide?: "left" | "right") => void;
  onDeleteNode?: (id: string) => void;
  onToggleCollapse?: (id: string) => void;
  selectedNodeId?: string | null;

  onGenerateAsset?: (assetId: string) => void;
  onAutoLayout?: () => void;
  onBatchGenerate?: (nodeIds: string[], mode: "image" | "video") => void;
  onConnectNodes?: (from: string, to: string) => void;
  onDropAsset?: (asset: CanvasAssetDropPayload, x: number, y: number) => void;
  onSave?: () => void;
  onExport?: () => void;
  onImport?: () => void;
  onImportScriptFile?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onNewProject?: () => void;
  onOpenProject?: () => void;
  onSettings?: () => void;

  onNodeUpload?: (nodeId: string) => void;
  onNodeGenerate?: (nodeId: string) => void;
  onNodePickFromLibrary?: (nodeId: string) => void;
  nodeAssets?: Array<{ id: string; publicId?: string; name: string; category?: string; kind?: string; summary?: string; url?: string; image_url?: string }>;
  mentionAssets?: Array<{ id: string; name: string; kind?: string; category?: string; summary?: string; imageUrl?: string; image_url?: string; url?: string }>;
  composerSettings: ComposerSettings;
  composerOptions: {
    imageAspects: string[];
    imageResolutions: string[];
    videoModels: string[];
    videoAspects: string[];
    videoResolutions: string[];
    videoDurations: number[];
  };
  onComposerSettingsChange?: (nodeId: string, updates: Partial<ComposerSettings>) => void;
  onBindAssetMention?: (nodeId: string, assetId: string) => void;
  composerGenerating?: boolean;

  children?: React.ReactNode;
  rightPanel?: React.ReactNode;
}

type StageStatus = "empty" | "draft" | "done";

type Stage = {
  id: WorkflowMode | "overview";
  label: string;
  desc: string;
  status: StageStatus;
  generate?: WorkflowMode;
  activeWhen?: Array<WorkflowMode | "overview">;
};

type StageActionMeta = {
  label: string;
  title: string;
  disabled?: boolean;
  generate?: WorkflowMode;
};

const statusStyle: Record<StageStatus, string> = {
  empty: "border-surface-border bg-surface-card text-text-tertiary",
  draft: "border-amber-400/40 bg-amber-400/10 text-amber-600 dark:text-amber-300",
  done: "border-emerald-400/40 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
};

const statusText: Record<StageStatus, string> = {
  empty: "空",
  draft: "草稿",
  done: "完成",
};

function getNodeKind(node: CanvasNode) {
  return node.type;
}

function kindMeta(kind: string) {
  if (kind === "script") return { label: "剧本", icon: FileText, tone: "text-slate-600 bg-slate-500/10 border-slate-500/20" };
  if (kind === "assets") return { label: "角色/场景", icon: Box, tone: "text-blue-500 bg-blue-500/10 border-blue-500/20" };
  if (kind === "shot") return { label: "镜头卡", icon: Clapperboard, tone: "text-orange-500 bg-orange-500/10 border-orange-500/20" };
  if (kind === "image") return { label: "分镜图", icon: ImageIcon, tone: "text-cyan-500 bg-cyan-500/10 border-cyan-500/20" };
  if (kind === "video") return { label: "视频", icon: Video, tone: "text-violet-500 bg-violet-500/10 border-violet-500/20" };
  if (kind === "director") return { label: "导演台", icon: LayoutGrid, tone: "text-purple-500 bg-purple-500/10 border-purple-500/20" };
  if (kind === "text") return { label: "文本", icon: FileText, tone: "text-slate-500 bg-slate-500/10 border-slate-500/20" };
  if (kind === "generator") return { label: "生成器", icon: Sparkles, tone: "text-brand bg-brand/10 border-brand/20" };
  if (kind === "character") return { label: "角色", icon: Users, tone: "text-blue-500 bg-blue-500/10 border-blue-500/20" };
  if (kind === "scene") return { label: "场景", icon: TreePine, tone: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" };
  if (kind === "prop") return { label: "道具", icon: Box, tone: "text-amber-500 bg-amber-500/10 border-amber-500/20" };
  if (kind === "style") return { label: "风格", icon: Sparkles, tone: "text-purple-500 bg-purple-500/10 border-purple-500/20" };
  return { label: "元素", icon: Box, tone: "text-text-secondary bg-surface-card border-surface-border" };
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
  onUpdateNodeContent,
  onAddNode,
  onDeleteNode,
  onToggleCollapse,
  selectedNodeId,
  onSave,
  onAutoLayout,
  onBatchGenerate,
  onConnectNodes,
  onDropAsset,
  onExport,
  onImport,
  onImportScriptFile,
  onNewProject,
  onSettings,
  onNodeUpload,
  onNodeGenerate,
  onNodePickFromLibrary,
  nodeAssets,
  mentionAssets,
  composerSettings,
  composerOptions,
  onComposerSettingsChange,
  onBindAssetMention,
  composerGenerating,
  children,
  rightPanel,
}: ManjuStudioLayoutProps) {
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [internalSelectedNodeId, setInternalSelectedNodeId] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<"node" | "project">("node");
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [assetKind, setAssetKind] = useState<string>("all");
  const [assetQuery, setAssetQuery] = useState("");

  const scriptNode = nodes.find((n) => n.type === "script");
  const assetNodes = nodes.filter((n) => n.type === "assets");
  const shotNodes = nodes.filter((n) => n.type === "shot" || n.type === "image" || n.type === "video");
  const imageNodes = nodes.filter((n) => n.type === "image" || n.type === "video");
  const videoNodes = nodes.filter((n) => n.type === "video");
  const activeSelectedNodeId = internalSelectedNodeId ?? selectedNodeId ?? null;
  const selectedComposerNode = nodes.find((n) => n.id === activeSelectedNodeId) || null;

  const stages: Stage[] = [
    {
      id: "script",
      label: "故事剧本",
      desc: scriptNode ? `${shotNodes.length ? `${shotNodes.length} 镜头 · ` : ""}可改剧本` : "写小说/生成剧本",
      status: scriptNode ? "done" : "empty",
      generate: "script",
      activeWhen: ["script", "novel"],
    },
    {
      id: "assets",
      label: "角色场景",
      desc: assetNodes.length ? `${assetNodes.length} 个资产` : scriptNode ? "待提取资产" : "等待剧本",
      status: assetNodes.length ? "done" : scriptNode ? "draft" : "empty",
      generate: "assets",
      activeWhen: ["assets"],
    },
    {
      id: "storyboardImage",
      label: "分镜成片",
      desc: `${imageNodes.length}/${shotNodes.length} 图 · ${videoNodes.length}/${shotNodes.length} 视频`,
      status: videoNodes.length ? "done" : shotNodes.length || imageNodes.length ? "draft" : "empty",
      generate: imageNodes.length && videoNodes.length < shotNodes.length ? "storyboardVideo" : "storyboardImage",
      activeWhen: ["storyboardImage", "storyboardVideo", "videoSegments"],
    },
  ];
  const canvasStatus = `${nodes.length} 节点 · ${connections?.length || 0} 连线`;

  const getStageActionMeta = (stage: Stage): StageActionMeta | null => {
    if (!stage.generate) return null;
    if (stage.generate === "script") {
      return {
        label: scriptNode ? "改剧本" : "写小说",
        title: scriptNode ? "使用 AI 写作助手改写当前剧本" : "使用 AI 写作助手生成本集小说/剧情",
      };
    }
    if (stage.generate === "assets") {
      const disabled = !scriptNode;
      return {
        label: "生成资产",
        title: disabled ? "请先完成剧本，再从剧本提取角色、场景、道具资产" : "从剧本提取角色、场景、道具资产，并创建资产节点",
        disabled,
      };
    }
    if (stage.id === "storyboardImage") {
      if (imageNodes.length > 0 && videoNodes.length < shotNodes.length) {
        const disabled = imageNodes.length === 0;
        return {
          label: "生成视频",
          title: disabled ? "请先生成分镜图，再批量生成 Seedance 视频" : "按分镜图和视频提示词批量生成 Seedance 视频",
          disabled,
          generate: "storyboardVideo",
        };
      }
      const disabled = shotNodes.length === 0;
      return {
        label: "生成分镜图",
        title: disabled ? "请先生成或添加镜头节点，再批量生成分镜图" : "按镜头提示词批量生成 Seedream 分镜图",
        disabled,
        generate: "storyboardImage",
      };
    }
    if (stage.generate === "storyboardVideo") {
      const disabled = imageNodes.length === 0;
      return {
        label: "生成视频",
        title: disabled ? "请先生成分镜图，再批量生成 Seedance 视频" : "按分镜图和视频提示词批量生成 Seedance 视频",
        disabled,
        generate: "storyboardVideo",
      };
    }
    return null;
  };

  const assetLibraryItems = useMemo(() => {
    return nodes
      .map((node) => ({
        id: node.id,
        name: String(node.title || node.data?.name || "未命名元素"),
        kind: getNodeKind(node),
        summary: String(node.data?.subtitle || node.data?.summary || node.data?.content || node.data?.body || ""),
        image: String(node.data?.thumbnail || node.data?.image_url || node.data?.imageUrl || node.data?.url || ""),
      }))
      .filter((item) => assetKind === "all" || item.kind === assetKind)
      .filter((item) => {
        const q = assetQuery.trim().toLowerCase();
        if (!q) return true;
        return item.name.toLowerCase().includes(q) || item.summary.toLowerCase().includes(q);
      });
  }, [assetKind, assetQuery, nodes]);

  const openProjectPanel = () => {
    setRightPanelTab("project");
    setRightPanelOpen(true);
  };

  const openNodePanel = () => {
    setRightPanelTab("node");
    setRightPanelOpen(true);
  };

  const selectNodeOnly = (id: string | null) => {
    onNodeSelect?.(id);
    setInternalSelectedNodeId(id);
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#eef2ec] text-text-primary">
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-black/5 bg-white/82 px-4 shadow-[0_1px_0_rgba(15,23,42,0.03)] backdrop-blur-xl">
        <div className="flex min-w-[210px] items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-sm">
            <Clapperboard className="h-4 w-4 shrink-0" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold tracking-[-0.01em] text-slate-900">{projectName || "未命名漫剧"}</div>
            <div className="text-[10px] font-medium text-brand">画布流程 · {canvasStatus}</div>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-0.5 overflow-x-auto">
          {stages.map((stage, index) => {
            const action = getStageActionMeta(stage);
            const actionGenerate = action?.generate || stage.generate;
            const isActiveStage = stage.activeWhen?.includes(activeStep) || activeStep === stage.id;
            const isGeneratingStage = Boolean(actionGenerate && generating === actionGenerate);
            return (
              <div key={stage.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    onStepChange(stage.id);
                  }}
                  className={cn(
                    "group flex h-8 min-w-[112px] items-center justify-between gap-2 rounded-full border px-2.5 text-left transition hover:border-slate-300 hover:bg-white",
                    isActiveStage ? "border-slate-900 bg-slate-950 text-white shadow-sm" : "border-black/5 bg-white/72 text-slate-700"
                  )}
                  title={`进入${stage.label}工作区：${stage.desc}`}
                >
                  <div className="min-w-0">
                    <div className={cn("truncate text-[11px] font-semibold", isActiveStage ? "text-white" : "text-slate-800")}>{stage.label}</div>
                    <div className={cn("truncate text-[9px]", isActiveStage ? "text-white/55" : "text-slate-400")}>{stage.desc}</div>
                  </div>
                  <span className={cn("shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold", isActiveStage ? "border-white/15 bg-white/10 text-white/75" : statusStyle[stage.status])}>
                    {isGeneratingStage ? "生成中" : statusText[stage.status]}
                  </span>
                </button>
                {stage.id === "script" && onImportScriptFile && (
                  <label
                    className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-white/85 px-2.5 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:border-brand/30 hover:bg-white hover:text-brand"
                    title="上传 .md/.txt 剧本，并自动解析成镜头卡"
                  >
                    <UploadCloud className="h-3.5 w-3.5" />
                    <span>上传剧本</span>
                    <input type="file" accept=".md,.txt,text/markdown,text/plain" className="hidden" onChange={onImportScriptFile} />
                  </label>
                )}
                {action && (
                  <button
                    type="button"
                    aria-disabled={action.disabled || isGeneratingStage}
                    onClick={() => {
                      if (action.disabled || isGeneratingStage) {
                        toast.info(action.title);
                        return;
                      }
                      onStepChange(stage.id);
                      if (actionGenerate) onGenerate?.(actionGenerate);
                    }}
                    className={cn(
                      "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold transition",
                      action.disabled || isGeneratingStage
                        ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                        : "border-brand/15 bg-white/85 text-brand shadow-sm hover:border-brand/30 hover:bg-brand hover:text-white"
                    )}
                    title={action.title}
                    aria-label={action.title}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>{isGeneratingStage ? "生成中" : action.label}</span>
                  </button>
                )}
                {index < stages.length - 1 && <ChevronRight className="mx-0.5 h-3 w-3 text-slate-300" />}
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <div className="flex h-8 items-center gap-1.5 rounded-full border border-emerald-200/70 bg-emerald-50/80 px-3 text-xs font-semibold text-emerald-700" title="项目内容会自动保存到当前项目">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />自动保存
          </div>
          <button type="button" onClick={onAutoLayout} className="flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs text-slate-500 hover:bg-white hover:text-slate-900" title="自动布局">
            <LayoutGrid className="h-3.5 w-3.5" />布局
          </button>
          <button type="button" onClick={openProjectPanel} className="flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs text-slate-500 hover:bg-white hover:text-slate-900" title="项目/导入导出">
            <FolderOpen className="h-3.5 w-3.5" />项目
          </button>
          <button type="button" onClick={onSettings} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-white hover:text-slate-900" title="设置">
            <Settings className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setRightPanelOpen((v) => !v)}
            className={cn("flex h-8 w-8 items-center justify-center rounded-full transition-colors", rightPanelOpen ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-white hover:text-slate-900")}
            title="生产检查"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden p-3 pt-2">
        <div className="relative flex-1 overflow-hidden rounded-[30px] border border-white/70 bg-white/40 shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
          <div className="absolute inset-0 p-1.5">
            <ManjuCanvas
              nodes={nodes}
              connections={connections}
              onNodeMove={onNodeMove}
              onNodeSelect={selectNodeOnly}
              onNodeDoubleClick={(node) => {
                onNodeDoubleClick?.(node);
                setInternalSelectedNodeId(node.id);
              }}
              onAddNode={onAddNode}
              onDeleteNode={onDeleteNode}
              onToggleCollapse={onToggleCollapse}
              onAutoLayout={onAutoLayout}
              onBatchGenerate={onBatchGenerate}
              onConnectNodes={onConnectNodes}
              onDropAsset={(asset, x, y) => {
                onDropAsset?.(asset, x, y);
                setAssetLibraryOpen(false);
              }}
              selectedNodeId={activeSelectedNodeId}
              onNodeUpload={onNodeUpload}
              onNodeGenerate={onNodeGenerate}
              onNodePickFromLibrary={(nodeId) => {
                onNodePickFromLibrary?.(nodeId);
                setAssetLibraryOpen(true);
              }}
              nodeAssets={nodeAssets}
              mentionAssets={mentionAssets}
              composerSettings={composerSettings}
              composerOptions={composerOptions}
              composerGenerating={composerGenerating}
              onUpdateNodeContent={onUpdateNodeContent}
              onComposerSettingsChange={onComposerSettingsChange}
              onBindAssetMention={onBindAssetMention}
            />
          </div>

          {Children.map(children, (child) =>
            isValidElement(child)
              ? cloneElement(child as React.ReactElement<{ onOpenProjectPanel?: () => void; onOpenAssetLibrary?: () => void }>, {
                  onOpenProjectPanel: openProjectPanel,
                  onOpenAssetLibrary: () => setAssetLibraryOpen(true),
                })
              : child
          )}

          {assetLibraryOpen && (
            <div className="absolute inset-y-4 left-[64px] z-40 flex w-[min(520px,calc(100%-88px))] flex-col overflow-hidden rounded-[28px] border border-white/80 bg-white/94 shadow-[0_24px_70px_rgba(15,23,42,0.22)] ring-1 ring-slate-900/5 backdrop-blur-2xl">
              <div className="flex h-14 shrink-0 items-center justify-between border-b border-black/5 bg-white/72 px-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-slate-950 text-white">
                      <ImageIcon className="h-3.5 w-3.5" />
                    </span>
                    <div className="text-sm font-semibold tracking-[-0.01em] text-slate-900">画布元素</div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{assetLibraryItems.length}/{nodes.length}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] font-medium text-slate-400">当前画布内的节点与外部可用元素</div>
                </div>
                <button type="button" onClick={() => setAssetLibraryOpen(false)} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="shrink-0 border-b border-black/5 bg-[#fbfcfa]/88 px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      value={assetQuery}
                      onChange={(event) => setAssetQuery(event.target.value)}
                      placeholder="搜索画布元素、镜头、角色、场景"
                      className="h-9 w-full rounded-2xl border border-slate-200/80 bg-white/82 pl-8 pr-3 text-xs text-slate-800 outline-none transition focus:border-brand/50 focus:bg-white"
                    />
                  </div>
                  <button type="button" onClick={() => onAddNode?.("text", 260, 260)} className="h-9 shrink-0 rounded-2xl bg-slate-950 px-3 text-xs font-semibold text-white shadow-sm hover:bg-slate-800">
                    新建
                  </button>
                </div>

                <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
                  {[
                    ["all", "全部", Sparkles],
                    ["script", "剧本", FileText],
                    ["assets", "角色场景", Users],
                    ["shot", "镜头卡", Clapperboard],
                    ["image", "分镜图", ImageIcon],
                    ["video", "视频", Video],
                    ["text", "文本", FileText],
                  ].map(([id, label, Icon]) => {
                    const count = id === "all" ? nodes.length : nodes.filter((n) => getNodeKind(n) === id).length;
                    return (
                      <button
                        key={String(id)}
                        type="button"
                        onClick={() => setAssetKind(String(id))}
                        className={cn(
                          "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition",
                          assetKind === id ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200/80 bg-white/70 text-slate-500 hover:border-slate-300 hover:bg-white hover:text-slate-900"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {String(label)}
                        <span className={cn("rounded-full px-1.5 py-0.5 text-[9px]", assetKind === id ? "bg-white/14 text-white/75" : "bg-slate-100 text-slate-400")}>{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto bg-white/70 p-3.5">
                {assetLibraryItems.length === 0 ? (
                  <div className="col-span-2 flex h-52 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/62 text-center">
                    <ImageIcon className="mb-2 h-8 w-8 text-slate-300" />
                    <div className="text-sm font-semibold text-slate-600">暂无画布元素</div>
                    <div className="mt-1 max-w-64 text-xs leading-5 text-slate-400">点击左侧第一个 + 添加节点，或用顶部流程生成剧本、角色场景和镜头卡。</div>
                  </div>
                ) : (
                  assetLibraryItems.map((asset) => {
                    const meta = kindMeta(asset.kind);
                    const Icon = meta.icon;
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => {
                          selectNodeOnly(asset.id);
                        }}
                        title="选择画布元素"
                        className="group cursor-pointer overflow-hidden rounded-2xl border border-slate-200/70 bg-white text-left shadow-[0_6px_18px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-[0_14px_34px_rgba(15,23,42,0.10)]"
                      >
                        <div className="relative aspect-[16/10] bg-slate-100">
                          {asset.image ? (
                            <img src={asset.image} alt={asset.name} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_center,rgba(148,163,184,0.12),transparent_62%)] text-slate-300">
                              <Icon className="h-8 w-8" />
                            </div>
                          )}
                          {!asset.image && (
                            <div className="absolute inset-0 hidden items-center justify-center bg-slate-950/35 group-hover:flex">
                              <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-slate-800 shadow-sm">生成元素图</span>
                            </div>
                          )}
                        </div>
                        <div className="p-2.5">
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold", meta.tone)}>{meta.label}</span>
                            <span className="text-[9px] text-slate-300">节点</span>
                          </div>
                          <div className="truncate text-[13px] font-semibold text-slate-900">{asset.name}</div>
                          <div className="mt-1 line-clamp-2 min-h-8 text-[11px] leading-4 text-slate-400">{asset.summary || "未填写元素描述"}</div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <div className={cn("ml-3 flex flex-col overflow-hidden rounded-[28px] border border-white/70 bg-white/78 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur-xl transition-all duration-200", rightPanelOpen ? "w-[400px]" : "w-10")}>
          {rightPanelOpen ? (
            <div className="flex h-full flex-col">
              <div className="flex h-11 items-center justify-between border-b border-black/5 bg-white/55 px-3">
                <span className="text-xs font-semibold text-slate-800">生产检查</span>
                <button type="button" onClick={() => setRightPanelOpen(false)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto bg-[#fbfcfa]/80 p-3">
                {rightPanelTab === "node" ? (
                  rightPanel ? (
                    rightPanel
                  ) : (
                    <ManjuNodePanel
                      node={nodes.find((n) => n.id === internalSelectedNodeId) || null}
                      onClose={() => {
                        setRightPanelOpen(false);
                        setInternalSelectedNodeId(null);
                      }}
                      onDeleteNode={onDeleteNode}
                    />
                  )
                ) : (
                  <ManjuProjectIO
                    projectName={projectName}
                    nodes={nodes}
                    connections={connections || []}
                    onSave={() => {
                      onSave?.();
                      toast.success("已保存到本地");
                    }}
                    onExport={() => {
                      onExport?.();
                      toast.success("已导出 JSON");
                    }}
                    onImport={() => {
                      onImport?.();
                      toast.success("已导入项目");
                    }}
                    onClose={() => setRightPanelOpen(false)}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center gap-2 bg-white/60 py-2">
              <button type="button" onClick={() => setRightPanelOpen(true)} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="展开生产检查">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="mt-1 rounded-full bg-slate-100 px-1.5 py-1 text-[10px] font-bold text-slate-400 [writing-mode:vertical-rl]">生产检查</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
