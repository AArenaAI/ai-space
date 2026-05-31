import MarkdownRenderer from "@/components/chat/MarkdownRenderer";

const content = `下面是一个代码块：

\`\`\`ts
export function hello(name: string) {
  return 'hello ' + name;
}
\`\`\`

代码块结束。`;

const streamingEChartsContent = `流式阶段的图表 fence 应先按代码块显示：

\`\`\`echarts
{"xAxis":{"type":"category","data":["A","B"]},"yAxis":{"type":"value"},"series":[{"type":"bar","data":[1,2]}]}
\`\`\``;

export default function TestChatMarkdownCodePage() {
  return (
    <main className="min-h-screen bg-background p-6 text-text-primary">
      <div className="mx-auto max-w-3xl rounded-2xl border border-surface-border bg-surface-card p-6">
        <h1 className="mb-4 text-lg font-semibold">Markdown code fixture</h1>
        <MarkdownRenderer content={content} />
        <section data-testid="streaming-echarts-fixture" className="mt-8 border-t border-surface-border pt-6">
          <MarkdownRenderer content={streamingEChartsContent} isStreaming />
        </section>
      </div>
    </main>
  );
}
