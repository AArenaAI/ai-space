import type { ClipboardEvent } from "react";

const IMAGE_EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
};

function normalizeClipboardFile(file: File, index: number): File {
  if (file.name?.trim()) return file;

  const ext = IMAGE_EXTENSION_BY_TYPE[file.type] || "";
  if (!ext) return file;

  return new File([file], `pasted-image-${Date.now()}-${index + 1}${ext}`, {
    type: file.type,
    lastModified: file.lastModified || Date.now(),
  });
}

function extractImageSrcFromHtml(html: string): string | null {
  if (!html) return null;
  const match = html.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
  return match?.[1] || null;
}

async function fetchImageAsFile(src: string): Promise<File | null> {
  if (!src) return null;

  try {
    const response = await fetch(src, src.startsWith("data:") ? undefined : { credentials: "include" });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) return null;
    return normalizeClipboardFile(new File([blob], "", { type: blob.type || "image/png" }), 0);
  } catch {
    return null;
  }
}

export function getClipboardFiles(event: ClipboardEvent): File[] {
  const items = Array.from(event.clipboardData?.items || []);
  const filesFromItems = items
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  const files = filesFromItems.length > 0 ? filesFromItems : Array.from(event.clipboardData?.files || []);
  return files.map(normalizeClipboardFile);
}

export async function getClipboardFilesWithHtmlImages(event: ClipboardEvent): Promise<File[]> {
  const files = getClipboardFiles(event);
  if (files.length > 0) return files;

  const html = event.clipboardData?.getData("text/html") || "";
  const imageSrc = extractImageSrcFromHtml(html);
  if (!imageSrc) return [];

  const file = await fetchImageAsFile(imageSrc);
  return file ? [file] : [];
}
