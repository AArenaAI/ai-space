import { runSseStream, type RunSseStreamResult, type SseStreamReader } from "./chatSseStreamRunner";
import { normalizeError } from "@/lib/errors";

export type ChatTaskStreamReader = SseStreamReader & {
  releaseLock(): void;
};

export type ChatTaskStreamBody = {
  getReader(): ChatTaskStreamReader;
};

export type ChatTaskStreamResponse = {
  ok: boolean;
  body?: ChatTaskStreamBody | null;
};

export type ChatTaskStreamFetch = (
  input: string,
  init: { headers: Record<string, string>; signal: AbortSignal }
) => Promise<ChatTaskStreamResponse>;

export type ChatTaskStreamRunner = (options: {
  reader: ChatTaskStreamReader;
  onEvent: (eventText: string) => void;
}) => Promise<RunSseStreamResult>;

export type BuildTaskStreamUrlOptions = {
  apiBaseUrl?: string;
  serverMessageId?: number;
  generationTaskId?: number;
  after?: number;
};

export function buildTaskStreamUrl({
  apiBaseUrl = "",
  serverMessageId,
  generationTaskId,
  after = 0,
}: BuildTaskStreamUrlOptions): string {
  if (generationTaskId) {
    return `${apiBaseUrl}/api/tasks/${generationTaskId}/stream?after=${after}`;
  }
  if (serverMessageId) {
    return `${apiBaseUrl}/api/chat/tasks/${serverMessageId}/events?after=${after}`;
  }
  throw normalizeError("missing task stream id", { module: "chat", fallbackMessage: "连接中断，已保留当前内容，可稍后重试。" });
}

export type RunTaskEventStreamOptions = BuildTaskStreamUrlOptions & {
  headers: Record<string, string>;
  signal: AbortSignal;
  onEvent: (eventText: string) => void;
  fetchImpl?: ChatTaskStreamFetch;
  streamRunner?: ChatTaskStreamRunner;
};

export async function runTaskEventStream({
  headers,
  signal,
  onEvent,
  fetchImpl = fetch as ChatTaskStreamFetch,
  streamRunner = runSseStream,
  ...urlOptions
}: RunTaskEventStreamOptions): Promise<RunSseStreamResult> {
  const streamUrl = buildTaskStreamUrl(urlOptions);
  const res = await fetchImpl(streamUrl, { headers, signal });
  if (!res.ok || !res.body) throw normalizeError("task stream unavailable", { module: "chat", fallbackMessage: "连接中断，已保留当前内容，可稍后重试。" });

  const reader = res.body.getReader();
  try {
    return await streamRunner({ reader, onEvent });
  } finally {
    reader.releaseLock();
  }
}

export function shouldFallbackToBackgroundPollingAfterTaskStreamError(signal: Pick<AbortSignal, "aborted">): boolean {
  return !signal.aborted;
}
