"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";

function parseThinkContent(content: string) {
  const startIdx = content.indexOf("<think>");
  if (startIdx === -1) return { reasoning: null, answer: content };
  const endIdx = content.indexOf("</think>", startIdx);
  if (endIdx === -1) {
    return {
      reasoning: content.slice(startIdx + 7),
      answer: content.slice(0, startIdx),
    };
  }
  return {
    reasoning: content.slice(startIdx + 7, endIdx).trim(),
    answer: (content.slice(0, startIdx) + content.slice(endIdx + 8)).trim(),
  };
}

function sanitizeContent(content: string): string {
  let result = content;
  result = result.replace(/\n*[*_]*\s*(?:引用来源|参考来源|来源|References|参考链接)[：:][\s\S]*$/, "");
  result = result.replace(/\n*\[\d+\]\s+[^\n]*(?:\n\[\d+\]\s+[^\n]*)*$/, "");
  result = result.replace(/\n*---+\s*$/, "");
  result = result.replace(/(?<!\d)\[(\d+)\](?!\s*[.)])/g, "");
  return result.trim();
}

function remarkFixBold() {
  return (tree: any) => {
    const visit = (node: any) => {
      if (node.type === "text" && node.value) {
        const pattern = /\*\*([^*]+?)\*\*/g;
        const segments: any[] = [];
        let lastIndex = 0;
        let match;
        while ((match = pattern.exec(node.value)) !== null) {
          if (match.index > lastIndex) {
            segments.push({ type: "text", value: node.value.slice(lastIndex, match.index) });
          }
          segments.push({ type: "strong", children: [{ type: "text", value: match[1] }] });
          lastIndex = match.index + match[0].length;
        }
        if (lastIndex < node.value.length) {
          segments.push({ type: "text", value: node.value.slice(lastIndex) });
        }
        if (segments.length > 0) {
          Object.assign(node, { type: "paragraph", children: segments });
        }
      }
      if (node.children) node.children.forEach(visit);
    };
    visit(tree);
  };
}

const components = {
  table({ children }: any) {
    return (
      <div className="overflow-x-auto my-4">
        <table className="min-w-full text-sm border-collapse border border-surface-border">
          {children}
        </table>
      </div>
    );
  },
  thead({ children }: any) { return <thead className="bg-surface-card">{children}</thead>; },
  tbody({ children }: any) { return <tbody>{children}</tbody>; },
  tr({ children }: any) { return <tr className="border-b border-surface-border">{children}</tr>; },
  th({ children }: any) { return <th className="px-3 py-2 text-left font-semibold text-text-primary border border-surface-border">{children}</th>; },
  td({ children }: any) { return <td className="px-3 py-2 text-text-secondary border border-surface-border">{children}</td>; },
  h1({ children }: any) { return <h1 className="text-xl font-bold text-text-primary mt-6 mb-3">{children}</h1>; },
  h2({ children }: any) { return <h2 className="text-lg font-semibold text-text-primary mt-5 mb-2">{children}</h2>; },
  h3({ children }: any) { return <h3 className="text-base font-medium text-text-primary mt-4 mb-2">{children}</h3>; },
  p({ children }: any) { return <p className="text-text-secondary leading-relaxed mb-3">{children}</p>; },
  ul({ children }: any) { return <ul className="list-disc list-inside text-text-secondary mb-3">{children}</ul>; },
  ol({ children }: any) { return <ol className="list-decimal list-inside text-text-secondary mb-3">{children}</ol>; },
  li({ children }: any) { return <li className="mb-1">{children}</li>; },
  code({ node, inline, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || "");
    const lang = match?.[1] || "";
    if (!inline && lang === "echarts") {
      return <div className="my-4 p-4 bg-surface-card rounded-xl">[ECharts Block]</div>;
    }
    return !inline && match ? (
      <pre className="bg-surface-card p-3 rounded-lg overflow-x-auto text-sm my-3"><code className={className} {...props}>{children}</code></pre>
    ) : (
      <code className="bg-surface-card px-1 py-0.5 rounded text-sm font-mono text-brand" {...props}>{children}</code>
    );
  },
};

export default function TestPage2() {
  const [content, setContent] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/conversations/212")
      .then(r => r.json())
      .then(data => {
        const msg = data.messages?.find((m: any) => m.id === 866);
        if (msg) {
          setContent(msg.content);
        } else {
          setError("Message 866 not found");
        }
      })
      .catch(e => setError(String(e)));
  }, []);

  if (error) return <div className="p-8 text-red-500">Error: {error}</div>;
  if (!content) return <div className="p-8">Loading...</div>;

  const { reasoning, answer } = parseThinkContent(content);
  const cleanAnswer = sanitizeContent(answer);

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Full MessageList Logic Test</h1>
      <div className="mb-4 text-sm text-gray-500">
        Content length: {content.length} | Answer length: {answer.length} | Clean length: {cleanAnswer.length}
      </div>
      {reasoning && (
        <div className="mb-4 p-3 bg-blue-50 rounded-lg">
          <h3>Reasoning:</h3>
          <pre className="text-xs whitespace-pre-wrap">{reasoning}</pre>
        </div>
      )}
      <div className="prose prose-sm max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkFixBold]} components={components}>
          {cleanAnswer}
        </ReactMarkdown>
      </div>
    </div>
  );
}
