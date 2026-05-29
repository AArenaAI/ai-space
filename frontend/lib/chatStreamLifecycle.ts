import { runSseStream, type RunSseStreamResult, type SseStreamReader } from "./chatSseStreamRunner";
import {
  shouldIgnoreStreamAbort,
  shouldResumeTaskStreamAfterError,
  type ChatAbortReason,
} from "./chatErrorRecovery";

export type ChatStreamReader = SseStreamReader & {
  releaseLock(): void;
};

export type ChatStreamBody = {
  getReader(): ChatStreamReader;
};

export type ChatStreamResponse = {
  body?: ChatStreamBody | null;
};

export type ChatStreamRunner = (options: {
  reader: ChatStreamReader;
  onEvent: (eventText: string) => void;
}) => Promise<RunSseStreamResult>;

export type ChatStreamErrorDecision =
  | { action: "ignore" }
  | { action: "resume" }
  | { action: "throw"; error: unknown };

export type DecideChatStreamErrorOptions = {
  error: unknown;
  signalAborted?: boolean;
  abortReason: ChatAbortReason;
  serverMessageId?: number;
  generationTaskId?: number;
};

export function decideChatStreamError({
  error,
  signalAborted,
  abortReason,
  serverMessageId,
  generationTaskId,
}: DecideChatStreamErrorOptions): ChatStreamErrorDecision {
  const isAbort = (error as any)?.name === "AbortError" || !!signalAborted;
  if (shouldIgnoreStreamAbort({ isAbort, abortReason })) {
    return { action: "ignore" };
  }
  if (shouldResumeTaskStreamAfterError({
    isAbort,
    abortReason,
    serverMessageId,
    generationTaskId,
  })) {
    return { action: "resume" };
  }
  return { action: "throw", error };
}

export type RunChatStreamLifecycleOptions = {
  response: ChatStreamResponse;
  signal: Pick<AbortSignal, "aborted">;
  getAbortReason: () => ChatAbortReason;
  getRecoveryIds: () => { serverMessageId?: number; generationTaskId?: number };
  onEvent: (eventText: string) => void;
  streamRunner?: ChatStreamRunner;
};

export type RunChatStreamLifecycleResult =
  | { action: "completed"; streamResult: RunSseStreamResult }
  | { action: "ignored" }
  | { action: "resume" };

export async function runChatStreamLifecycle({
  response,
  signal,
  getAbortReason,
  getRecoveryIds,
  onEvent,
  streamRunner = runSseStream,
}: RunChatStreamLifecycleOptions): Promise<RunChatStreamLifecycleResult> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("无法读取流");

  try {
    const streamResult = await streamRunner({ reader, onEvent });
    return { action: "completed", streamResult };
  } catch (error) {
    const { serverMessageId, generationTaskId } = getRecoveryIds();
    const decision = decideChatStreamError({
      error,
      signalAborted: signal.aborted,
      abortReason: getAbortReason(),
      serverMessageId,
      generationTaskId,
    });
    if (decision.action === "ignore") return { action: "ignored" };
    if (decision.action === "resume") return { action: "resume" };
    throw decision.error;
  } finally {
    reader.releaseLock();
  }
}
