import MarkdownLiteRenderer from "../MarkdownLiteRenderer";

export default function MarkdownPlainFallback({ content, compactPreview = true, messageId }: { content: string; compactPreview?: boolean; messageId?: string | number }) {
  return (
    <div data-i18n-skip="true" data-markdown-plain-fallback="rich-like">
      <MarkdownLiteRenderer content={content} compactPreview={compactPreview} messageId={messageId} />
    </div>
  );
}
