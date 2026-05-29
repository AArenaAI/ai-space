import { splitSseEvents } from "./chatSseParser";

export type SseStreamReader = {
  read(): Promise<ReadableStreamReadResult<Uint8Array>>;
};

export type RunSseStreamOptions = {
  reader: SseStreamReader;
  decoder?: TextDecoder;
  initialBuffer?: string;
  onEvent: (eventText: string) => void;
};

export type RunSseStreamResult = {
  remaining: string;
  eventCount: number;
};

export async function runSseStream({
  reader,
  decoder = new TextDecoder(),
  initialBuffer = "",
  onEvent,
}: RunSseStreamOptions): Promise<RunSseStreamResult> {
  let buffer = initialBuffer;
  let eventCount = 0;

  const dispatchCompleteEvents = () => {
    const split = splitSseEvents(buffer);
    buffer = split.remaining;
    for (const eventText of split.events) {
      onEvent(eventText);
      eventCount += 1;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      dispatchCompleteEvents();
    }
  }

  buffer += decoder.decode();
  dispatchCompleteEvents();

  if (buffer.trim()) {
    onEvent(buffer.trim());
    eventCount += 1;
    buffer = "";
  }

  return { remaining: buffer, eventCount };
}
