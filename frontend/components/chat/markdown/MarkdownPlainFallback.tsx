const MAX_STABLE_FALLBACK_CHARS = 6000;
const MAX_STABLE_FALLBACK_LINES = 80;
const MAX_EXTREME_FALLBACK_CHARS = 3500;
const MAX_EXTREME_FALLBACK_LINES = 50;
const EXTREME_FALLBACK_LENGTH_THRESHOLD = 10_000;
const EXTREME_FALLBACK_CODE_BLOCK_THRESHOLD = 20;
const EXTREME_FALLBACK_TABLE_LINE_THRESHOLD = 100;

function getStablePreview(content: string) {
  const codeBlocks = Math.floor((content.match(/```/g)?.length || 0) / 2);
  const tableLines = content.split("\n").filter((line) => /^\s*\|.+\|\s*$/.test(line)).length;
  const isExtreme =
    content.length > EXTREME_FALLBACK_LENGTH_THRESHOLD ||
    codeBlocks >= EXTREME_FALLBACK_CODE_BLOCK_THRESHOLD ||
    tableLines >= EXTREME_FALLBACK_TABLE_LINE_THRESHOLD;
  const maxChars = isExtreme ? MAX_EXTREME_FALLBACK_CHARS : MAX_STABLE_FALLBACK_CHARS;
  const maxLines = isExtreme ? MAX_EXTREME_FALLBACK_LINES : MAX_STABLE_FALLBACK_LINES;

  if (content.length <= maxChars) {
    const lines = content.split("\n");
    if (lines.length <= maxLines) {
      return { isExtreme, isPreview: false, text: content };
    }
  }

  const lines = content.split("\n");
  let text = lines.slice(0, maxLines).join("\n");
  if (text.length > maxChars) {
    text = text.slice(0, maxChars).trimEnd();
  }
  return { isExtreme, isPreview: true, text };
}

export default function MarkdownPlainFallback({ content }: { content: string }) {
  const preview = getStablePreview(content);

  return (
    <div
      data-i18n-skip="true"
      data-markdown-plain-fallback={preview.isPreview ? (preview.isExtreme ? "extreme-stable-preview" : "stable-preview") : "full"}
      className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-text-primary"
    >
      {preview.text}
      {preview.isPreview && <span className="text-text-tertiary">{"\n…"}</span>}
    </div>
  );
}
