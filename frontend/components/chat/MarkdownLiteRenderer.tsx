"use client";

import { memo, useEffect, useMemo } from "react";
import CodeBlock from "./markdown/CodeBlock";

const STABLE_LITE_RICH_CHARS = 3500;
const STABLE_LITE_RICH_LINES = 50;
const STABLE_PREVIEW_LITE_LENGTH_THRESHOLD = 10_000;
const STABLE_PREVIEW_LITE_CODE_BLOCK_THRESHOLD = 20;
const STABLE_PREVIEW_LITE_TABLE_LINE_THRESHOLD = 100;
const COMPACT_LITE_RICH_CHARS = 2200;
const COMPACT_LITE_RICH_LINES = 32;
const COMPACT_PREVIEW_LITE_LENGTH_THRESHOLD = 3_000;
const COMPACT_PREVIEW_LITE_CODE_BLOCK_THRESHOLD = 2;
const COMPACT_PREVIEW_LITE_TABLE_LINE_THRESHOLD = 7;
const LITE_PARSE_CACHE_LIMIT = 80;

type LiteBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "taskList"; items: { checked: boolean; text: string }[] }
  | { type: "ol"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; lang: string; value: string }
  | { type: "table"; rows: string[][] };

type LiteParseResult = {
  blocks: LiteBlock[];
  codeBlocks: number;
  isPreview: boolean;
  parseMs: number;
  tableLines: number;
  text: string;
  wasCacheHit: boolean;
};

const liteParseCache = new Map<string, Omit<LiteParseResult, "parseMs" | "wasCacheHit">>();

function emitChatRenderProfileEvent(phase: string, detail: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const at = typeof performance !== "undefined" ? performance.now() : Date.now();
  window.dispatchEvent(new CustomEvent("chat-render-profile", {
    detail: { phase, at, ...detail },
  }));
}

function rememberLiteParse(content: string, value: Omit<LiteParseResult, "parseMs" | "wasCacheHit">) {
  liteParseCache.set(content, value);
  if (liteParseCache.size <= LITE_PARSE_CACHE_LIMIT) return;
  const oldest = liteParseCache.keys().next().value;
  if (oldest) liteParseCache.delete(oldest);
}

function getLiteRichContent(content: string, compactPreview: boolean) {
  let codeFenceCount = 0;
  let tableLines = 0;
  const previewLines: string[] = [];
  let previewLength = 0;
  const lines = content.split("\n");

  const maxChars = compactPreview ? COMPACT_LITE_RICH_CHARS : STABLE_LITE_RICH_CHARS;
  const maxLines = compactPreview ? COMPACT_LITE_RICH_LINES : STABLE_LITE_RICH_LINES;
  for (const line of lines) {
    if (line.includes("```")) {
      codeFenceCount += line.split("```").length - 1;
    }
    if (/^\s*\|.+\|\s*$/.test(line)) {
      tableLines += 1;
    }
    if (previewLines.length < maxLines && previewLength < maxChars) {
      const nextLine = previewLength + line.length > maxChars
        ? line.slice(0, Math.max(0, maxChars - previewLength))
        : line;
      previewLines.push(nextLine);
      previewLength += nextLine.length + 1;
    }
  }

  const codeBlocks = Math.floor(codeFenceCount / 2);
  const lengthThreshold = compactPreview ? COMPACT_PREVIEW_LITE_LENGTH_THRESHOLD : STABLE_PREVIEW_LITE_LENGTH_THRESHOLD;
  const codeBlockThreshold = compactPreview ? COMPACT_PREVIEW_LITE_CODE_BLOCK_THRESHOLD : STABLE_PREVIEW_LITE_CODE_BLOCK_THRESHOLD;
  const tableLineThreshold = compactPreview ? COMPACT_PREVIEW_LITE_TABLE_LINE_THRESHOLD : STABLE_PREVIEW_LITE_TABLE_LINE_THRESHOLD;
  const shouldPreview =
    content.length > lengthThreshold ||
    codeBlocks >= codeBlockThreshold ||
    tableLines >= tableLineThreshold;
  if (!shouldPreview) return { codeBlocks, isPreview: false, tableLines, text: content };

  return { codeBlocks, isPreview: true, tableLines, text: previewLines.join("\n").slice(0, maxChars).trimEnd() };
}

