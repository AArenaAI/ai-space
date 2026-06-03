const MAX_STABLE_FALLBACK_CHARS = 6000;
const MAX_STABLE_FALLBACK_LINES = 80;

function getStablePreview(content: string) {
  if (content.length <= MAX_STABLE_FALLBACK_CHARS) {
    const lines = content.split("\n");
    if (lines.length <= MAX_STABLE_FALLBACK_LINES) {
      return { isPreview: false, text: content };
    }
  }

  const lines = content.split("\n");
  let text = lines.slice(0, MAX_STABLE_FALLBACK_LINES).join("\n");
  if (text.length > MAX_STABLE_FALLBACK_CHARS) {
    text = text.slice(0, MAX_STABLE_FALLBACK_CHARS).trimEnd();
  }
  return { isPreview: true, text };
}

export default function MarkdownPlainFallback({ content }: { content: string }) {
  const preview = getStablePreview(content);

  return (
    <div
      data-i18n-skip="true"
      data-markdown-plain-fallback={preview.isPreview ? "stable-preview" : "full"}
      className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-text-primary"
    >
      {preview.text}
      {preview.isPreview && <span className="text-text-tertiary">{"\n…"}</span>}
    </div>
  );
}
