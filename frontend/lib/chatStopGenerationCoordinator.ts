export type StopGenerationMessage = {
  role?: string;
  completedAt?: number;
  generationTaskId?: number;
};

export type StopGenerationAbortReason = "user" | "navigation" | null;

export type StopGenerationController = {
  abort: () => void;
};

export type StopGenerationCallbacks = {
  cancelTask: (taskId: number) => void;
  abortTaskStreams: () => void;
  abortStreamOwners?: () => void;
  getMainAbortController: () => StopGenerationController | null | undefined;
  clearMainAbortController: () => void;
  getCompareAbortControllers: () => StopGenerationController[];
  clearCompareAbortControllers: () => void;
  setAbortReason: (reason: StopGenerationAbortReason) => void;
};

export type StopGenerationPlan = {
  taskIds: number[];
  hasMainController: boolean;
  compareControllerCount: number;
  shouldSetAbortReason: boolean;
};

export function collectRunningGenerationTaskIds(messages: StopGenerationMessage[]): number[] {
  const taskIds = messages
    .filter((message) => message.role === "assistant" && !message.completedAt && message.generationTaskId)
    .map((message) => message.generationTaskId as number);
  return Array.from(new Set(taskIds));
}

export function buildCancelGenerationTaskUrl({
  apiBaseUrl = "",
  taskId,
}: {
  apiBaseUrl?: string;
  taskId: number;
}): string {
  return `${apiBaseUrl}/api/tasks/${taskId}/cancel`;
}

export function buildStopGenerationPlan({
  messages,
  mainController,
  compareControllers,
}: {
  messages: StopGenerationMessage[];
  mainController?: StopGenerationController | null;
  compareControllers?: StopGenerationController[];
}): StopGenerationPlan {
  const taskIds = collectRunningGenerationTaskIds(messages);
  const compareControllerCount = compareControllers?.length || 0;
  const hasMainController = Boolean(mainController);
  return {
    taskIds,
    hasMainController,
    compareControllerCount,
    shouldSetAbortReason: hasMainController || compareControllerCount > 0,
  };
}

export function cancelGenerationTask({
  apiBaseUrl = "",
  taskId,
  headers,
  fetchImpl = fetch,
}: {
  apiBaseUrl?: string;
  taskId: number;
  headers: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  return fetchImpl(buildCancelGenerationTaskUrl({ apiBaseUrl, taskId }), {
    method: "POST",
    headers,
    keepalive: true,
  }).catch(() => undefined);
}

export function runStopGeneration({
  messages,
  callbacks,
}: {
  messages: StopGenerationMessage[];
  callbacks: StopGenerationCallbacks;
}): StopGenerationPlan {
  const mainController = callbacks.getMainAbortController();
  const compareControllers = callbacks.getCompareAbortControllers();
  const plan = buildStopGenerationPlan({ messages, mainController, compareControllers });

  plan.taskIds.forEach((taskId) => callbacks.cancelTask(taskId));
  callbacks.abortTaskStreams();
  callbacks.abortStreamOwners?.();

  if (mainController) {
    callbacks.setAbortReason("user");
    mainController.abort();
    callbacks.clearMainAbortController();
  }

  if (compareControllers.length > 0) {
    callbacks.setAbortReason("user");
    compareControllers.forEach((controller) => controller.abort());
    callbacks.clearCompareAbortControllers();
  }

  return plan;
}
