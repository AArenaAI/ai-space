import { evaluateBackgroundTaskPoll, type BackgroundTaskPollState } from "./chatBackgroundPolling";

export type BackgroundPollingTimerId = number;

export type BackgroundPollingMessageResponse = {
  message?: {
    content?: string;
  };
  background_task?: {
    status?: string;
  };
};

export type BackgroundPollingRunnerCallbacks = {
  fetchImpl?: typeof fetch;
  setIntervalImpl?: (handler: () => void, timeout: number) => BackgroundPollingTimerId;
  onPollState: (state: BackgroundTaskPollState) => void;
  onFinished: (state: BackgroundTaskPollState) => void;
  onKeepLoading: (state: BackgroundTaskPollState) => void;
  shouldKeepLoading: (state: BackgroundTaskPollState) => boolean;
  isStreamActive: () => boolean;
};

export type StartBackgroundPollingRunnerOptions = {
  apiBaseUrl?: string;
  conversationId: number;
  serverMessageId: number;
  headers: Record<string, string>;
  intervalMs?: number;
  callbacks: BackgroundPollingRunnerCallbacks;
};

export type BackgroundPollingRunner = {
  poll: () => Promise<void>;
  timer: BackgroundPollingTimerId;
  getTerminalStableCount: () => number;
  getLastContent: () => string;
};

export function buildBackgroundPollingMessageUrl({
  apiBaseUrl = "",
  conversationId,
  serverMessageId,
}: {
  apiBaseUrl?: string;
  conversationId: number;
  serverMessageId: number;
}): string {
  return `${apiBaseUrl}/api/conversations/${conversationId}/messages/${serverMessageId}`;
}

export function normalizeBackgroundPollingResponse(data: BackgroundPollingMessageResponse | undefined): {
  content: string;
  status: string;
} {
  return {
    content: data?.message?.content || "",
    status: data?.background_task?.status || "",
  };
}

export function createBackgroundPollingTick({
  apiBaseUrl = "",
  conversationId,
  serverMessageId,
  headers,
  callbacks,
}: Omit<StartBackgroundPollingRunnerOptions, "intervalMs">): {
  poll: () => Promise<void>;
  getTerminalStableCount: () => number;
  getLastContent: () => string;
} {
  const fetchImpl = callbacks.fetchImpl || fetch;
  let terminalStableCount = 0;
  let lastContent = "";

  const poll = async () => {
    try {
      const res = await fetchImpl(buildBackgroundPollingMessageUrl({
        apiBaseUrl,
        conversationId,
        serverMessageId,
      }), { headers });
      if (!res.ok) return;

      const data = await res.json() as BackgroundPollingMessageResponse;
      const normalized = normalizeBackgroundPollingResponse(data);
      const pollState = evaluateBackgroundTaskPoll({
        content: normalized.content,
        status: normalized.status,
        previousContent: lastContent,
        terminalStableCount,
      });
      terminalStableCount = pollState.terminalStableCount;
      lastContent = pollState.content;
      callbacks.onPollState(pollState);

      if (pollState.isFinished && !callbacks.isStreamActive()) {
        callbacks.onFinished(pollState);
      } else if (callbacks.shouldKeepLoading(pollState)) {
        callbacks.onKeepLoading(pollState);
      }
    } catch {
      // Preserve existing polling behavior: transient network/JSON errors are ignored.
    }
  };

  return {
    poll,
    getTerminalStableCount: () => terminalStableCount,
    getLastContent: () => lastContent,
  };
}

export function startBackgroundPollingRunner(options: StartBackgroundPollingRunnerOptions): BackgroundPollingRunner {
  const tick = createBackgroundPollingTick(options);
  const setIntervalImpl = options.callbacks.setIntervalImpl || ((handler, timeout) => setInterval(handler, timeout) as unknown as BackgroundPollingTimerId);
  tick.poll();
  const timer = setIntervalImpl(() => {
    tick.poll();
  }, options.intervalMs ?? 2000);
  return {
    ...tick,
    timer,
  };
}
