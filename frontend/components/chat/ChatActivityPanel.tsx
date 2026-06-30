"use client";

import { useEffect, useState } from "react";
import { X, Brain, Globe, FileText, CheckCircle, LoaderCircle, AlertCircle, Wrench, ChevronDown } from "lucide-react";
import type { Message, ChatModel } from "@/lib/chatTypes";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useMessageRealtime } from "@/hooks/useMessageRealtime";
import { getOrderedTimelineSteps, getTimelineStepLabel, type ChatStatusTimelineStep } from "@/lib/chatStatusTimeline";
import { formatElapsedTime } from "@/lib/chatGenerationPhase";

function statusIcon(step: ChatStatusTimelineStep) {
  if (step.status === "failed") return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
  if (step.status === "completed") return <CheckCircle className="h-3.5 w-3.5 text-emerald-500/85" />;
  if (step.kind === "web_search") return <Globe className="h-3.5 w-3.5 text-text-tertiary" />;
  if (step.kind === "file_search") return <FileText className="h-3.5 w-3.5 text-text-tertiary" />;
  if (step.kind === "tool_call") return <Wrench className="h-3.5 w-3.5 text-text-tertiary" />;
  if (step.kind === "reasoning") return <Brain className="h-3.5 w-3.5 text-text-tertiary" />;
  return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-text-tertiary" />;
}

function parseTimelineValue(value: unknown): ChatStatusTimelineStep[] | undefined {
  if (!value) return undefined;
  const parsed = Array.isArray(value) ? value : typeof value === "string" ? (() => {
    try { return JSON.parse(value); } catch { return undefined; }
  })() : undefined;
  if (!Array.isArray(parsed)) return undefined;
  const steps = parsed.filter((step): step is ChatStatusTimelineStep => !!step && typeof step === "object" && typeof step.kind === "string" && typeof step.status === "string" && typeof step.startedAt === "number");
  return steps.length ? steps : undefined;
}

function isTerminalMessage(message: Message) {
  return Boolean(
    message.completedAt ||
    message.stopped ||
    message.errorCode ||
    message.serverGenerationStatus === "completed" ||
    message.serverGenerationStatus === "failed" ||
    message.serverGenerationStatus === "cancelled" ||
    message.phase === "completed" ||
    message.phase === "failed" ||
    message.phase === "stopped"
  );
}

function mergeTimeline(message: Message, realtime: ReturnType<typeof useMessageRealtime>, snapshotTimeline?: ChatStatusTimelineStep[]) {
  if (isTerminalMessage(message)) {
    // Persisted terminal message state is the source of truth. Realtime entries
    // can survive briefly after route switches/open-close cycles and may still
    // contain a stale running reasoning step; the task snapshot will correct it
    // a second later, but the panel must not flash "reasoning" for completed
    // replies while waiting for that fetch.
    if (message.statusTimeline?.length) return message.statusTimeline;
    if (snapshotTimeline?.length) return snapshotTimeline;
    if (realtime?.completedAt || realtime?.stopped || realtime?.errorCode) return realtime.statusTimeline;
    return undefined;
  }
  if (realtime?.statusTimeline?.length) return realtime.statusTimeline;
  if (snapshotTimeline?.length) return snapshotTimeline;
  return message.statusTimeline;
}

function mergeSources(message: Message, realtime: ReturnType<typeof useMessageRealtime>) {
  return isTerminalMessage(message)
    ? (message.searchSources || realtime?.searchSources || [])
    : (realtime?.searchSources || message.searchSources || []);
}

function mergeReasoning(message: Message, realtime: ReturnType<typeof useMessageRealtime>) {
  return isTerminalMessage(message)
    ? (message.reasoningContent || realtime?.reasoningContent || "")
    : (realtime?.reasoningContent || message.reasoningContent || "");
}

function mergeContent(message: Message, realtime: ReturnType<typeof useMessageRealtime>) {
  return isTerminalMessage(message)
    ? (message.content || realtime?.content || "")
    : (realtime?.content || message.content || "");
}

function stepDuration(step: ChatStatusTimelineStep) {
  return Math.max(0, (step.endedAt || Date.now()) - step.startedAt);
}

function isLowSignalCompletedStep(step: ChatStatusTimelineStep) {
  const duration = stepDuration(step);
  if (duration >= 1000) return false;
  return step.kind === "waiting_provider" || step.kind === "streaming_answer" || step.kind === "finalizing";
}

function getActivityStepLabel(t: (key: string, params?: Record<string, string>) => string, step: ChatStatusTimelineStep, generationStartedAt?: number, durationStartAt?: number) {
  const label = getTimelineStepLabel(t, step, generationStartedAt);
  const duration = durationStartAt ? Math.max(0, (step.endedAt || Date.now()) - durationStartAt) : stepDuration(step);
  if (duration < 1000) return label;
  if (/\d+\s*(秒|s|sec|secs|second|seconds|分|m|min)/i.test(label)) return label;
  return `${label} · ${formatElapsedTime(duration, t)}`;
}

