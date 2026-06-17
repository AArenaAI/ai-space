"use client";

import { cn } from "@/lib/utils";
import {
  BookOpen,
  Box,
  Clapperboard,
  Image,
  LayoutGrid,
  Video,
} from "lucide-react";
import type { WorkflowMode } from "./types";

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
}: ManjuFlowSidebarProps) {
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
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
          <Clapperboard className="h-3.5 w-3.5" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-text-primary">{projectName}</div>
            <div className="truncate text-[10px] text-text-tertiary">漫剧 Studio</div>
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
              <div className="relative flex h-6 w-6 shrink-0 items-center justify-center">
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
                    isPast && !isActive && "text-emerald-500"
                  )}
                >
                  {step.icon}
                </span>
              </div>

              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-medium">{step.title}</span>
                    {step.count !== undefined && step.count > 0 && (
                      <span className="shrink-0 rounded-full bg-surface-card px-1.5 py-0 text-[10px] tabular-nums text-text-tertiary">
                        {step.count}
                      </span>
                    )}
                  </div>
                  {step.description && (
                    <div className="truncate text-[10px] text-text-tertiary">{step.description}</div>
                  )}
                </div>
              )}

              {/* 一键生成按钮（仅对可生成步骤） */}
              {!collapsed &&
                onGenerate &&
                step.id !== "overview" &&
                step.status !== "done" && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onGenerate(step.id as WorkflowMode);
                    }}
                    disabled={generating === step.id}
                    className={cn(
                      "shrink-0 rounded-lg px-2 py-1 text-[10px] font-medium transition-colors",
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

      {/* 底部折叠按钮 */}
      <div className="border-t border-surface-border p-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] text-text-tertiary hover:bg-surface-card hover:text-text-secondary"
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
