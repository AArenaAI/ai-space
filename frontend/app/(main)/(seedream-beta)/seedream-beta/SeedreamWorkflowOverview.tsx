"use client";

import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowMode, StoryboardShot } from "./types";
import Grid4x3 from "./Grid4x3";
import VideoSegmentGenerator, { type VideoSegment } from "./VideoSegmentGenerator";

type WorkflowStepCard = {
  id: WorkflowMode;
  index: number;
  titleKey: string;
  descKey: string;
  done: boolean;
  count: string;
  preview: string;
};

type ProjectStat = {
  label: string;
  value: string;
  done: boolean;
};

type ImportCheck = {
  label: string;
  value: string;
  ok: boolean;
  hint: string;
};

type ImportLayer = "script" | "storyboard" | "seedance";

type Props = {
  workspaceProjectName: string;
  workflowStepCards: WorkflowStepCard[];
  projectStats: ProjectStat[];
  importChecks: ImportCheck[];
  scriptImportText: string;
  storyboardImportText: string;
  seedanceImportText: string;
  setScriptImportText: (value: string) => void;
  setStoryboardImportText: (value: string) => void;
  setSeedanceImportText: (value: string) => void;
  handleImportFile: (layer: ImportLayer, event: React.ChangeEvent<HTMLInputElement>) => void;
  importLayerText: (layer: ImportLayer, value: string) => void;
  openWorkflowStep: (mode: WorkflowMode) => void;
  t: (key: string) => string;
  storyboardShots: StoryboardShot[];
  activeShotId?: string;
  sendShotToImage: (shot: StoryboardShot) => void;
  sendShotToVideo: (shot: StoryboardShot) => void;
  generateShotImage: (shot: StoryboardShot) => Promise<unknown>;
  generateShotVideo: (shot: StoryboardShot) => Promise<unknown>;
};

