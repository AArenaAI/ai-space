import MarkdownLiteRenderer from "../MarkdownLiteRenderer";

export default function MarkdownPlainFallback({ content }: { content: string }) {
  return (
    <div data-i18n-skip="true" data-markdown-plain-fallback="rich-like">
      <MarkdownLiteRenderer content={content} />
    </div>
  );
}
