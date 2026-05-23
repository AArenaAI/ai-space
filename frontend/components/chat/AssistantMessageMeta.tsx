"use client";

import { FileText, Lightbulb, Search, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatModel, Message } from "@/hooks/useChat";
import { useMessageRealtime } from "@/hooks/useMessageRealtime";

type ActivityStatus = NonNullable<Message["activityStatus"]>;
type SearchStatus = Message["searchStatus"];
type RealtimeActivityStatus = { kind: string; status: string; label: string };


interface NormalizedStatus {
  key: string;
  kind: ActivityStatus["kind"] | "web_search_done";
  label: string;
  tone: "blue" | "green" | "amber" | "purple";
  active: boolean;
}

function coerceActivityStatus(activity?: ActivityStatus | RealtimeActivityStatus): ActivityStatus | undefined {
  if (!activity) return undefined;

  let kind: ActivityStatus["kind"] = "generating";
  if (
    activity.kind === "reasoning" ||
    activity.kind === "web_search" ||
    activity.kind === "file_search" ||
    activity.kind === "tool_call" ||
    activity.kind === "generating"
  ) {
    kind = activity.kind;
  }

  let status: ActivityStatus["status"] = "running";
  if (activity.status === "searching" || activity.status === "completed" || activity.status === "running") {
    status = activity.status;
  }

  return { kind, status, label: activity.label };
}

function normalizeActivityStatus(activity?: ActivityStatus | RealtimeActivityStatus): ActivityStatus | undefined {
  const normalized = coerceActivityStatus(activity);
  if (!normalized || normalized.status === "completed") return undefined;
  if (normalized.kind === "web_search" || normalized.kind === "file_search") {
    return { ...normalized, label: normalized.label || "正在搜索" };
  }
  if (normalized.kind === "reasoning") {
    return { ...normalized, label: normalized.label || "深度推理中，片刻即达极致答案" };
  }
  return { ...normalized, label: normalized.label || "正在生成内容" };
}

function getSearchStatus(searchStatus?: SearchStatus, searchSources?: unknown[]): NormalizedStatus | undefined {
  const sourceCount = searchSources?.length || 0;
  if (searchStatus === "searching") {
    return {
      key: "web_search:running",
      kind: "web_search",
      label: "正在联网搜索",
      tone: "blue",
      active: true,
    };
  }
  if (searchStatus === "completed" || sourceCount > 0) {
    return {
      key: "web_search:completed",
      kind: "web_search_done",
      label: `已联网搜索${sourceCount > 0 ? ` · 引用${sourceCount}个来源` : ""}`,
      tone: "green",
      active: false,
    };
  }
  return undefined;
}

function getActivityStatus(activity?: ActivityStatus | RealtimeActivityStatus): NormalizedStatus | undefined {
  const normalized = normalizeActivityStatus(activity);
  if (!normalized) return undefined;

  if (normalized.kind === "reasoning") {
    return {
      key: "reasoning:running",
      kind: "reasoning",
      label: normalized.label,
      tone: "purple",
      active: true,
    };
  }

  if (normalized.kind === "web_search") {
    return {
      key: "web_search:running",
      kind: "web_search",
      label: normalized.label === "正在生成内容" ? "正在联网搜索" : normalized.label,
      tone: "blue",
      active: true,
    };
  }

  if (normalized.kind === "file_search") {
    return {
      key: "file_search:running",
      kind: "file_search",
      label: normalized.label === "正在生成内容" ? "正在搜索文件" : normalized.label,
      tone: "amber",
      active: true,
    };
  }

  return {
    key: `${normalized.kind}:running`,
    kind: normalized.kind,
    label: normalized.label,
    tone: "amber",
    active: true,
  };
}

function getUnifiedStatuses(params: {
  activityStatus?: ActivityStatus | RealtimeActivityStatus;
  searchStatus?: SearchStatus;
  searchSources?: unknown[];
}): NormalizedStatus[] {
  const activity = getActivityStatus(params.activityStatus);
  const search = getSearchStatus(params.searchStatus, params.searchSources);

  // 合并搜索标签：activity_meta 和 search_meta 同时存在时，只显示一个搜索状态。
  if (activity?.kind === "web_search") {
    return [activity];
  }
  if (search) {
    return activity ? [search, activity] : [search];
  }
  return activity ? [activity] : [];
}

function StatusIcon({ status }: { status: NormalizedStatus }) {
  const className = cn("w-3 h-3", status.active && "animate-pulse");
  if (status.kind === "tool_call") return <Wrench className={className} />;
  if (status.kind === "file_search") return <FileText className={className} />;
  if (status.kind === "reasoning") return <Lightbulb className={className} />;
  return <Search className={className} />;
}

function toneClass(tone: NormalizedStatus["tone"]) {
  if (tone === "green") return "text-green-600 bg-green-500/10";
  if (tone === "blue") return "text-blue-600 bg-blue-500/10";
  if (tone === "purple") return "text-purple-600 bg-purple-500/10";
  return "text-amber-600 bg-amber-500/10";
}

export function AssistantMessageMeta({ msg, isStreaming, model }: { msg: Message; isStreaming: boolean; model?: ChatModel }) {
  const realtime = useMessageRealtime(isStreaming ? msg.id : "");
  const activityStatus = realtime?.activityStatus ?? msg.activityStatus;
  const searchStatus = realtime?.searchStatus ?? msg.searchStatus;
  const searchSources = realtime?.searchSources ?? msg.searchSources;
  const statuses = getUnifiedStatuses({ activityStatus, searchStatus, searchSources });

  if (!model) return null;

  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="flex items-center gap-1.5">
        <div className="w-1 h-1 rounded-full" style={{ backgroundColor: model.color }} />
        <span className="text-[11px] text-text-tertiary">{model.name}</span>
      </div>
      {statuses.map((status) => (
        <span
          key={status.key}
          className={cn("inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full", toneClass(status.tone))}
        >
          <StatusIcon status={status} />
          {status.label}
        </span>
      ))}
    </div>
  );
}