function parseLiteBlocks(markdown: string): LiteBlock[] {
  const lines = markdown.split("\n");
  const blocks: LiteBlock[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let taskItems: { checked: boolean; text: string }[] = [];
  let orderedItems: string[] = [];
  let tableRows: string[][] = [];
  let codeLang = "";
  let codeLines: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ").trim() });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (listItems.length) {
      blocks.push({ type: "ul", items: listItems });
      listItems = [];
    }
    if (taskItems.length) {
      blocks.push({ type: "taskList", items: taskItems });
      taskItems = [];
    }
    if (orderedItems.length) {
      blocks.push({ type: "ol", items: orderedItems });
      orderedItems = [];
    }
  };
  const flushTable = () => {
    if (tableRows.length) {
      blocks.push({ type: "table", rows: tableRows });
      tableRows = [];
    }
  };
  const parseTableRow = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  const isTableSeparator = (cells: string[]) => cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));

  lines.forEach((line) => {
    const fence = line.match(/^```\s*([\w-]*)/);
    if (fence) {
      if (codeLines) {
        blocks.push({ type: "code", lang: codeLang, value: codeLines.join("\n") });
        codeLines = null;
        codeLang = "";
      } else {
        flushParagraph();
        flushList();
        codeLang = fence[1] || "text";
        codeLines = [];
      }
      return;
    }
    if (codeLines) {
      codeLines.push(line);
      return;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      flushTable();
      return;
    }

    if (/^\s*\|.+\|\s*$/.test(line)) {
      const cells = parseTableRow(line);
      if (!isTableSeparator(cells)) {
        flushParagraph();
        flushList();
        tableRows.push(cells);
      }
      return;
    }
    flushTable();

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      return;
    }

    const task = trimmed.match(/^[-*]\s+\[([ xX])]\s+(.+)$/);
    if (task) {
      flushParagraph();
      if (listItems.length || orderedItems.length) flushList();
      taskItems.push({ checked: task[1].toLowerCase() === "x", text: task[2] });
      return;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (taskItems.length || orderedItems.length) flushList();
      listItems.push(unordered[1]);
      return;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (listItems.length || taskItems.length) flushList();
      orderedItems.push(ordered[1]);
      return;
    }

    if (trimmed.startsWith(">")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "quote", text: trimmed.replace(/^>\s?/, "") });
      return;
    }

    paragraph.push(trimmed);
  });

  flushParagraph();
  flushList();
  flushTable();
  if (codeLines) blocks.push({ type: "code", lang: codeLang, value: (codeLines as string[]).join("\n") });
  return blocks;
}

function getCachedLiteParse(content: string, compactPreview: boolean): LiteParseResult {
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();
  const cacheKey = `${compactPreview ? "compact" : "stable"}:${content}`;
  const cached = liteParseCache.get(cacheKey);
  if (cached) {
    liteParseCache.delete(cacheKey);
    liteParseCache.set(cacheKey, cached);
    return { ...cached, parseMs: 0, wasCacheHit: true };
  }

  const liteContent = getLiteRichContent(content, compactPreview);
  const blocks = parseLiteBlocks(liteContent.text);
  const value = { ...liteContent, blocks };
  rememberLiteParse(cacheKey, value);
  const end = typeof performance !== "undefined" ? performance.now() : Date.now();
  return { ...value, parseMs: Math.max(0, end - start), wasCacheHit: false };
}

function sanitizeHref(href: string) {
  const trimmed = href.trim();
  if (/^(https?:|mailto:|tel:|\/)/i.test(trimmed)) return trimmed;
  return "#";
}

function InlineText({ text, lightweightInline = false }: { text: string; lightweightInline?: boolean }) {
  if (lightweightInline) {
    return <span>{text}</span>;
  }

  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|~~[^~]+~~|\[[^\]]+\]\([^)]+\)|(?<!\*)\*[^*]+\*(?!\*)|_[^_]+_)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={index} className="font-semibold text-text-primary">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={index} className="bg-[#E8E8E8] dark:bg-[#2A2A3A] text-[#333333] dark:text-[#E0E0E0] px-1 py-0.5 rounded text-[13px] font-mono">{part.slice(1, -1)}</code>;
        }
        if (part.startsWith("~~") && part.endsWith("~~")) {
          return <del key={index} className="text-text-secondary">{part.slice(2, -2)}</del>;
        }
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          return <a key={index} href={sanitizeHref(link[2])} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80">{link[1]}</a>;
        }
        if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) {
          return <em key={index} className="italic">{part.slice(1, -1)}</em>;
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

const MarkdownLiteRenderer = memo(function MarkdownLiteRenderer({ content, compactPreview = true }: { content: string; isStreaming?: boolean; compactPreview?: boolean }) {
  const liteContent = useMemo(() => getCachedLiteParse(content, compactPreview), [compactPreview, content]);
  const blocks = liteContent.blocks;
  const lightweightInline = false;

  useEffect(() => {
    emitChatRenderProfileEvent("markdown-lite-rendered", {
      blockCount: blocks.length,
      cacheHit: liteContent.wasCacheHit,
      codeBlocks: liteContent.codeBlocks,
      contentLength: content.length,
      isPreview: liteContent.isPreview,
      parseMs: Number(liteContent.parseMs.toFixed(2)),
      compactPreview,
      tableLines: liteContent.tableLines,
    });
  }, [blocks.length, compactPreview, content.length, liteContent.codeBlocks, liteContent.isPreview, liteContent.parseMs, liteContent.tableLines, liteContent.wasCacheHit]);

  return (
    <div data-markdown-lite-renderer={liteContent.isPreview ? "stable-preview" : "full"}>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const Heading = (`h${block.level}` as "h1" | "h2" | "h3");
          const className = block.level === 1
            ? "text-xl font-semibold text-text-primary mb-3 mt-6"
            : block.level === 2
              ? "text-lg font-semibold text-text-primary mb-2 mt-5"
              : "text-base font-semibold text-text-primary mb-2 mt-4";
          return <Heading key={index} className={className}><InlineText text={block.text} lightweightInline={lightweightInline} /></Heading>;
        }
        if (block.type === "ul") {
          return <ul key={index} className="list-disc ml-5 mb-4 space-y-1 text-text-primary">{block.items.map((item, itemIndex) => <li key={itemIndex} className="text-[15px] leading-relaxed"><InlineText text={item} lightweightInline={lightweightInline} /></li>)}</ul>;
        }
        if (block.type === "taskList") {
          return (
            <ul key={index} className="ml-1 mb-4 space-y-1 text-text-primary">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex items-start gap-2 text-[15px] leading-relaxed">
                  <input type="checkbox" checked={item.checked} readOnly className="mt-1 h-4 w-4 rounded border-surface-border" />
                  <span><InlineText text={item.text} lightweightInline={lightweightInline} /></span>
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === "ol") {
          return <ol key={index} className="list-decimal ml-5 mb-4 space-y-1 text-text-primary">{block.items.map((item, itemIndex) => <li key={itemIndex} className="text-[15px] leading-relaxed"><InlineText text={item} lightweightInline={lightweightInline} /></li>)}</ol>;
        }
        if (block.type === "quote") {
          return <blockquote key={index} className="border-l-2 border-surface-border pl-4 italic text-text-secondary my-4"><InlineText text={block.text} lightweightInline={lightweightInline} /></blockquote>;
        }
        if (block.type === "code") {
          return <CodeBlock key={index} language={block.lang} value={block.value} lightweight />;
        }
        if (block.type === "table") {
          const [header, ...bodyRows] = block.rows;
          return (
            <div key={index} className="my-4 max-w-full overflow-x-auto rounded-xl border border-surface-border bg-surface-card/40">
              <table className="min-w-full border-collapse text-left text-sm text-text-primary">
                {header && (
                  <thead className="bg-surface-elevated/70 text-text-secondary">
                    <tr>{header.map((cell, cellIndex) => <th key={cellIndex} className="border-b border-surface-border px-3 py-2 font-medium"><InlineText text={cell} lightweightInline={lightweightInline} /></th>)}</tr>
                  </thead>
                )}
                <tbody>
                  {bodyRows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-b border-surface-border/70 last:border-b-0">
                      {row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2 align-top"><InlineText text={cell} lightweightInline={lightweightInline} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={index} className="text-[15px] leading-relaxed text-text-primary mb-4 last:mb-0"><InlineText text={block.text} lightweightInline={lightweightInline} /></p>;
      })}
    </div>
  );
});

export default MarkdownLiteRenderer;
