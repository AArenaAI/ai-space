"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle, CircleStop, FileText, Lightbulb, LoaderCircle, Search, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatModel, Message } from "@/lib/chatTypes";
import { useMessageRealtime } from "@/hooks/useMessageRealtime";
import { deriveMessageStatuses, type MessageDisplayStatus } from "@/lib/messageStatus";
import { getOrderedTimelineSteps, getTimelineStepLabel, type ChatStatusTimelineStep } from "@/lib/chatStatusTimeline";
import { useI18n } from "@/lib/i18n";
import { emitChatRenderProfileEvent, isChatRenderProfileEnabled } from "@/lib/chatRenderProfile";

function StatusIcon({ status }: { status: MessageDisplayStatus }) {
  const className = "h-3 w-3";
  const spinningClassName = cn(className, status.active && "animate-spin");
  const activeClassName = cn(className, status.active && "animate-pulse");
  if (status.kind === "completed") return <CheckCircle className={className} data-chat-status-icon="completed" />;
  if (status.kind === "generating" || status.kind === "finalizing") return <LoaderCircle className={spinningClassName} data-chat-status-icon="spinning" />;
  if (status.kind === "tool_call") return <Wrench className={activeClassName} data-chat-status-icon="tool_call" />;
  if (status.kind === "file_search") return <FileText className={activeClassName} data-chat-status-icon="file_search" />;
  if (status.kind === "thinking") return <Lightbulb className={activeClassName} data-chat-status-icon="thinking" />;
  if (status.kind === "error") return <AlertCircle className={className} data-chat-status-icon="error" />;
  if (status.kind === "stopped") return <CircleStop className={className} data-chat-status-icon="stopped" />;
  if (status.kind === "web_search") return <Search className={activeClassName} data-chat-status-icon="web_search" />;
  return <Search className={activeClassName} data-chat-status-icon="default" />;
}

function toneClass(tone: MessageDisplayStatus["tone"]) {
  if (tone === "green") return "text-green-600 bg-green-500/10";
  if (tone === "blue") return "text-blue-600 bg-blue-500/10";
  if (tone === "purple") return "text-purple-600 bg-purple-500/10";
  if (tone === "red") return "text-red-600 bg-red-500/10";
  if (tone === "neutral") return "text-text-secondary bg-surface-card";
  return "text-amber-600 bg-amber-500/10";
}

function timelineIconClass(step: ChatStatusTimelineStep) {
  if (step.status === "completed") return "text-green-600 bg-green-500/10";
  if (step.status === "failed") return "text-red-600 bg-red-500/10";
  if (step.status === "stopped") return "text-text-tertiary bg-surface";
  if (step.kind === "web_search" || step.kind === "file_search") return "text-blue-600 bg-blue-500/10";
  if (step.kind === "reasoning") return "text-purple-600 bg-purple-500/10";
  return "text-amber-600 bg-amber-500/10";
}

function TimelineStepIcon({ step }: { step: ChatStatusTimelineStep }) {
  const className = "h-3 w-3";
  if (step.status === "completed") return <span aria-hidden="true">✅</span>;
  if (step.status === "failed") return <AlertCircle className={className} aria-hidden="true" />;
  if (step.status === "stopped") return <CircleStop className={className} aria-hidden="true" />;
  if (step.kind === "web_search") return <Search className={className} aria-hidden="true" />;
  if (step.kind === "file_search") return <FileText className={className} aria-hidden="true" />;
  if (step.kind === "tool_call") return <Wrench className={className} aria-hidden="true" />;
  if (step.kind === "reasoning") return <Lightbulb className={className} aria-hidden="true" />;
  return <LoaderCircle className={cn(className, "animate-spin")} aria-hidden="true" />;
}