function formatReasoningSections(text: string) {
  const normalized = text
    .replace(/\r\n/g, "\n")
    // GPT-5.5 often returns explicit section titles inline as
    // `**Title** body **Next title** body`. Treat those model-provided
    // titles as real section headings without inventing frontend titles.
    .replace(/([。！？.!?])\s*(\*\*[^*\n]{2,80}\*\*)/g, "$1\n\n$2")
    .replace(/(^|\n)(\*\*[^*\n]{2,80}\*\*)\s+/g, "$1$2\n");
  return normalized
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((section) => {
      const inlineBoldHeading = section.match(/^\*\*([^*\n]{2,80})\*\*\s*([\s\S]*)$/);
      if (inlineBoldHeading) {
        return { title: inlineBoldHeading[1].trim(), body: inlineBoldHeading[2].trim() };
      }
      const lines = section.split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.length > 1) {
        const first = lines[0];
        const heading = first.match(/^#{1,4}\s+(.+)$/)?.[1]
          || first.match(/^\*\*(.+?)\*\*$/)?.[1]
          || first.match(/^(.{2,48})[：:]$/)?.[1];
        if (heading) return { title: heading.trim(), body: lines.slice(1).join("\n") };
      }
      return { body: section };
    });
}

function timelineDotClass(step: ChatStatusTimelineStep) {
  if (step.status === "failed") return "border-red-400 bg-red-400";
  if (step.status === "running") return "border-brand bg-brand shadow-[0_0_0_3px_rgba(124,92,255,0.12)]";
  return "border-surface-border bg-surface-elevated";
}

function countMarkdownSources(content?: string) {
  if (!content) return 0;
  const urls = new Set<string>();
  const markdownLinkPattern = /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = markdownLinkPattern.exec(content)) !== null) {
    urls.add(match[1].replace(/[),.;]+$/, ""));
  }
  const bareUrlPattern = /https?:\/\/[^\s)]+/g;
  while ((match = bareUrlPattern.exec(content)) !== null) {
    urls.add(match[0].replace(/[),.;]+$/, ""));
  }
  return urls.size;
}

