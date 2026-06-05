/// <reference lib="webworker" />

import { tokenizeMarkdown } from "../lib/markdown/markdownTokenize";

self.onmessage = (event: MessageEvent<{ id: number; content: string; compactPreview: boolean }>) => {
  const { id, content, compactPreview } = event.data;
  try {
    const doc = tokenizeMarkdown({ content, compactPreview });
    self.postMessage({ id, ok: true, doc });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
