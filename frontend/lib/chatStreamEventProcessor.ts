import { isSseDone, parseSseEvent } from "./chatSseParser";
import { normalizeChatStreamPayload, type ChatStreamPayload } from "./chatStreamMeta";

export type ChatStreamEventAction =
  | { type: "empty"; sequence?: number }
  | { type: "done"; sequence?: number }
  | { type: "payload"; sequence?: number; payload: ChatStreamPayload }
  | { type: "text"; sequence?: number; data: string };

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
  const data = event.data;
  if (!data) {
    return { type: "empty", sequence };
  }
  if (isSseDone(data)) {
    return { type: "done", sequence };
  }
  try {
    return {
      type: "payload",
      sequence,
      payload: normalizeChatStreamPayload(JSON.parse(data)),
    };
  } catch {
    return { type: "text", sequence, data };
  }
}
