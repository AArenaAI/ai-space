export type ReasoningStreamState = {
  inReasoningBlock: boolean;
  pendingAnswerContent?: string;
};

export type StructuredStreamDeltaResult = {
  legacyDelta: string;
  hasContentDelta: boolean;
  operations: StructuredStreamOperation[];
};

export type StructuredStreamOperation =
  | { type: "reasoning"; reasoningDelta: string }
  | { type: "close_reasoning" }
  | { type: "answer"; answerDelta: string };

export function stringifyStreamDelta(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => stringifyStreamDelta(item)).filter(Boolean).join("");
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return stringifyStreamDelta(obj.text || obj.content || obj.summary || obj.delta || obj.value || "");
  }
  return "";
}

export function buildStructuredStreamDelta(
  reasoningDelta: string,
  contentDelta: string,
  state: ReasoningStreamState
): StructuredStreamDeltaResult {
  let legacyDelta = "";
  const operations: StructuredStreamOperation[] = [];

  if (reasoningDelta) {
    if (!state.inReasoningBlock) {
      legacyDelta += "<think>";
      state.inReasoningBlock = true;
    }
    legacyDelta += reasoningDelta;
    operations.push({ type: "reasoning", reasoningDelta });

    // Some providers can emit reasoning and visible answer text in the same SSE
    // delta. Product-wise the reasoning block should finish before the answer
    // starts rendering, so hold the answer part until a later content-only delta
    // or stream completion closes the reasoning block.
    if (contentDelta) {
      state.pendingAnswerContent = `${state.pendingAnswerContent || ""}${contentDelta}`;
    }
    return { legacyDelta, hasContentDelta: false, operations };
  }

  // OpenAI Responses can occasionally emit reasoning and visible text in the same delta.
  // Handle content independently instead of `else if`, otherwise the visible answer may
  // stay inside the open <think> block until a full page refresh reloads DB content.
  if (contentDelta) {
    const answerDelta = `${state.pendingAnswerContent || ""}${contentDelta}`;
    state.pendingAnswerContent = "";
    if (state.inReasoningBlock) {
      legacyDelta += "</think>";
      state.inReasoningBlock = false;
      operations.push({ type: "close_reasoning" });
    }
    legacyDelta += answerDelta;
    operations.push({ type: "answer", answerDelta });
  }

  return { legacyDelta, hasContentDelta: operations.some((operation) => operation.type === "answer"), operations };
}
