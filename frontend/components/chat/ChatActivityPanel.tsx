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

function mergeTimeline(message: Message, realtime: ReturnType<typeof useMessageRealtime>, snapshotTimeline?: ChatStatusTimelineStep[]) {
  if (snapshotTimeline?.length) return snapshotTimeline;
  if (realtime?.statusTimeline?.length) return realtime.statusTimeline;
  return message.statusTimeline;
}

function stepDuration(step: ChatStatusTimelineStep) {
  return Math.max(0, (step.endedAt || Date.now()) - step.startedAt);
}

function isLowSignalCompletedStep(step: ChatStatusTimelineStep) {
  const duration = stepDuration(step);
  if (duration >= 1000) return false;
  return step.kind === "waiting_provider" || step.kind === "streaming_answer" || step.kind === "finalizing";
}

function getActivityStepLabel(t: (key: string, params?: Record<string, string>) => string, step: ChatStatusTimelineStep, generationStartedAt?: number) {
  const label = getTimelineStepLabel(t, step, generationStartedAt);
  const duration = stepDuration(step);
  if (duration < 1000) return label;
  if (/\d+\s*(秒|s|sec|secs|second|seconds|分|m|min)/i.test(label)) return label;
  return `${label} · ${formatElapsedTime(duration, t)}`;
}

function formatReasoningSections(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}|(?<=[。！？.!?])\s+(?=[\u4e00-\u9fa5A-Z])/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((section) => {
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
  if (step.kind === "reasoning") return "border-text-tertiary bg-text-tertiary";
  return "border-surface-border bg-surface-elevated";
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
    fetch(`/api/tasks/${taskId}`, { headers, credentials: "include" })
      .then((res) => res.ok ? res.json() : undefined)
      .then((data) => {
        if (cancelled || !data) return;
        const timeline = parseTimelineValue(data?.message?.status_timeline || data?.task?.status_timeline);
        if (timeline?.length) setSnapshotTimeline(timeline);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [message?.generationTaskId, message?.id]);
  if (!message) return null;
  const timeline = getOrderedTimelineSteps(mergeTimeline(message, realtime, snapshotTimeline)).filter((step) => !isLowSignalCompletedStep(step));
  const sources = Array.from(new Map((realtime?.searchSources || message.searchSources || []).map((source) => [source.url || source.title, source])).values());
  const files = message.files || [];
  const reasoning = (realtime?.reasoningContent || message.reasoningContent || "").trim();
  const reasoningSections = formatReasoningSections(reasoning);
  const active = !((realtime?.completedAt || message.completedAt) || realtime?.stopped || message.stopped || realtime?.errorCode || message.errorCode);
  const elapsedSeconds = Math.max(0, Math.round(((realtime?.completedAt || message.completedAt || Date.now()) - (realtime?.generationStartedAt || message.generationStartedAt || message.createdAt || Date.now())) / 1000));

  return (
    <aside className="fixed inset-x-3 bottom-3 z-[220] flex max-h-[72vh] flex-col rounded-3xl border border-surface-border/70 bg-surface-elevated/95 p-4 shadow-2xl shadow-black/10 backdrop-blur-xl dark:shadow-black/40 lg:absolute lg:inset-y-0 lg:left-auto lg:right-0 lg:bottom-auto lg:h-full lg:w-[336px] lg:max-h-none lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-l lg:border-solid lg:border-surface-border/45 lg:bg-surface/85 lg:shadow-none" data-chat-activity-panel="true">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary">思考与来源{active ? ` · ${elapsedSeconds}s` : ""}</div>
          <div className="mt-0.5 truncate text-xs text-text-tertiary">{model?.name || message.model || "AI"}</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1.5 text-text-tertiary hover:bg-surface-card hover:text-text-primary" aria-label="Close activity panel">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1" data-chat-activity-scroll="true">
        <section className="mb-6">
          <div className="mb-3 text-xs font-semibold text-text-secondary">思考</div>
          <div className="relative space-y-0">
            {timeline.length ? timeline.map((step, index) => {
              const showReasoning = step.kind === "reasoning" && reasoning;
              const isLast = index === timeline.length - 1;
              return (
                <div key={`${step.id}:${index}`} className="relative grid grid-cols-[18px_1fr] gap-3 pb-4 last:pb-0">
                  {!isLast && <div className="absolute left-[8px] top-4 bottom-0 border-l border-dashed border-surface-border/80" aria-hidden="true" />}
                  <span className={cn("relative z-10 mt-1 h-2.5 w-2.5 rounded-full border", timelineDotClass(step))} aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-text-secondary">{getActivityStepLabel(t, step, realtime?.generationStartedAt || message.generationStartedAt)}</div>
                    {showReasoning && (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => setReasoningOpen((value) => !value)}
                          className="mb-2 inline-flex w-full items-center justify-between rounded-lg py-1 text-left text-xs font-medium text-text-tertiary hover:text-text-secondary"
                        >
                          <span>思考内容</span>
                          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", reasoningOpen && "rotate-180")} />
                        </button>
                        {reasoningOpen && (
                          <div className="space-y-3 text-xs leading-relaxed text-text-tertiary">
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
              <div className="flex items-center gap-2 text-xs text-text-tertiary">
                {active ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                <span>{active ? "正在处理" : "已完成"}</span>
              </div>
            )}
          </div>
        </section>

        {files.length > 0 && (
          <section className="mb-5">
            <div className="mb-2 text-xs font-semibold text-text-secondary">文件 · {files.length}</div>
            <div className="space-y-2">
              {files.map((file) => (
                <div key={file.public_id} className="flex items-center gap-2 rounded-xl bg-surface-card/60 px-2.5 py-2 text-xs text-text-secondary">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                  <span className="truncate">{file.filename}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {sources.length > 0 && (
          <section>
            <div className="mb-2 text-xs font-semibold text-text-secondary">网页 · {sources.length}</div>
            <div className="space-y-2">
              {sources.slice(0, 12).map((source, index) => (
                <a key={`${source.url}:${index}`} href={source.url} target="_blank" rel="noreferrer" className="block rounded-xl bg-surface-card/60 px-2.5 py-2 text-xs hover:bg-surface-card">
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
