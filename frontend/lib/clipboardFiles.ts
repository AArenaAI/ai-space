import type { ClipboardEvent } from "react";

export function getClipboardFiles(event: ClipboardEvent): File[] {
  const items = Array.from(event.clipboardData?.items || []);
  const filesFromItems = items
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  if (filesFromItems.length > 0) return filesFromItems;

  return Array.from(event.clipboardData?.files || []);
}

