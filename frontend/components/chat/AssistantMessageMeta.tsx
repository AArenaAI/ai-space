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

function formatTokenCount(tokens?: number) {
  if (!tokens || tokens <= 0) return "";
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1).replace(/\.0$/, "")}k tokens`;
  return `${tokens} tokens`;
}

function StatusIcon({ status, compact = false }: { status: MessageDisplayStatus; compact?: boolean }) {
  const className = "h-3 w-3";
  if (compact) {
    if (status.kind === "completed") return <CheckCircle className="h-3 w-3" data-chat-status-icon="completed" />;
    if (status.kind === "error") return <AlertCircle className="h-3 w-3" data-chat-status-icon="error" />;
    if (status.kind === "stopped") return <CircleStop className="h-3 w-3" data-chat-status-icon="stopped" />;
    return <span className="h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" data-chat-status-icon="spinning" />;
  }
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
  if (tone === "green") return "text-emerald-500/85 bg-transparent";
  if (tone === "blue") return "text-brand bg-transparent";
  if (tone === "purple") return "text-brand bg-transparent";
  if (tone === "amber") return "text-brand bg-transparent";
  if (tone === "neutral") return "text-text-tertiary bg-transparent";
  if (tone === "red") return "text-red-500/85 bg-transparent";
  return "text-brand bg-transparent";
}

function timelineIconClass(step: ChatStatusTimelineStep) {
  if (step.status === "completed") return "text-emerald-500/85 bg-transparent";
  if (step.status === "failed") return "text-red-500/85 bg-transparent";
  if (step.status === "stopped") return "text-text-tertiary bg-transparent";
  if (step.kind === "web_search" || step.kind === "file_search") return "text-brand bg-transparent";
  if (step.kind === "reasoning") return "text-brand bg-transparent";
  return "text-brand bg-transparent";
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

function StatusTimelinePanel({ status, tokensUsed }: { status: MessageDisplayStatus; tokensUsed?: number }) {
  const { t } = useI18n();
  const steps = getOrderedTimelineSteps(status.statusTimeline).map((step) => (
    status.phase === "completed" && step.status === "running"
      ? { ...step, status: "completed" as const }
      : step
  ));
  const tokenLabel = formatTokenCount(tokensUsed);
  if (!steps.length && !tokenLabel) return null;
  return (
    <div data-chat-status-timeline="true">
      {steps.length > 0 && (
        <>
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
        </>
      )}
      {tokenLabel && <div className={cn("text-[11px] text-text-tertiary", steps.length > 0 ? "mt-2 border-t border-surface-border pt-2" : "")}>消耗 {tokenLabel}</div>}
    </div>
  );
}

export function AssistantMessageMeta({ msg, isStreaming, model, compact = false, inlineStatus = false, onOpenActivity }: { msg: Message; isStreaming: boolean; model?: ChatModel; compact?: boolean; inlineStatus?: boolean; onOpenActivity?: () => void }) {
  const profileEnabled = isChatRenderProfileEnabled();
  const renderStartedAt = profileEnabled ? (typeof performance !== "undefined" ? performance.now() : Date.now()) : 0;
  const { t } = useI18n();
  const [, setTick] = useState(0);
  const [activeStatusKey, setActiveStatusKey] = useState<string | null>(null);
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
  const activeStatus = statuses.find((status) => status.key === activeStatusKey);
  const canShowActiveStatusDetails = Boolean(!inlineStatus && activeStatus && (activeStatus.statusTimeline?.length || msg.tokensUsed || activeStatus.label));
  const visibleStatuses = inlineStatus ? statuses.filter((status) => status.phase !== "completed") : statuses;

  return (
    <div className={cn("relative flex items-center gap-2", inlineStatus ? "justify-start" : "justify-between", compact ? "mb-0" : "mb-2")} onMouseLeave={() => setActiveStatusKey(null)}>
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden="true"
          className={cn(
            "relative inline-flex h-2 w-2 shrink-0 items-center justify-center rounded-full",
            isStreaming && "animate-pulse"
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full opacity-80 shadow-[0_0_0_2px_rgba(99,102,241,0.08)]" style={{ backgroundColor: model.color }} />
        </span>
        <span className="truncate text-[11px] text-text-tertiary">{model.name}</span>
      </div>
      <div className={cn("flex shrink-0 items-center gap-1", inlineStatus ? "ml-0" : "ml-auto")}>
        {visibleStatuses.map((status) => {
          const canShowDetails = Boolean(!inlineStatus && (status.statusTimeline?.length || msg.tokensUsed || status.label));
          const content = (
            <span
              data-chat-generation-phase={status.generationPhase}
              data-chat-status-kind={status.kind}
              title={status.label}
              aria-label={status.label}
              onMouseEnter={() => !inlineStatus && setActiveStatusKey(status.key)}
              onFocus={() => !inlineStatus && setActiveStatusKey(status.key)}
              className={cn(
                "inline-flex h-5 min-w-5 items-center justify-center rounded-full text-[11px] transition-all duration-150",
                inlineStatus ? "cursor-pointer" : "cursor-default",
                canShowDetails && "group-hover/status:-translate-y-0.5 group-hover/status:brightness-110",
                toneClass(status.tone)
              )}
            >
              <StatusIcon status={status} compact />
            </span>
          );
          return inlineStatus ? (
            <button key={status.key} type="button" className="group/status inline-flex" onClick={onOpenActivity} aria-label={status.label}>
              {content}
            </button>
          ) : (
            <span key={status.key} className="group/status inline-flex">{content}</span>
          );
        })}
      </div>
      {activeStatus && canShowActiveStatusDetails && (
        <div className="pointer-events-none absolute right-0 top-full z-[2] mt-1.5 flex max-w-full justify-end opacity-100 transition-opacity delay-75 duration-100 ease-out">
          <div className="w-fit min-w-[180px] max-w-[min(280px,100%)] rounded-2xl border border-surface-border/80 bg-surface-elevated p-2.5 text-left text-xs shadow-[0_12px_32px_rgba(15,23,42,0.14)] backdrop-blur-md dark:shadow-[0_18px_42px_rgba(0,0,0,0.32)]">
            <div className="mb-2 flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-text-secondary">
              <StatusIcon status={activeStatus} />
              <span className="min-w-0 truncate">{activeStatus.label}</span>
            </div>
            <StatusTimelinePanel status={activeStatus} tokensUsed={msg.tokensUsed} />
          </div>
        </div>
      )}
    </div>
  );
}