function StatusTimelinePanel({ status }: { status: MessageDisplayStatus }) {
  const { t } = useI18n();
  const steps = getOrderedTimelineSteps(status.statusTimeline).map((step) => (
    status.phase === "completed" && step.status === "running"
      ? { ...step, status: "completed" as const }
      : step
  ));
  if (!steps.length) return null;
  return (
    <div
      className="w-max min-w-[240px] max-w-[360px] rounded-xl border border-border bg-surface-card p-2.5 text-left shadow-xl"
      data-chat-status-timeline="true"
    >
      <div className="mb-1.5 text-[11px] font-medium text-text-secondary">{t("chat.status.timelineTitle")}</div>
      <div className="space-y-1.5">
        {steps.map((step, index) => (
          <div
            key={`${step.kind}:${step.status}:${index}`}
            className="flex items-start gap-2 text-[11px] text-text-secondary"
            data-chat-status-timeline-step={`${step.kind}:${step.status}`}
          >
            <span
              className={cn("mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full", timelineIconClass(step))}
              data-chat-status-timeline-icon={step.status === "completed" ? "completed" : step.kind}
            >
              <TimelineStepIcon step={step} />
            </span>
            <span>{getTimelineStepLabel(t, step, status.generationStartedAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AssistantMessageMeta({ msg, isStreaming, model }: { msg: Message; isStreaming: boolean; model?: ChatModel }) {
  const profileEnabled = isChatRenderProfileEnabled();
  const renderStartedAt = profileEnabled ? (typeof performance !== "undefined" ? performance.now() : Date.now()) : 0;
  const { t } = useI18n();
  const [, setTick] = useState(0);
  const realtimeSubscriptionEnabled = isStreaming || !(msg.completedAt || msg.errorCode || msg.stopped);
  const realtime = useMessageRealtime(msg.id, realtimeSubscriptionEnabled);
  const statuses = useMemo(
    () => deriveMessageStatuses({ message: msg, realtime, isStreaming, t }),
    [isStreaming, msg, realtime, t]
  );
  const hasActiveGenerationPhase = useMemo(
    () => statuses.some((status) => status.active && status.generationPhase),
    [statuses]
  );
  const hasTimeline = useMemo(
    () => statuses.some((status) => Boolean(status.statusTimeline?.length)),
    [statuses]
  );

  useEffect(() => {
    if (!profileEnabled) return;
    const commitAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    emitChatRenderProfileEvent("assistant-message-meta-commit", {
      messageId: msg.id,
      contentLength: msg.content?.length || 0,
      statusCount: statuses.length,
      hasActiveGenerationPhase,
      hasTimeline,
      isStreaming,
      realtimeSubscriptionEnabled,
      modelId: model?.id || msg.model || "",
      durationMs: commitAt - renderStartedAt,
    });
  });

  useEffect(() => {
    if (!hasActiveGenerationPhase) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveGenerationPhase, msg.id]);

  if (!model) return null;

  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="flex items-center gap-1.5">
        <div className="w-1 h-1 rounded-full" style={{ backgroundColor: model.color }} />
        <span className="text-[11px] text-text-tertiary">{model.name}</span>
      </div>
      {statuses.map((status) => {
        const hasTimeline = !!status.statusTimeline?.length;
        return (
          <span key={status.key} className="group/status relative inline-flex">
            <span
              data-chat-generation-phase={status.generationPhase}
              data-chat-status-kind={status.kind}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] cursor-default transition-all duration-150",
                hasTimeline && "group-hover/status:-translate-y-0.5 group-hover/status:shadow-md group-hover/status:brightness-110 group-hover/status:saturate-125",
                toneClass(status.tone)
              )}
            >
              <StatusIcon status={status} />
              {status.label}
            </span>
            {hasTimeline && (
              <div className="pointer-events-none absolute left-0 top-full z-[120] mt-2 hidden group-hover/status:block group-focus-within/status:block">
                <StatusTimelinePanel status={status} />
              </div>
            )}
          </span>
        );
      })}
    </div>
  );
}
