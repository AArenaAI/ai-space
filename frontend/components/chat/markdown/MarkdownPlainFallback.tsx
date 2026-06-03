const MAX_STABLE_FALLBACK_CHARS = 1200;
const LONG_FALLBACK_PREVIEW_LINES = 8;

export default function MarkdownPlainFallback({ content }: { content: string }) {
  const isComplexOrLong = content.length > MAX_STABLE_FALLBACK_CHARS || /```/.test(content);
  const preview = isComplexOrLong
    ? content.split("\n").slice(0, LONG_FALLBACK_PREVIEW_LINES).join("\n")
    : content;

  return (
    <div
      data-i18n-skip="true"
      data-markdown-plain-fallback={isComplexOrLong ? "preview" : "full"}
      className={[
        "whitespace-pre-wrap break-words text-[15px] leading-relaxed text-text-primary",
        isComplexOrLong ? "max-h-60 overflow-hidden" : "",
      ].filter(Boolean).join(" ")}
    >
      {preview}
      {isComplexOrLong && <span className="text-text-tertiary">{"\n…"}</span>}
    </div>
  );
}
