"use client";

import type { MarkdownBlockToken } from "@/lib/markdown/markdownTokenTypes";
import CodeBlock from "./CodeBlock";
import MarkdownInlineTokenRenderer from "./MarkdownInlineTokenRenderer";

function ListItemBlocks({ blocks }: { blocks: MarkdownBlockToken[] }) {
  if (blocks.length === 1 && blocks[0].type === "paragraph") {
    return <MarkdownInlineTokenRenderer tokens={blocks[0].children} />;
  }
  return <>{blocks.map((block, index) => <MarkdownBlockTokenRenderer key={index} token={block} nested />)}</>;
}

export default function MarkdownBlockTokenRenderer({ token, nested = false }: { token: MarkdownBlockToken; nested?: boolean }) {
  if (token.type === "heading") {
    const Heading = (`h${token.depth}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6");
    const className = token.depth === 1
      ? "text-xl font-semibold text-text-primary mb-3 mt-6"
      : token.depth === 2
        ? "text-lg font-semibold text-text-primary mb-2 mt-5"
        : "text-base font-semibold text-text-primary mb-2 mt-4";
    return <Heading className={className}><MarkdownInlineTokenRenderer tokens={token.children} /></Heading>;
  }

  if (token.type === "paragraph") {
    return <p className={`${nested ? "mb-1" : "mb-4"} text-[15px] leading-relaxed text-text-primary`}><MarkdownInlineTokenRenderer tokens={token.children} /></p>;
  }

  if (token.type === "blockquote") {
    return <blockquote className="border-l-2 border-surface-border pl-4 italic text-text-secondary my-4">{token.children.map((child, index) => <MarkdownBlockTokenRenderer key={index} token={child} nested />)}</blockquote>;
  }

  if (token.type === "list") {
    const ListTag = token.ordered ? "ol" : "ul";
    const className = token.items.some((item) => typeof item.checked === "boolean")
      ? "ml-1 mb-4 space-y-1 text-text-primary"
      : `${token.ordered ? "list-decimal" : "list-disc"} ml-5 mb-4 space-y-1 text-text-primary`;
    return (
      <ListTag className={className} start={token.ordered ? token.start : undefined}>
        {token.items.map((item, index) => (
          <li key={index} className={typeof item.checked === "boolean" ? "flex items-start gap-2 text-[15px] leading-relaxed" : "text-[15px] leading-relaxed"}>
            {typeof item.checked === "boolean" ? <input type="checkbox" checked={item.checked} readOnly className="mt-1 h-4 w-4 rounded border-surface-border" /> : null}
            <span><ListItemBlocks blocks={item.blocks} /></span>
          </li>
        ))}
      </ListTag>
    );
  }

  if (token.type === "code") {
    return <CodeBlock language={token.lang || ""} value={token.text} lightweight />;
  }

  if (token.type === "table") {
    return (
      <div className="my-4 max-w-full overflow-x-auto rounded-xl border border-surface-border bg-surface-card/40">
        <table className="min-w-full border-collapse text-left text-sm text-text-primary">
          {token.header.length > 0 && (
            <thead className="bg-surface-elevated/70 text-text-secondary">
              <tr>{token.header.map((cell, index) => <th key={index} className="border-b border-surface-border px-3 py-2 font-medium"><MarkdownInlineTokenRenderer tokens={cell} /></th>)}</tr>
            </thead>
          )}
          <tbody>
            {token.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="odd:bg-surface-card/20">
                {row.map((cell, cellIndex) => <td key={cellIndex} className="border-b border-surface-border/60 px-3 py-2 align-top"><MarkdownInlineTokenRenderer tokens={cell} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (token.type === "hr") return <hr className="my-5 border-surface-border" />;
  if (token.type === "html") return <span className="text-text-primary">{token.raw}</span>;
  if (token.type === "space") return null;
  return <p className="mb-4 text-[15px] leading-relaxed text-text-primary">{token.raw}</p>;
}
