"use client";

import { cn } from "@/lib/utils";
import {
  BookOpen,
  Box,
  Clapperboard,
  Image,
  LayoutGrid,
  Video,
  Plus,
  Sparkles,
  Wand2,
  Layers,
  FileText,
} from "lucide-react";
import type { WorkflowMode } from "./types";
import type { CanvasNode } from "./ManjuCanvas";

export interface FlowStep {
  id: WorkflowMode | "overview";
  title: string;
  icon: React.ReactNode;
  description?: string;
  status?: "empty" | "draft" | "done" | "error";
  count?: number;
}

export interface ManjuFlowSidebarProps {
  steps: FlowStep[];
  activeStep: WorkflowMode | "overview";
  onStepChange: (step: WorkflowMode | "overview") => void;
  onGenerate?: (step: WorkflowMode) => void;
  generating?: WorkflowMode | null;
  projectName: string;
  collapsed?: boolean;
  onAddNode?: (type: CanvasNode["type"], x: number, y: number) => void;
  onToggleCollapse?: () => void;
}

const STEP_ORDER: (WorkflowMode | "overview")[] = [
  "overview",
  "script",
  "assets",
  "storyboardImage",
  "storyboardVideo",
];

export default function ManjuFlowSidebar({
  steps,
  activeStep,
  onStepChange,
  onGenerate,
  generating,
  projectName,
  collapsed,
  onToggleCollapse,
  onAddNode,
}: ManjuFlowSidebarProps) {
  // 快捷操作按钮配置
  const quickActions = [
    { label: "镜头列表", icon: <Plus className="h-3.5 w-3.5" />, action: () => onStepChange("storyboardImage") },
    { label: "批量生成分镜图", icon: <Sparkles className="h-3.5 w-3.5" />, action: () => onStepChange("storyboardImage") },
    { label: "批量生成视频", icon: <Wand2 className="h-3.5 w-3.5" />, action: () => onStepChange("storyboardVideo") },
  ];

  const orderedSteps = STEP_ORDER.map<FlowStep>((id) =>
    steps.find((s) => s.id === id) || { id, title: id, icon: <Box className="h-4 w-4" /> }
  );

  const activeIndex = orderedSteps.findIndex((s) => s.id === activeStep);

  return (
    <div
      className={cn(
        "flex flex-col border-r border-surface-border bg-surface-elevated transition-all duration-200",
        collapsed ? "w-14" : "w-64"
      )}
    >
      {/* 项目标题区 */}
      <div className="flex items-center gap-2 border-b border-surface-border px-3 py-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
          <Clapperboard className="h-4 w-4" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-text-primary">{projectName}</div>
            <div className="truncate text-xs text-text-tertiary">漫剧 Studio</div>
          </div>
        )}
      </div>

      {/* 流程步骤 */}
      <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {orderedSteps.map((step, index) => {
          const isActive = step.id === activeStep;
          const isPast = index < activeIndex;
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => onStepChange(step.id as WorkflowMode | "overview")}
              className={cn(
                "group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
                isActive
                  ? "bg-brand/10 text-brand"
                  : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
              )}
            >
              {/* 状态指示器 */}
              <div className="relative flex h-7 w-7 shrink-0 items-center justify-center">
                {step.status === "done" && (
                  <span className="absolute inset-0 rounded-full bg-emerald-50" />
                )}
                {step.status === "error" && (
                  <span className="absolute inset-0 rounded-full bg-red-50" />
                )}
                {step.status === "draft" && (
                  <span className="absolute inset-0 rounded-full bg-amber-50" />
                )}
                <span
                  className={cn(
                    "relative z-10",
                    isActive && "text-brand",
                    isPast && !isActive && "text-status-done"
                  )}
                >
                  {step.icon}
                </span>
              </div>

              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{step.title}</span>
                    {step.count !== undefined && step.count > 0 && (
                      <span className="shrink-0 rounded-full bg-surface-card px-2 py-0.5 text-xs tabular-nums text-text-tertiary">
                        {step.count}
                      </span>
                    )}
                  </div>
                  {step.description && (
                    <div className="truncate text-xs text-text-tertiary">{step.description}</div>
                  )}
                </div>
              )}

              {/* 一键生成按钮（仅对分镜图和视频） */}
              {!collapsed &&
                onGenerate &&
                (step.id === "storyboardImage" || step.id === "storyboardVideo") &&
                step.status !== "done" && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onGenerate(step.id as WorkflowMode);
                    }}
                    disabled={generating === step.id}
                    className={cn(
                      "shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                      generating === step.id
                        ? "bg-surface-card text-text-tertiary"
                        : "bg-brand/10 text-brand hover:bg-brand/20"
                    )}
                  >
                    {generating === step.id ? "生成中" : "生成"}
                  </button>
                )}
            </button>
          );
        })}
      </div>

      {/* 快捷操作区 */}
      <div className="border-t border-surface-border p-2">
        <div className={cn("mb-2 text-xs font-medium text-text-tertiary", collapsed && "hidden")}>
          快捷操作
        </div>
        <div className={cn("grid gap-1.5", collapsed ? "grid-cols-1" : "grid-cols-1")}>
          <button
            type="button"
            onClick={() => onStepChange("storyboardImage")}
            className="flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface-base px-2.5 py-2 text-sm text-text-secondary transition-colors hover:border-brand/40 hover:bg-surface-hover hover:text-brand"
          >
            <Plus className="h-4 w-4" />
            {!collapsed && <span>镜头列表</span>}
          </button>
          <button
            type="button"
            onClick={() => onStepChange("storyboardImage")}
            className="flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface-base px-2.5 py-2 text-sm text-text-secondary transition-colors hover:border-brand/40 hover:bg-surface-hover hover:text-brand"
          >
            <Sparkles className="h-4 w-4" />
            {!collapsed && <span>批量生成分镜图</span>}
          </button>
          <button
            type="button"
            onClick={() => onStepChange("storyboardVideo")}
            className="flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface-base px-2.5 py-2 text-sm text-text-secondary transition-colors hover:border-brand/40 hover:bg-surface-hover hover:text-brand"
          >
            <Wand2 className="h-4 w-4" />
            {!collapsed && <span>批量生成视频</span>}
          </button>
        </div>
      </div>

      {/* 底部折叠按钮 */}
      <div className="border-t border-surface-border p-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex w-full items-center justify-center gap-1 rounded-lg py-2 text-xs text-text-tertiary hover:bg-surface-card hover:text-text-secondary"
        >
          {collapsed ? "→" : "← 收起"}
        </button>
      </div>
    </div>
  );
}

