"use client";

import { ArrowDownToLine, Copy, CornerDownRight } from "lucide-react";
import type { DirectorBlock, StoryboardShot } from "./types";
import { findDirectorBlockForShot } from "./directorBlock";

type Props = {
  activeShot: StoryboardShot;
  shots: StoryboardShot[];
  directorBlocks: DirectorBlock[];
  selectedShotIds: string[];
  onInheritFromPrevious: () => void;
  onApplyToFollowing: () => void;
  onApplyToSelected: () => void;
};

export default function DirectorInheritanceControls({
  activeShot,
  shots,
  directorBlocks,
  selectedShotIds,
  onInheritFromPrevious,
  onApplyToFollowing,
  onApplyToSelected,
}: Props) {
  const activeIndex = shots.findIndex((shot) => shot.id === activeShot.id);
  const previousShot = activeIndex > 0 ? shots[activeIndex - 1] : undefined;
  const previousHasDirector = previousShot ? Boolean(findDirectorBlockForShot(directorBlocks, previousShot.id)) : false;
  const activeHasDirector = Boolean(findDirectorBlockForShot(directorBlocks, activeShot.id));
  const followingCount = activeIndex >= 0 ? Math.max(0, shots.length - activeIndex - 1) : 0;
  const selectedTargetCount = selectedShotIds.filter((id) => id !== activeShot.id).length;

  return (
    <div className="rounded-2xl border border-brand/20 bg-brand/5 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-text-primary">导演台继承</div>
          <p className="mt-1 text-xs leading-5 text-text-tertiary">复制场景结构、角色站位、姿势和机位到其他镜头；覆盖目标镜头已有导演台。</p>
        </div>
        {activeHasDirector ? <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand">当前已配置</span> : <span className="rounded-full bg-surface-card px-2 py-0.5 text-[10px] text-text-tertiary">当前未配置</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onInheritFromPrevious}
          disabled={!previousShot || !previousHasDirector}
          className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-card px-3 py-1.5 text-xs font-medium text-text-secondary hover:border-brand/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-45"
          title={!previousShot ? "当前已经是第一个镜头" : previousHasDirector ? "从上一镜头复制导演台到当前镜头" : "上一镜头还没有导演台"}
        >
          <ArrowDownToLine className="h-3.5 w-3.5" />
          从上一镜头继承
        </button>
        <button
          type="button"
          onClick={onApplyToFollowing}
          disabled={!activeHasDirector || followingCount === 0}
          className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-card px-3 py-1.5 text-xs font-medium text-text-secondary hover:border-brand/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-45"
          title={!activeHasDirector ? "当前镜头还没有导演台" : followingCount ? `覆盖后续 ${followingCount} 个镜头` : "没有后续镜头"}
        >
          <CornerDownRight className="h-3.5 w-3.5" />
          应用到后续镜头({followingCount})
        </button>
        <button
          type="button"
          onClick={onApplyToSelected}
          disabled={!activeHasDirector || selectedTargetCount === 0}
          className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/15 disabled:cursor-not-allowed disabled:opacity-45"
          title={!activeHasDirector ? "当前镜头还没有导演台" : selectedTargetCount ? `覆盖已选 ${selectedTargetCount} 个镜头` : "先在镜头总览表勾选目标镜头"}
        >
          <Copy className="h-3.5 w-3.5" />
          应用到选中镜头({selectedTargetCount})
        </button>
      </div>
    </div>
  );
}
