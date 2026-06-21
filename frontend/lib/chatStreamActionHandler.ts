import { buildStreamErrorPatch, type ChatActivityStatus } from "./chatCompletionFinalizer";
import { buildChatDeltaAccumulatedState, buildChatSearchPatch, type ChatStreamRealtimePatch } from "./chatStreamEventDecision";
import type { ChatStreamPayload } from "./chatStreamMeta";

export type TextAppendIntent = {
  type: "append_text";
  data: string;
  accumulated: string;
};

export function buildTextAppendIntent({
  accumulated,
  data,
}: {
  accumulated: string;
  data: string;
}): TextAppendIntent {
  return {
    type: "append_text",
    data,
    accumulated: accumulated + data,
  };
}

export type StreamErrorIntent = {
  type: "stream_error";
  patch: ChatStreamRealtimePatch;
  accumulated: string;
};

export function buildStreamErrorIntent({
  payload,
  accumulated,
  fallbackRequestId,
  includeContentInPatch = false,
}: {
  payload: Extract<ChatStreamPayload, { type: "error" }>;
  accumulated: string;
  fallbackRequestId?: string;
  includeContentInPatch?: boolean;
}): StreamErrorIntent {
  const nextAccumulated = accumulated || (payload.retryable ? "" : payload.message);
  return {
    type: "stream_error",
    accumulated: nextAccumulated,
    patch: {
      ...(includeContentInPatch && nextAccumulated ? { content: nextAccumulated } : {}),
      ...buildStreamErrorPatch({
        errorCode: payload.errorCode,
        retryable: payload.retryable,
        requestId: payload.requestId || fallbackRequestId,
      }),
    },
  };
}

export type StreamSearchIntent = {
  type: "search_patch";
  patch: ChatStreamRealtimePatch;
};

export function buildStreamSearchIntent({
  meta,
  activityStatus,
}: {
  meta: any;
  activityStatus: ChatActivityStatus;
}): StreamSearchIntent {
  return {
    type: "search_patch",
    patch: buildChatSearchPatch({ meta, activityStatus }),
  };
}

export type DeltaAccumulatedIntent = {
  type: "delta_accumulated";
  accumulated: string;
  hasLegacyDelta: boolean;
};

export function buildDeltaAccumulatedIntent({
  accumulated,
  legacyDelta,
}: {
  accumulated: string;
  legacyDelta: string;
}): DeltaAccumulatedIntent {
  return {
    type: "delta_accumulated",
    ...buildChatDeltaAccumulatedState({ accumulated, legacyDelta }),
  };
}
