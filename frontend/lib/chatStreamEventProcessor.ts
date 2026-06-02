import { isSseDone, parseSseEvent } from "./chatSseParser";
import { normalizeChatStreamPayload, type ChatStreamPayload } from "./chatStreamMeta";

export type ChatStreamEventAction =
  | { type: "empty"; sequence?: number; hasExplicitSequence?: boolean }
  | { type: "done"; sequence?: number; hasExplicitSequence?: boolean }
  | { type: "payload"; sequence?: number; hasExplicitSequence?: boolean; payload: ChatStreamPayload }
  | { type: "text"; sequence?: number; hasExplicitSequence?: boolean; data: string };

export type ProcessChatStreamEventOptions = {
  eventText: string;
  previousSequence?: number;
};

export function resolveSseEventSequence(eventId: string | undefined, previousSequence?: number): number | undefined {
  if (!eventId) return previousSequence;
  return Number(eventId) || previousSequence;
}

export function processChatStreamEvent({ eventText, previousSequence }: ProcessChatStreamEventOptions): ChatStreamEventAction {
  const event = parseSseEvent(eventText);
  const sequence = resolveSseEventSequence(event.id, previousSequence);
  const hasExplicitSequence = event.id !== undefined;
  const data = event.data;
  if (!data) {
    return { type: "empty", sequence, hasExplicitSequence };
  }
  if (isSseDone(data)) {
    return { type: "done", sequence, hasExplicitSequence };
  }
  try {
    return {
      type: "payload",
      sequence,
      hasExplicitSequence,
      payload: normalizeChatStreamPayload(JSON.parse(data)),
    };
  } catch {
    return { type: "text", sequence, hasExplicitSequence, data };
  }
}
