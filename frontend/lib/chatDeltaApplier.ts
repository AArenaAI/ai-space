import {
  buildStructuredStreamDelta,
  stringifyStreamDelta,
  type ReasoningStreamState,
} from "./chatStreamDelta";

export type ChatStreamAppend = (
  messageId: string,
  delta: { contentDelta?: string; reasoningDelta?: string; answerDelta?: string; reasoning?: boolean }
) => void;

export type ApplyChatStreamDeltaOptions = {
  messageId: string;
  rawDelta: any;
  reasoningState: ReasoningStreamState;
  append: ChatStreamAppend;
};

export type ApplyChatStreamDeltaResult = {
  legacyDelta: string;
  hasContentDelta: boolean;
  contentDelta: string;
  reasoningDelta: string;
};

export function applyChatStreamDelta({
  messageId,
  rawDelta,
  reasoningState,
  append,
}: ApplyChatStreamDeltaOptions): ApplyChatStreamDeltaResult {
  const contentDelta = stringifyStreamDelta(rawDelta?.content);
  const reasoningDelta = stringifyStreamDelta(rawDelta?.reasoning_content || rawDelta?.reasoning);
  const result = buildStructuredStreamDelta(reasoningDelta, contentDelta, reasoningState);

  for (const operation of result.operations) {
    if (operation.type === "reasoning") {
      append(messageId, { reasoningDelta: operation.reasoningDelta, reasoning: true });
    } else if (operation.type === "close_reasoning") {
      append(messageId, { reasoning: false });
    } else {
      append(messageId, { answerDelta: operation.answerDelta, reasoning: false });
    }
  }

  return {
    legacyDelta: result.legacyDelta,
    hasContentDelta: result.hasContentDelta,
    contentDelta,
    reasoningDelta,
  };
}
