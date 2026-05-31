export default function MarkdownPlainFallback({ content }: { content: string }) {
  return (
    <div data-i18n-skip="true" className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-text-primary">
      {content}
    </div>
  );
}
