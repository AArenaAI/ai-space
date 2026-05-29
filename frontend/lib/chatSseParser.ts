export type ParsedSseEvent = {
  id?: string;
  data: string;
  event?: string;
  retry?: number;
  comments: string[];
  raw: string;
};

export function parseSseEvent(eventText: string): ParsedSseEvent {
  const raw = eventText;
  const lines = eventText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const dataLines: string[] = [];
  const comments: string[] = [];
  let id: string | undefined;
  let event: string | undefined;
  let retry: number | undefined;

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith(":")) {
      comments.push(line.slice(1).trimStart());
      continue;
    }

    const colonIndex = line.indexOf(":");
    const field = colonIndex >= 0 ? line.slice(0, colonIndex) : line;
    const value = colonIndex >= 0
      ? line.slice(colonIndex + 1).replace(/^ /, "")
      : "";

    switch (field) {
      case "id":
        id = value;
        break;
      case "event":
        event = value;
        break;
      case "data":
        dataLines.push(value);
        break;
      case "retry": {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) retry = parsed;
        break;
      }
      default:
        break;
    }
  }

  return {
    id,
    data: dataLines.join("\n"),
    event,
    retry,
    comments,
    raw,
  };
}

export function splitSseEvents(buffer: string): { events: string[]; remaining: string } {
  const events: string[] = [];
  let normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let idx = normalized.indexOf("\n\n");

  while (idx >= 0) {
    events.push(normalized.slice(0, idx));
    normalized = normalized.slice(idx + 2);
    idx = normalized.indexOf("\n\n");
  }

  return { events, remaining: normalized };
}

export function isSseDone(data: string): boolean {
  return data.trim() === "[DONE]";
}
