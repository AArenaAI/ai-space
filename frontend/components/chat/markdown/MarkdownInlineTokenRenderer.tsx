"use client";

import type { MarkdownInlineToken } from "@/lib/markdown/markdownTokenTypes";
import MarkdownMath from "./MarkdownMath";

function sanitizeHref(href: string) {
  const trimmed = href.trim();
  if (/^(https?:|mailto:|tel:|\/)/i.test(trimmed)) return trimmed;
  return "#";
}

export default function MarkdownInlineTokenRenderer({ tokens }: { tokens: MarkdownInlineToken[] }) {
  return (
    <>
      {tokens.map((token, index) => {
        if (token.type === "text") return <span key={index}>{token.text}</span>;
        if (token.type === "strong") return <strong key={index} className="font-semibold text-text-primary"><MarkdownInlineTokenRenderer tokens={token.children} /></strong>;
        if (token.type === "em") return <em key={index} className="italic"><MarkdownInlineTokenRenderer tokens={token.children} /></em>;
        if (token.type === "math") return <MarkdownMath key={index} value={token.text} />;
        if (token.type === "footnoteRef") return <sup key={index} data-md-footnote-ref={token.id} className="ml-0.5 text-[11px] text-primary"><a href={`#fn-${token.id}`} className="no-underline">[{token.label}]</a></sup>;
        if (token.type === "codespan") return <code key={index} className="bg-[#E8E8E8] dark:bg-[#2A2A3A] text-[#333333] dark:text-[#E0E0E0] px-1 py-0.5 rounded text-[13px] font-mono">{token.text}</code>;
        if (token.type === "del") return <del key={index} className="text-text-secondary"><MarkdownInlineTokenRenderer tokens={token.children} /></del>;
        if (token.type === "link") return <a key={index} href={sanitizeHref(token.href)} title={token.title || undefined} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80"><MarkdownInlineTokenRenderer tokens={token.children} /></a>;
        if (token.type === "br") return <br key={index} />;
        return <span key={index}>{token.raw}</span>;
      })}
    </>
  );
}
