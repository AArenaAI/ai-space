"use client";

import { AlertCircle, CircleStop, FileText, Lightbulb, Search, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatModel, Message } from "@/lib/chatTypes";
import { useMessageRealtime } from "@/hooks/useMessageRealtime";
import { deriveMessageStatuses, type MessageDisplayStatus } from "@/lib/messageStatus";
import { useI18n } from "@/lib/i18n";

function StatusIcon({ status }: { status: MessageDisplayStatus }) {
  const className = cn("w-3 h-3", status.active && "animate-pulse");
  if (status.kind === "tool_call") return <Wrench className={className} />;
  if (status.kind === "file_search") return <FileText className={className} />;
  if (status.kind === "thinking") return <Lightbulb className={className} />;
  if (status.kind === "error") return <AlertCircle className={className} />;
  if (status.kind === "stopped") return <CircleStop className={className} />;
  return <Search className={className} />;
}

function toneClass(tone: MessageDisplayStatus["tone"]) {
  if (tone === "green") return "text-green-600 bg-green-500/10";
  if (tone === "blue") return "text-blue-600 bg-blue-500/10";
  if (tone === "purple") return "text-purple-600 bg-purple-500/10";
  if (tone === "red") return "text-red-600 bg-red-500/10";
  if (tone === "neutral") return "text-text-secondary bg-surface-card";
  return "text-amber-600 bg-amber-500/10";
}

export function AssistantMessageMeta({ msg, isStreaming, model }: { msg: Message; isStreaming: boolean; model?: ChatModel }) {
  const { t } = useI18n();
  const realtime = useMessageRealtime(isStreaming ? msg.id : "");
  const statuses = deriveMessageStatuses({ message: msg, realtime, isStreaming, t });

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
