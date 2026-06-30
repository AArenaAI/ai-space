import type { ChatActivityStatus, Message, SearchSource } from "./chatTypes";
import type { RealtimeData, RuntimePhase } from "./streaming";
import type { ChatStatusTimelineStep } from "./chatStatusTimeline";

export type ChatMessageRuntimeState = {
  terminal: boolean;
  terminalSource: "message" | "realtime" | undefined;
  content: string;
  answerContent?: string;
  reasoningContent: string;
  searchSources: SearchSource[];
  searchSourcesCount?: number;
  searchStatus?: "searching" | "completed" | "failed";
  activityStatus?: ChatActivityStatus | RealtimeData["activityStatus"];
  statusTimeline?: ChatStatusTimelineStep[];
  phase?: RuntimePhase;
  generationStartedAt?: number;
  completedAt?: number;
  stopped?: boolean;
  errorCode?: string;
  retryable?: boolean;
  requestId?: string;
};

export function isTerminalMessage(message: Message) {
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

function isTerminalRealtime(realtime?: RealtimeData) {
  return Boolean(
    realtime?.completedAt ||
    realtime?.stopped ||
    realtime?.errorCode ||
    realtime?.phase === "completed" ||
    realtime?.phase === "failed" ||
    realtime?.phase === "stopped"
  );
}

function pickTerminalTimeline({
  message,
  realtime,
  snapshotTimeline,
}: {
  message: Message;
  realtime?: RealtimeData;
  snapshotTimeline?: ChatStatusTimelineStep[];
}) {
  if (message.statusTimeline?.length) return message.statusTimeline;
  if (snapshotTimeline?.length) return snapshotTimeline;
  // Only trust realtime timeline for terminal messages if realtime itself is
  // terminal too. A stale running realtime entry must never make a persisted
  // completed message look like it is reasoning/generating again.
  if (isTerminalRealtime(realtime)) return realtime?.statusTimeline;
  return undefined;
}

export function resolveChatMessageRuntimeState({
  message,
  realtime,
  snapshotTimeline,
}: {
  message: Message;
  realtime?: RealtimeData;
  snapshotTimeline?: ChatStatusTimelineStep[];
}): ChatMessageRuntimeState {
  const terminalFromMessage = isTerminalMessage(message);
  const terminalFromRealtime = isTerminalRealtime(realtime);

  if (terminalFromMessage) {
    return {
      terminal: true,
      terminalSource: "message",
      content: message.content || realtime?.content || "",
      answerContent: message.content || realtime?.answerContent,
      reasoningContent: message.reasoningContent || realtime?.reasoningContent || "",
      searchSources: message.searchSources || (realtime?.searchSources as SearchSource[] | undefined) || [],
      searchSourcesCount: message.searchSourcesCount ?? realtime?.searchSourcesCount,
      searchStatus: message.searchStatus ?? realtime?.searchStatus,
      activityStatus: message.activityStatus,
      statusTimeline: pickTerminalTimeline({ message, realtime, snapshotTimeline }),
      phase: message.phase || (message.completedAt ? "completed" : undefined),
      generationStartedAt: message.generationStartedAt || realtime?.generationStartedAt || message.createdAt,
      completedAt: message.completedAt || realtime?.completedAt,
      stopped: message.stopped || realtime?.stopped,
      errorCode: message.errorCode || realtime?.errorCode,
      retryable: message.retryable ?? realtime?.retryable,
      requestId: message.requestId || realtime?.requestId,
    };
  }

  if (terminalFromRealtime) {
    return {
      terminal: true,
      terminalSource: "realtime",
      content: realtime?.content || message.content || "",
      answerContent: realtime?.answerContent || message.content,
      reasoningContent: realtime?.reasoningContent || message.reasoningContent || "",
      searchSources: (realtime?.searchSources as SearchSource[] | undefined) || message.searchSources || [],
      searchSourcesCount: realtime?.searchSourcesCount ?? message.searchSourcesCount,
      searchStatus: realtime?.searchStatus ?? message.searchStatus,
      activityStatus: realtime?.activityStatus ?? message.activityStatus,
      statusTimeline: realtime?.statusTimeline || snapshotTimeline || message.statusTimeline,
      phase: realtime?.phase || message.phase,
      generationStartedAt: realtime?.generationStartedAt || message.generationStartedAt || message.createdAt,
      completedAt: realtime?.completedAt || message.completedAt,
      stopped: realtime?.stopped || message.stopped,
      errorCode: realtime?.errorCode || message.errorCode,
      retryable: realtime?.retryable ?? message.retryable,
      requestId: realtime?.requestId || message.requestId,
    };
  }

  return {
    terminal: false,
    terminalSource: undefined,
    content: realtime?.content || message.content || "",
    answerContent: realtime?.answerContent || message.content,
    reasoningContent: realtime?.reasoningContent || message.reasoningContent || "",
    searchSources: (realtime?.searchSources as SearchSource[] | undefined) || message.searchSources || [],
    searchSourcesCount: realtime?.searchSourcesCount ?? message.searchSourcesCount,
    searchStatus: realtime?.searchStatus ?? message.searchStatus,
    activityStatus: realtime?.activityStatus ?? message.activityStatus,
    statusTimeline: realtime?.statusTimeline || snapshotTimeline || message.statusTimeline,
    phase: realtime?.phase || message.phase,
    generationStartedAt: realtime?.generationStartedAt || message.generationStartedAt || message.createdAt,
    completedAt: realtime?.completedAt || message.completedAt,
    stopped: realtime?.stopped || message.stopped,
    errorCode: realtime?.errorCode || message.errorCode,
    retryable: realtime?.retryable ?? message.retryable,
    requestId: realtime?.requestId || message.requestId,
  };
}