export default function ChatActivityPanel({ message, model, onClose }: { message?: Message | null; model?: ChatModel; onClose: () => void }) {
  const { t } = useI18n();
  const [reasoningOpen, setReasoningOpen] = useState(true);
  const [snapshotTimeline, setSnapshotTimeline] = useState<ChatStatusTimelineStep[] | undefined>();
  const realtime = useMessageRealtime(message?.id || "", Boolean(message));
  useEffect(() => {
    setSnapshotTimeline(undefined);
    const taskId = message?.generationTaskId;
    if (!taskId || typeof window === "undefined") return;
    const token = window.localStorage.getItem("token");
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    let cancelled = false;
    const loadSnapshot = () => {
      fetch(`/api/tasks/${taskId}`, { headers, credentials: "include" })
        .then((res) => res.ok ? res.json() : undefined)
        .then((data) => {
          if (cancelled || !data) return;
          const timeline = parseTimelineValue(data?.message?.status_timeline || data?.task?.status_timeline);
          if (timeline?.length) setSnapshotTimeline(timeline);
        })
        .catch(() => {});
    };
    loadSnapshot();
    const timer = window.setInterval(loadSnapshot, 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [message?.generationTaskId, message?.id]);
  if (!message) return null;
  const terminalMessage = isTerminalMessage(message);
  const sources = Array.from(new Map(mergeSources(message, realtime).map((source) => [source.url || source.title, source])).values());
  const inferredSourceCount = sources.length || countMarkdownSources(mergeContent(message, realtime));
  const timeline = getOrderedTimelineSteps(mergeTimeline(message, realtime, snapshotTimeline))
    .map((step) => step.kind === "web_search" && !step.count && inferredSourceCount ? { ...step, count: inferredSourceCount } : step)
    .filter((step) => !isLowSignalCompletedStep(step));
  const files = message.files || [];
  const reasoning = mergeReasoning(message, realtime).trim();
  const reasoningSections = formatReasoningSections(reasoning);
  const active = !terminalMessage && !((realtime?.completedAt || message.completedAt) || realtime?.stopped || message.stopped || realtime?.errorCode || message.errorCode);
  const elapsedEndAt = terminalMessage
    ? (message.completedAt || realtime?.completedAt || Date.now())
    : (realtime?.completedAt || message.completedAt || Date.now());
  const elapsedStartAt = message.generationStartedAt || realtime?.generationStartedAt || message.createdAt || Date.now();
  const elapsedSeconds = Math.max(0, Math.round((elapsedEndAt - elapsedStartAt) / 1000));

  const timelineStartAt = timeline[0]?.startedAt || message.generationStartedAt || message.createdAt;

  return (
    <aside className="fixed inset-x-3 bottom-3 z-[220] flex max-h-[72vh] flex-col rounded-3xl border border-surface-border/70 bg-surface-elevated/95 p-5 shadow-2xl shadow-black/10 backdrop-blur-xl dark:shadow-black/40 lg:absolute lg:inset-y-0 lg:left-auto lg:right-0 lg:bottom-auto lg:h-full lg:w-[384px] lg:max-h-none lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-l lg:border-solid lg:border-surface-border/45 lg:bg-surface/85 lg:shadow-none" data-chat-activity-panel="true">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-semibold text-text-primary">思考与来源{active ? ` · ${elapsedSeconds}s` : ""}</div>
          <div className="mt-0.5 truncate text-sm text-text-tertiary">{model?.name || message.model || "AI"}</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1.5 text-text-tertiary hover:bg-surface-card hover:text-text-primary" aria-label="Close activity panel">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-chat-activity-scroll="true">
        <section className="mb-7">
          <div className="mb-4 text-sm font-semibold text-text-secondary">思考</div>
          <div className="relative space-y-0">
            {timeline.length ? timeline.map((step, index) => {
              const showReasoning = step.kind === "reasoning" && reasoning;
              const isLast = index === timeline.length - 1;
              const stepLabel = getActivityStepLabel(t, step, realtime?.generationStartedAt || message.generationStartedAt, step.kind === "streaming_answer" && step.status === "completed" ? timelineStartAt : undefined);
              return (
                <div key={`${step.id}:${index}`} className="relative grid grid-cols-[18px_1fr] gap-3 pb-5 last:pb-0">
                  {!isLast && <div className="absolute left-[8px] top-4 bottom-0 border-l border-dashed border-surface-border/80" aria-hidden="true" />}
                  <span className={cn("relative z-10 mt-1 h-2.5 w-2.5 rounded-full border", timelineDotClass(step))} aria-hidden="true" />
                  <div className="min-w-0">
                    {showReasoning ? (
                      <button
                        type="button"
                        onClick={() => setReasoningOpen((value) => !value)}
                        className="flex w-full items-center justify-between gap-2 rounded-lg py-0.5 text-left text-sm font-medium text-text-secondary hover:text-text-primary"
                      >
                        <span>{stepLabel}</span>
                        <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-tertiary transition-transform", reasoningOpen && "rotate-180")} />
                      </button>
                    ) : (
                      <div className="text-sm font-medium text-text-secondary">{stepLabel}</div>
                    )}
                    {showReasoning && (
                      <div className="mt-3">
                        {reasoningOpen && (
                          <div className="space-y-3 text-sm leading-relaxed text-text-tertiary">
                            {reasoningSections.length ? reasoningSections.map((section, sectionIndex) => (
                              <div key={`${sectionIndex}:${section.body.slice(0, 16)}`}>
                                {section.title && <div className="mb-1 font-semibold text-text-secondary">{section.title}</div>}
                                <div className="whitespace-pre-wrap">{section.body}</div>
                              </div>
                            )) : (
                              <div className="whitespace-pre-wrap">{reasoning.slice(0, 2400)}{reasoning.length > 2400 ? "…" : ""}</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            }) : (
              <div className="flex items-center gap-2 text-sm text-text-tertiary">
                {active ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                <span>{active ? "正在处理" : "已完成"}</span>
              </div>
            )}
          </div>
        </section>

        {files.length > 0 && (
          <section className="mb-5">
            <div className="mb-2 text-sm font-semibold text-text-secondary">文件 · {files.length}</div>
            <div className="space-y-2">
              {files.map((file) => (
                <div key={file.public_id} className="flex items-center gap-2 rounded-xl bg-surface-card/60 px-2.5 py-2 text-sm text-text-secondary">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                  <span className="truncate">{file.filename}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {sources.length > 0 && (
          <section>
            <div className="mb-2 text-sm font-semibold text-text-secondary">网页 · {sources.length}</div>
            <div className="space-y-2">
              {sources.slice(0, 12).map((source, index) => (
                <a key={`${source.url}:${index}`} href={source.url} target="_blank" rel="noreferrer" className="block rounded-xl bg-surface-card/60 px-2.5 py-2 text-sm hover:bg-surface-card">
                  <div className="truncate font-medium text-text-secondary">{source.title || source.url}</div>
                  <div className="mt-0.5 truncate text-text-tertiary">{source.url}</div>
                </a>
              ))}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
