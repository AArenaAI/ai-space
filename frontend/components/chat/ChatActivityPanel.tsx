"use client";

import { useState } from "react";
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

function mergeTimeline(message: Message, realtime: ReturnType<typeof useMessageRealtime>) {
  return realtime?.statusTimeline?.length ? realtime.statusTimeline : message.statusTimeline;
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
    .slice(0, 12);
}

export default function ChatActivityPanel({ message, model, onClose }: { message?: Message | null; model?: ChatModel; onClose: () => void }) {
  const { t } = useI18n();
  const [reasoningOpen, setReasoningOpen] = useState(true);
  const realtime = useMessageRealtime(message?.id || "", Boolean(message));
  if (!message) return null;
  const timeline = getOrderedTimelineSteps(mergeTimeline(message, realtime)).filter((step) => !isLowSignalCompletedStep(step));
  const sources = Array.from(new Map((realtime?.searchSources || message.searchSources || []).map((source) => [source.url || source.title, source])).values());
  const files = message.files || [];
  const reasoning = (realtime?.reasoningContent || message.reasoningContent || "").trim();
  const reasoningSections = formatReasoningSections(reasoning);
  const active = !((realtime?.completedAt || message.completedAt) || realtime?.stopped || message.stopped || realtime?.errorCode || message.errorCode);
  const elapsedSeconds = Math.max(0, Math.round(((realtime?.completedAt || message.completedAt || Date.now()) - (realtime?.generationStartedAt || message.generationStartedAt || message.createdAt || Date.now())) / 1000));

  return (
    <aside className="fixed inset-x-3 bottom-3 z-40 flex max-h-[72vh] flex-col rounded-3xl border border-surface-border/70 bg-surface-elevated/95 p-4 shadow-2xl shadow-black/10 backdrop-blur-xl dark:shadow-black/40 lg:inset-y-0 lg:left-auto lg:right-0 lg:bottom-auto lg:h-full lg:w-[336px] lg:max-h-none lg:rounded-none lg:border-y-0 lg:border-r-0 lg:shadow-none" data-chat-activity-panel="true">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary">思考与来源{active ? ` · ${elapsedSeconds}s` : ""}</div>
          <div className="mt-0.5 truncate text-xs text-text-tertiary">{model?.name || message.model || "AI"}</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1.5 text-text-tertiary hover:bg-surface-card hover:text-text-primary" aria-label="Close activity panel">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <section className="mb-5">
          <div className="mb-2 text-xs font-semibold text-text-secondary">思考</div>
          <div className="space-y-2">
            {timeline.length ? timeline.map((step, index) => (
              <div key={`${step.id}:${index}`} className="flex items-start gap-2 rounded-xl px-1 py-1 text-xs text-text-secondary">
                <span className="mt-0.5 shrink-0">{statusIcon(step)}</span>
                <span className="min-w-0">{getActivityStepLabel(t, step, realtime?.generationStartedAt || message.generationStartedAt)}</span>
              </div>
            )) : (
              <div className="flex items-center gap-2 text-xs text-text-tertiary">
                {active ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                <span>{active ? "正在处理" : "已完成"}</span>
              </div>
            )}
          </div>
        </section>

        {reasoning && (
          <section className="mb-5">
            <button
              type="button"
              onClick={() => setReasoningOpen((value) => !value)}
              className="mb-2 inline-flex w-full items-center justify-between rounded-xl px-1 py-1 text-left text-xs font-semibold text-text-secondary hover:bg-surface-card/60"
            >
              <span>思考内容</span>
              <ChevronDown className={cn("h-3.5 w-3.5 text-text-tertiary transition-transform", reasoningOpen && "rotate-180")} />
            </button>
            {reasoningOpen && (
              <div className="max-h-72 overflow-y-auto space-y-2 border-l border-surface-border pl-3 text-xs leading-relaxed text-text-tertiary">
                {reasoningSections.length ? reasoningSections.map((section, index) => (
                  <div key={`${index}:${section.slice(0, 16)}`} className="rounded-xl bg-surface-card/40 px-2.5 py-2">
                    {section}
                  </div>
                )) : (
                  <div className="rounded-xl bg-surface-card/40 px-2.5 py-2">{reasoning.slice(0, 2400)}{reasoning.length > 2400 ? "…" : ""}</div>
                )}
              </div>
            )}
          </section>
        )}

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
