export default function MarkdownPlainFallback({ content }: { content: string; compactPreview?: boolean; messageId?: string | number }) {
  return (
    <div
      data-i18n-skip="true"
      data-markdown-plain-fallback="text"
      className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-text-primary"
    >
      {content}
    </div>
  );
}
