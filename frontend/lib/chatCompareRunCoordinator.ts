import {
  getCompareRequestGroupContext,
  isCompareGroupContextReady,
  mergeCompareGroupContext,
  resolveCompareRequestGroupModels,
  shouldSkipSaveUserMessage,
  type CompareGroupContext,
} from "./chatCompareCoordinator";
import { buildCompareChatRequestBody, getClientTimezone, type ModelMessage } from "./chatRequestBuilder";
import type { ChatStreamRunResult } from "./chatStreamRunResult";

export type CompareAssistantLike = {
  id: string;
  model?: string;
};

export type CompareAbortReason = "user" | "navigation" | null | undefined;

export type CompareRunReasoningOptions = {
  enabled: boolean;
  effort?: string;
};

export type CompareRunCallbacks<TAssistant extends CompareAssistantLike> = {
  fetchImpl?: typeof fetch;
  streamResponse: (
    response: Response,
    assistant: TAssistant,
    controller: AbortController,
    conversationId: number | undefined,
    onGroupContext?: (context?: CompareGroupContext) => void
  ) => Promise<ChatStreamRunResult | undefined>;
  onGroupContextResolved: (context: CompareGroupContext) => void;
  onRecoverableResult: (assistant: TAssistant, result: ChatStreamRunResult) => void;
  onAbortUser: (assistant: TAssistant) => void;
  onRunError: (assistant: TAssistant, error: any, streamResult?: ChatStreamRunResult) => void;
  getAbortReason: () => CompareAbortReason;
};

export type RunCompareModelsOptions<TAssistant extends CompareAssistantLike> = {
  apiBaseUrl?: string;
  headers: Record<string, string>;
  controllers: AbortController[];
  assistantMessages: TAssistant[];
  compareModelIds: string[];
  modelMessages: ModelMessage[];
  conversationId?: number;
  notebookId?: number;
  notebookFileIds?: number[];
  reasoning: CompareRunReasoningOptions;
  search: boolean;
  templateId: number;
  templatePrefix?: string;
  skillKey?: string;
  messageFileIds?: string[];
  callbacks: CompareRunCallbacks<TAssistant>;
};

export type CompareRunCoordinator = {
  setGroupContext: (context?: CompareGroupContext) => void;
  getGroupContext: () => CompareGroupContext | undefined;
  waitForGroupContext: () => Promise<CompareGroupContext | undefined>;
  resolveMissingGroupContext: () => void;
  isResolved: () => boolean;
};

export function createCompareRunCoordinator({
  fallbackGroupModels,
  onResolved,
}: {
  fallbackGroupModels: string[];
  onResolved: (context: CompareGroupContext) => void;
}): CompareRunCoordinator {
  let compareGroupContext: CompareGroupContext | undefined;
  let resolved = false;
  let resolveReady: (context: CompareGroupContext | undefined) => void = () => {};
  const ready = new Promise<CompareGroupContext | undefined>((resolve) => {
    resolveReady = resolve;
  });

  const setGroupContext = (context?: CompareGroupContext) => {
    compareGroupContext = mergeCompareGroupContext({
      incoming: context,
      existing: compareGroupContext,
      fallbackGroupModels,
    });
    if (!resolved && isCompareGroupContextReady(compareGroupContext)) {
      resolved = true;
      const readyContext = compareGroupContext!;
      onResolved(readyContext);
      resolveReady(readyContext);
    }
  };

  return {
    setGroupContext,
    getGroupContext: () => compareGroupContext,
    waitForGroupContext: () => ready,
    resolveMissingGroupContext: () => {
      if (resolved) return;
      resolved = true;
      resolveReady(undefined);
    },
    isResolved: () => resolved,
  };
}