/** 根据项目数据构建流程步骤 */
export function buildFlowSteps(
  project: {
    script?: string;
    assets?: unknown[];
    storyboardShots?: unknown[];
    generationQueue?: unknown[];
  },
  t: (key: string) => string = (k) => k
): FlowStep[] {
  return [
    {
      id: "overview",
      title: t("overview") || "总览",
      icon: <LayoutGrid className="h-4 w-4" />,
      description: t("overview_desc") || "项目概览与进度",
      status: project.storyboardShots && project.storyboardShots.length > 0 ? "done" : "empty",
      count: project.storyboardShots?.length,
    },
    {
      id: "script",
      title: t("script") || "剧本",
      icon: <BookOpen className="h-4 w-4" />,
      description: t("script_desc") || "小说/剧本/分镜脚本",
      status: project.script && project.script.length > 100 ? "done" : project.script ? "draft" : "empty",
    },
    {
      id: "assets",
      title: t("assets") || "资产",
      icon: <Box className="h-4 w-4" />,
      description: t("assets_desc") || "角色/场景/道具",
      status: project.assets && project.assets.length > 0 ? "done" : "empty",
      count: project.assets?.length,
    },
    {
      id: "storyboardImage",
      title: t("storyboard") || "分镜图",
      icon: <Image className="h-4 w-4" />,
      description: t("storyboard_desc") || "草稿/正式分镜图",
      status: project.storyboardShots && project.storyboardShots.length > 0 ? "draft" : "empty",
      count: project.storyboardShots?.length,
    },
    {
      id: "storyboardVideo",
      title: t("video") || "视频",
      icon: <Video className="h-4 w-4" />,
      description: t("video_desc") || "Seedance 视频生成",
      status: project.generationQueue && project.generationQueue.length > 0 ? "draft" : "empty",
      count: project.generationQueue?.length,
    },
  ];
}
