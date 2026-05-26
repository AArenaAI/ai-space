"use client";

import { FileText, Lightbulb, Search, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatModel, Message } from "@/hooks/useChat";
import { useMessageRealtime } from "@/hooks/useMessageRealtime";
import { getActivityLabel } from "@/lib/chatActivityStatus";
import { useI18n } from "@/lib/i18n";

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

function normalizeActivityStatus(t: (key: string) => string, activity?: ActivityStatus | RealtimeActivityStatus): ActivityStatus | undefined {
  const normalized = coerceActivityStatus(activity);
  if (!normalized || normalized.kind === "reasoning") return undefined;
  return {
    ...normalized,
    label: getActivityLabel(t, normalized.kind, normalized.status, normalized.label),
  };
}

function getSearchStatus(t: (key: string) => string, searchStatus?: SearchStatus, searchSources?: unknown[], searchSourcesCount?: number): NormalizedStatus | undefined {
  const sourceCount = typeof searchSourcesCount === "number" ? searchSourcesCount : (searchSources?.length || 0);
  if (searchStatus === "searching") {
    return {
      key: "web_search:running",
      kind: "web_search",
      label: t("chat.status.webSearch"),
      tone: "blue",
      active: true,
    };
  }
  if (searchStatus === "completed" || sourceCount > 0) {
    return {
      key: "web_search:completed",
      kind: "web_search_done",
      label: `${t("chat.status.webSearchDone")}${sourceCount > 0 ? ` · ${t("chat.status.cited")}${sourceCount}${t("chat.status.sources")}` : ""}`,
      tone: "green",
      active: false,
    };
  }
  return undefined;
}

function getActivityStatus(t: (key: string) => string, activity?: ActivityStatus | RealtimeActivityStatus): NormalizedStatus | undefined {
  const normalized = normalizeActivityStatus(t, activity);
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
      key: `web_search:${normalized.status}`,
      kind: "web_search",
      label: normalized.label,
      tone: normalized.status === "completed" ? "green" : "blue",
      active: normalized.status !== "completed",
    };
  }

  if (normalized.kind === "file_search") {
    return {
      key: `file_search:${normalized.status}`,
      kind: "file_search",
      label: normalized.label,
      tone: normalized.status === "completed" ? "green" : "amber",
      active: normalized.status !== "completed",
    };
  }

  return {
    key: `${normalized.kind}:${normalized.status}`,
    kind: normalized.kind,
    label: normalized.label,
    tone: normalized.status === "completed" ? "green" : "amber",
    active: normalized.status !== "completed",
  };
}

function getUnifiedStatuses(t: (key: string) => string, params: {
  activityStatus?: ActivityStatus | RealtimeActivityStatus;
  searchStatus?: SearchStatus;
  searchSources?: unknown[];
  searchSourcesCount?: number;
  isCompleted?: boolean;
}): NormalizedStatus[] {
  const activity = getActivityStatus(t, params.activityStatus);
  const search = getSearchStatus(t, params.searchStatus, params.searchSources, params.searchSourcesCount);

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
  const { t } = useI18n();
  const realtime = useMessageRealtime(isStreaming ? msg.id : "");
  const activityStatus = realtime?.activityStatus ?? msg.activityStatus;
  const searchStatus = realtime?.searchStatus ?? msg.searchStatus;
  const searchSources = realtime?.searchSources ?? msg.searchSources;
  const searchSourcesCount = realtime?.searchSourcesCount ?? msg.searchSourcesCount;
  const statuses = getUnifiedStatuses(t, {
    activityStatus,
    searchStatus,
    searchSources,
    searchSourcesCount,
    isCompleted: !!msg.completedAt && !isStreaming,
  });

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