export function buildCompareRunRequestBody({
  assistant,
  index,
  requestGroupContext,
  compareModelIds,
  modelMessages,
  conversationId,
  notebookId,
  notebookFileIds,
  reasoning,
  search,
  templateId,
  templatePrefix,
  skillKey,
  messageFileIds,
  clientTimezone,
}: {
  assistant: CompareAssistantLike;
  index: number;
  requestGroupContext?: CompareGroupContext;
  compareModelIds: string[];
  modelMessages: ModelMessage[];
  conversationId?: number;
  notebookId?: number;
  notebookFileIds?: number[];
  reasoning: CompareRunReasoningOptions;
  search: boolean;
  templateId: number;
  templatePrefix?: string;
  skillKey?: string;
  messageFileIds?: string[];
  clientTimezone?: string;
}): Record<string, any> {
  return buildCompareChatRequestBody({
    model: assistant.model || "",
    messages: modelMessages,
    conversationId,
    notebookId,
    reasoningEffort: reasoning.effort,
    search,
    templateId,
    templatePrefix,
    skipSaveUserMessage: shouldSkipSaveUserMessage(index),
    groupId: requestGroupContext?.groupId,
    userMessageId: requestGroupContext?.userMessageId,
    groupIndex: index,
    groupModels: resolveCompareRequestGroupModels({
      requestGroupModels: requestGroupContext?.groupModels,
      fallbackGroupModels: compareModelIds,
    }),
    fallbackGroupModels: compareModelIds,
    skillKey,
    messageFileIds,
    notebookFileIds,
    clientTimezone,
  });
}

export async function runCompareModel<TAssistant extends CompareAssistantLike>({
  assistant,
  index,
  explicitGroupContext,
  coordinator,
  options,
}: {
  assistant: TAssistant;
  index: number;
  explicitGroupContext?: CompareGroupContext;
  coordinator: CompareRunCoordinator;
  options: RunCompareModelsOptions<TAssistant>;
}): Promise<void> {
  const controller = options.controllers[index];
  const fetchImpl = options.callbacks.fetchImpl || fetch;
  let streamResult: ChatStreamRunResult | undefined;
  try {
    const requestGroupContext = getCompareRequestGroupContext({
      index,
      explicitContext: explicitGroupContext,
      currentContext: coordinator.getGroupContext(),
    });
    const response = await fetchImpl(`${options.apiBaseUrl || ""}/api/chat`, {
      method: "POST",
      headers: options.headers,
      signal: controller.signal,
      body: JSON.stringify(buildCompareRunRequestBody({
        assistant,
        index,
        requestGroupContext,
        compareModelIds: options.compareModelIds,
        modelMessages: options.modelMessages,
        conversationId: options.conversationId,
        reasoning: options.reasoning,
        search: options.search,
        templateId: options.templateId,
        templatePrefix: options.templatePrefix,
        skillKey: options.skillKey,
        messageFileIds: options.messageFileIds,
        clientTimezone: getClientTimezone(),
      })),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const errorCode = errorBody.error || errorBody.code || "unknown";
      const errorMsg = errorBody.message || "请求失败";
      throw Object.assign(new Error(errorMsg), { errorCode, status: response.status, needInvite: errorBody.need_invite });
    }

    streamResult = await options.callbacks.streamResponse(
      response,
      assistant,
      controller,
      options.conversationId,
      index === 0 ? coordinator.setGroupContext : undefined
    );
    if (index === 0) {
      coordinator.setGroupContext(streamResult?.groupContext);
    }
    if (streamResult?.recoverable) {
      options.callbacks.onRecoverableResult(assistant, streamResult);
    }
  } catch (error: any) {
    if (error?.name === "AbortError") {
      if (index === 0 && !coordinator.isResolved()) {
        coordinator.resolveMissingGroupContext();
      }
      if (options.callbacks.getAbortReason() !== "user") return;
      options.callbacks.onAbortUser(assistant);
      return;
    }

    options.callbacks.onRunError(assistant, error, streamResult);
    if (index === 0 && !coordinator.isResolved()) {
      coordinator.resolveMissingGroupContext();
    }
  }
}

export async function runCompareModels<TAssistant extends CompareAssistantLike>(
  options: RunCompareModelsOptions<TAssistant>
): Promise<void> {
  const coordinator = createCompareRunCoordinator({
    fallbackGroupModels: options.compareModelIds,
    onResolved: options.callbacks.onGroupContextResolved,
  });

  const firstAssistant = options.assistantMessages[0];
  if (!firstAssistant) return;

  const firstRun = runCompareModel({
    assistant: firstAssistant,
    index: 0,
    coordinator,
    options,
  });
  const context = await coordinator.waitForGroupContext();
  if (!context?.groupId || !context.userMessageId) {
    await firstRun;
    return;
  }

  const restRuns = options.assistantMessages.slice(1).map((assistant, offset) => runCompareModel({
    assistant,
    index: offset + 1,
    explicitGroupContext: context,
    coordinator,
    options,
  }));
  await Promise.all([firstRun, ...restRuns]);
}
