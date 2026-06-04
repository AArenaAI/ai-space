import MarkdownLiteRenderer from "../MarkdownLiteRenderer";

export default function MarkdownPlainFallback({ content, compactPreview = true }: { content: string; compactPreview?: boolean }) {
  return (
    <div data-i18n-skip="true" data-markdown-plain-fallback="rich-like">
      <MarkdownLiteRenderer content={content} compactPreview={compactPreview} />
    </div>
  );
}
