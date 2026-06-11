import { marked } from "marked";
import {
  getCachedMarkdownTokens,
  getMarkdownTokenCacheKey,
  hashMarkdownContent,
  setCachedMarkdownTokens,
} from "./markdownTokenCache";
import type { MarkdownBlockToken, MarkdownInlineToken, MarkdownTokenDocument } from "./markdownTokenTypes";

const COMPACT_PREVIEW_CHAR_LIMIT = 6_000;
const COMPACT_PREVIEW_BLOCK_LIMIT = 160;

function slicePreviewContent(content: string, compactPreview: boolean) {
  if (!compactPreview || content.length <= COMPACT_PREVIEW_CHAR_LIMIT) {
    return { text: content, truncated: false };
  }

  let text = content.slice(0, COMPACT_PREVIEW_CHAR_LIMIT);
  const lastFence = text.lastIndexOf("```");
  const fenceCount = (text.match(/```/g) || []).length;
  if (lastFence >= 0 && fenceCount % 2 === 1) {
    text = text.slice(0, lastFence);
  }
  const lastNewline = text.lastIndexOf("\n");
  if (lastNewline > COMPACT_PREVIEW_CHAR_LIMIT * 0.7) {
    text = text.slice(0, lastNewline);
  }
  return { text: text.trimEnd(), truncated: true };
}

function convertInlineTokens(tokens?: unknown[]): MarkdownInlineToken[] {
  if (!tokens || tokens.length === 0) return [];
  return tokens.flatMap((token: any): MarkdownInlineToken[] => {
    switch (token.type) {
      case "text":
      case "escape":
        return [{ type: "text", text: token.text || token.raw || "" }];
      case "strong":
        return [{ type: "strong", children: convertInlineTokens(token.tokens) }];
      case "em":
        return [{ type: "em", children: convertInlineTokens(token.tokens) }];
      case "codespan":
        return [{ type: "codespan", text: token.text || "" }];
      case "link":
        return [{ type: "link", href: token.href || "#", title: token.title, children: convertInlineTokens(token.tokens) }];
      case "del":
        return [{ type: "del", children: convertInlineTokens(token.tokens) }];
      case "br":
        return [{ type: "br" }];
      case "html":
        return [{ type: "html", raw: token.raw || token.text || "" }];
      default:
        return [{ type: "text", text: token.raw || token.text || "" }];
    }
  });
}

function inlineFromText(text = "") {
  if (!text) return [];
  const lexer = new marked.Lexer({ gfm: true, breaks: false });
  return convertInlineTokens(lexer.inlineTokens(text));
}

function paragraphFromInline(tokens?: unknown[], fallback = ""): MarkdownBlockToken {
  const children = convertInlineTokens(tokens);
  return { type: "paragraph", children: children.length ? children : inlineFromText(fallback) };
}

function convertMarkedInlineCell(cell: any): MarkdownInlineToken[] {
  const children = convertInlineTokens(cell?.tokens);
  return children.length ? children : inlineFromText(cell?.text || "");
}

function convertBlockTokens(tokens?: unknown[]): MarkdownBlockToken[] {
  if (!tokens || tokens.length === 0) return [];
  return tokens.flatMap((token: any): MarkdownBlockToken[] => {
    switch (token.type) {
      case "space":
        return [{ type: "space" }];
      case "heading":
        return [{ type: "heading", depth: Math.min(6, Math.max(1, token.depth || 1)) as 1 | 2 | 3 | 4 | 5 | 6, children: convertMarkedInlineCell(token) }];
      case "paragraph":
        return [paragraphFromInline(token.tokens, token.text || token.raw || "")];
      case "blockquote":
        return [{ type: "blockquote", children: convertBlockTokens(token.tokens) }];
      case "list":
        return [{
          type: "list",
          ordered: Boolean(token.ordered),
          start: token.start,
          items: (token.items || []).map((item: any) => ({
            checked: typeof item.checked === "boolean" ? item.checked : undefined,
            blocks: convertBlockTokens(item.tokens).filter((block) => block.type !== "space"),
          })),
        }];
      case "code":
        return [{ type: "code", lang: token.lang || "", text: token.text || "" }];
      case "table":
        return [{
          type: "table",
          header: (token.header || []).map(convertMarkedInlineCell),
          rows: (token.rows || []).map((row: any[]) => row.map(convertMarkedInlineCell)),
        }];
      case "hr":
        return [{ type: "hr" }];
      case "html":
        return [{ type: "html", raw: token.raw || token.text || "" }];
      default:
        return [{ type: "unknown", raw: token.raw || token.text || "" }];
    }
  });
}

function detectFeatures(tokens: MarkdownBlockToken[]) {
  let hasCode = false;
  let hasTable = false;
  let hasLinks = false;
  let hasHtml = false;

  const scanInline = (items: MarkdownInlineToken[]) => {
    items.forEach((item) => {
      if (item.type === "link") hasLinks = true;
      if (item.type === "html") hasHtml = true;
      if ("children" in item) scanInline(item.children);
    });
  };
  const scanBlocks = (blocks: MarkdownBlockToken[]) => {
    blocks.forEach((block) => {
      if (block.type === "code") hasCode = true;
      if (block.type === "table") hasTable = true;
      if (block.type === "html") hasHtml = true;
      if ("children" in block && Array.isArray(block.children)) scanInline(block.children as MarkdownInlineToken[]);
      if (block.type === "blockquote") scanBlocks(block.children);
      if (block.type === "list") block.items.forEach((item) => scanBlocks(item.blocks));
      if (block.type === "table") {
        block.header.forEach(scanInline);
        block.rows.forEach((row) => row.forEach(scanInline));
      }
    });
  };
  scanBlocks(tokens);
  return { hasCode, hasTable, hasLinks, hasHtml };
}

export function tokenizeMarkdown({ content, compactPreview = true }: { content: string; compactPreview?: boolean }): MarkdownTokenDocument {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const key = getMarkdownTokenCacheKey({ content, compactPreview });
  const cached = getCachedMarkdownTokens(key);
  if (cached) return cached;

  const preview = slicePreviewContent(content, compactPreview);
  const rawTokens = marked.lexer(preview.text, { gfm: true, breaks: false });
  let tokens = convertBlockTokens(rawTokens).filter((token) => token.type !== "space");
  let truncated = preview.truncated;
  if (compactPreview && tokens.length > COMPACT_PREVIEW_BLOCK_LIMIT) {
    tokens = tokens.slice(0, COMPACT_PREVIEW_BLOCK_LIMIT);
    truncated = true;
  }
  const ended = typeof performance !== "undefined" ? performance.now() : Date.now();
  const doc: MarkdownTokenDocument = {
    contentHash: hashMarkdownContent(content),
    sourceLength: content.length,
    tokens,
    truncated,
    parseMs: Math.max(0, ended - started),
    cacheHit: false,
    tokenizerSource: "main",
    featureFlags: detectFeatures(tokens),
  };
  setCachedMarkdownTokens(key, doc);
  return doc;
}