export default function SeedreamWorkflowOverview({
  workspaceProjectName,
  workflowStepCards,
  projectStats,
  importChecks,
  scriptImportText,
  storyboardImportText,
  seedanceImportText,
  setScriptImportText,
  setStoryboardImportText,
  setSeedanceImportText,
  handleImportFile,
  importLayerText,
  openWorkflowStep,
  t,
  storyboardShots,
  activeShotId,
  sendShotToImage,
  sendShotToVideo,
  generateShotImage,
  generateShotVideo,
}: Props) {
  const importCards: Array<{
    key: ImportLayer;
    title: string;
    desc: string;
    value: string;
    setter: (value: string) => void;
  }> = [
    { key: "script", title: "纯剧本版", desc: "写入剧本层，不带生成指令", value: scriptImportText, setter: setScriptImportText },
    { key: "storyboard", title: "故事板版", desc: "解析段落/镜头，生成故事板卡片", value: storyboardImportText, setter: setStoryboardImportText },
    { key: "seedance", title: "Seedance直接投喂版", desc: "写入每镜头视频提示词", value: seedanceImportText, setter: setSeedanceImportText },
  ];

  const generateSegment = async (segment: VideoSegment) => {
    for (const shot of segment.shots) {
      await generateShotVideo(shot);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-surface-border bg-surface-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{workspaceProjectName}</h2>
            <p className="text-xs text-text-tertiary">
              漫剧生产线 · {workflowStepCards.filter((s) => s.done).length}/{workflowStepCards.length} 阶段已准备
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {projectStats.map((stat) => (
            <div
              key={stat.label}
              className={cn(
                "rounded-2xl border px-3 py-2.5",
                stat.done ? "border-brand/30 bg-brand/5" : "border-surface-border bg-surface-elevated"
              )}
            >
              <div className="text-[11px] font-medium text-text-tertiary">{stat.label}</div>
              <div className={cn("mt-1 text-sm font-semibold", stat.done ? "text-brand" : "text-text-secondary")}>{stat.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-surface-border bg-surface-card p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">导入检查</h3>
            <p className="mt-1 text-xs leading-5 text-text-tertiary">
              用来确认三件套是否落到正确层级：剧本、故事板镜头卡、Seedance视频提示词、资产/素材绑定。
            </p>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {importChecks.map((item) => (
            <div key={item.label} className={cn("rounded-2xl border p-3", item.ok ? "border-emerald-200 bg-emerald-50/70" : "border-amber-200 bg-amber-50/70")}>
              <div className="flex items-center justify-between gap-2">
                <span className={cn("text-xs font-semibold", item.ok ? "text-emerald-700" : "text-amber-700")}>{item.label}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", item.ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>{item.ok ? "正常" : "待处理"}</span>
              </div>
              <div className="mt-1 text-sm font-semibold text-text-primary">{item.value}</div>
              <div className="mt-1 text-[11px] leading-4 text-text-tertiary">{item.hint}</div>
            </div>
          ))}
        </div>
      </div>

      {storyboardShots.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <div className="rounded-3xl border border-surface-border bg-surface-card p-4">
            <Grid4x3
              shots={storyboardShots}
              selectedShotId={activeShotId}
              onSelectShot={sendShotToImage}
              onGenerateImage={generateShotImage}
              onGenerateVideo={generateShotVideo}
            />
          </div>
          <div className="rounded-3xl border border-surface-border bg-surface-card p-4">
            <VideoSegmentGenerator
              shots={storyboardShots}
              onGenerateSegment={generateSegment}
              onExtractLastFrame={async () => ""}
            />
          </div>
        </div>
      )}

      <div className="rounded-3xl border border-brand/20 bg-brand/5 p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">导入三件套</h3>
            <p className="mt-1 text-xs leading-5 text-text-tertiary">
              已拆好的纯剧本版、故事板版、Seedance直接投喂版可以分别导入到对应层；故事板和投喂版会自动解析成镜头卡。
            </p>
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {importCards.map((item) => (
            <div key={item.key} className="rounded-2xl border border-surface-border bg-surface-card p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-text-primary">{item.title}</div>
                  <div className="text-[11px] text-text-tertiary">{item.desc}</div>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-surface-border bg-surface-elevated px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:border-brand/40 hover:text-text-primary">
                  <UploadCloud className="h-3.5 w-3.5" />
                  文件
                  <input type="file" accept=".md,.txt,text/markdown,text/plain" className="hidden" onChange={(event) => handleImportFile(item.key, event)} />
                </label>
              </div>
              <textarea
                value={item.value}
                onChange={(event) => item.setter(event.target.value)}
                placeholder={`粘贴${item.title}内容……`}
                className="min-h-24 w-full resize-y rounded-xl border border-surface-border bg-surface-elevated px-3 py-2 text-xs leading-5 outline-none focus:border-brand/60"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-text-tertiary">{item.value.trim() ? `${item.value.trim().length} 字` : "可粘贴或上传"}</span>
                <button
                  type="button"
                  onClick={() => importLayerText(item.key, item.value)}
                  disabled={!item.value.trim()}
                  className="rounded-xl bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover disabled:opacity-50"
                >
                  导入
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {workflowStepCards.map((step) => (
          <button
            key={step.id}
            type="button"
            onClick={() => openWorkflowStep(step.id)}
            className={cn(
              "group rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5",
              step.done ? "border-brand/40 bg-brand/5" : "border-surface-border bg-surface-card"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold", step.done ? "bg-brand text-white" : "bg-surface-elevated text-text-tertiary")}>{step.index + 1}</div>
              <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", step.done ? "bg-brand/10 text-brand" : "bg-surface-elevated text-text-tertiary")}>{step.done ? t("seedreamBeta.workflow.ready") : t("seedreamBeta.workflow.empty")}</span>
            </div>
            <div className="mt-3 text-sm font-semibold text-text-primary">{t(step.titleKey)}</div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-tertiary">{step.preview || t(step.descKey)}</p>
            <div className="mt-3 text-xs font-medium text-brand">{step.done ? "查看" : "开始"} →</div>
          </button>
        ))}
      </div>
    </div>
  );
}
