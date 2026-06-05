export type MarkdownInlineToken =
  | { type: "text"; text: string }
  | { type: "strong"; children: MarkdownInlineToken[] }
  | { type: "em"; children: MarkdownInlineToken[] }
  | { type: "codespan"; text: string }
  | { type: "link"; href: string; title?: string | null; children: MarkdownInlineToken[] }
  | { type: "del"; children: MarkdownInlineToken[] }
  | { type: "br" }
  | { type: "html"; raw: string };

export type MarkdownBlockToken =
  | { type: "heading"; depth: 1 | 2 | 3 | 4 | 5 | 6; children: MarkdownInlineToken[] }
  | { type: "paragraph"; children: MarkdownInlineToken[] }
  | { type: "blockquote"; children: MarkdownBlockToken[] }
  | { type: "list"; ordered: boolean; start?: number; items: { checked?: boolean; blocks: MarkdownBlockToken[] }[] }
  | { type: "code"; lang?: string; text: string }
  | { type: "table"; header: MarkdownInlineToken[][]; rows: MarkdownInlineToken[][][] }
  | { type: "hr" }
  | { type: "html"; raw: string }
  | { type: "space" }
  | { type: "unknown"; raw: string };

export type MarkdownTokenDocument = {
  contentHash: string;
  sourceLength: number;
  tokens: MarkdownBlockToken[];
  truncated: boolean;
  parseMs: number;
  cacheHit: boolean;
  featureFlags: {
    hasCode: boolean;
    hasTable: boolean;
    hasLinks: boolean;
    hasHtml: boolean;
  };
};
