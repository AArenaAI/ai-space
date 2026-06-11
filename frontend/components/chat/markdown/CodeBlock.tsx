"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { emitChatRenderProfileEvent, isChatRenderProfileEnabled } from "@/lib/chatRenderProfile";

const LazySyntaxHighlighter = dynamic(() => import("../LazySyntaxHighlighter"), {
  ssr: false,
  loading: () => null,
});

const LONG_CODE_CHAR_THRESHOLD = 4000;
const LONG_CODE_LINE_THRESHOLD = 120;
const LONG_CODE_PREVIEW_CHAR_LIMIT = 1200;

function formatCodeSize(lineCount: number, charCount: number, t: (key: string, params?: Record<string, string>) => string) {
  const charLabel = charCount >= 1000
    ? t("chat.code.kCharacters", { count: (charCount / 1000).toFixed(1) })
    : t("chat.code.characters", { count: String(charCount) });
  return t("chat.code.size", { lines: String(lineCount), chars: charLabel });
}

function CodeBlockProfileProbe({
  charCount,
  copied,
  expanded,
  isLongCode,
  language,
  lightweight,
  lineCount,
  renderStartedAt,
}: {
  charCount: number;
  copied: boolean;
  expanded: boolean;
  isLongCode: boolean;
  language: string;
  lightweight: boolean;
  lineCount: number;
  renderStartedAt: number;
}) {
  useEffect(() => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const bodyMode = expanded ? (lightweight ? "lightweight-pre" : "syntax-highlighter") : "collapsed-preview";
    emitChatRenderProfileEvent("markdown-code-block-commit", {
      bodyMode,
      charCount,
      copyState: copied ? "copied" : "idle",
      durationMs: Number((now - renderStartedAt).toFixed(2)),
      expanded,
      hasCollapseButton: isLongCode,
      hasCopyButton: true,
      hasSizeLabel: isLongCode,
      isLongCode,
      language: language || "text",
      lightweight,
      lineCount,
    });
  }, [charCount, copied, expanded, isLongCode, language, lightweight, lineCount, renderStartedAt]);
  return null;
}

export default function CodeBlock({ language, value, lightweight = false }: { language: string; value: string; lightweight?: boolean }) {
  const profileEnabled = isChatRenderProfileEnabled();
  const renderStartedAt = profileEnabled ? (typeof performance !== "undefined" ? performance.now() : Date.now()) : 0;
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const lineCount = value.split("\n").length;
  const charCount = value.length;
  const codeSizeLabel = formatCodeSize(lineCount, charCount, t);
  const isLongCode = charCount >= LONG_CODE_CHAR_THRESHOLD || lineCount >= LONG_CODE_LINE_THRESHOLD;
  const [expanded, setExpanded] = useState(!isLongCode);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      data-testid="markdown-code-block"
      className="not-prose relative group my-4 overflow-hidden rounded-2xl border border-black/5 bg-[#FAFAFA] dark:border-white/5 dark:bg-[#0D1117]"
    >
      {profileEnabled && (
        <CodeBlockProfileProbe
          charCount={charCount}
          copied={copied}
          expanded={expanded}
          isLongCode={isLongCode}
          language={language}
          lightweight={lightweight}
          lineCount={lineCount}
          renderStartedAt={renderStartedAt}
        />
      )}
      <div className="flex min-h-9 items-center justify-between gap-3 px-4 py-2">
        <span className="min-w-0 truncate text-[12px] font-medium text-gray-600 dark:text-gray-300">
          {language || "text"}
        </span>
        <div className="flex items-center gap-1.5">
          {isLongCode && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-gray-500 transition-colors hover:bg-black/5 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-white/10 dark:hover:text-white"
              data-testid="markdown-code-collapse-toggle"
              aria-expanded={expanded}
            >
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
              {expanded ? t("chat.code.collapse", { size: codeSizeLabel }) : t("chat.code.longCollapsed", { size: codeSizeLabel })}
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-gray-500 transition-colors hover:bg-black/5 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-white/10 dark:hover:text-white"
            data-testid="markdown-code-copy-button"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? t("chat.action.copied") : t("chat.action.copy")}
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="max-h-[420px] overflow-auto bg-transparent">
          {lightweight ? (
            <pre className="bg-transparent px-5 py-4 text-[13px] leading-6 text-[#24292F] whitespace-pre-wrap break-words font-mono dark:text-[#D1D5DB]">{value}</pre>
          ) : (
            <LazySyntaxHighlighter language={language} value={value} />
          )}
        </div>
      ) : (
        <div className="bg-transparent px-5 py-4 text-[13px] leading-6 text-[#24292F] dark:text-[#D1D5DB]" data-testid="markdown-code-collapsed-preview">
          <pre className="max-h-28 overflow-hidden bg-transparent whitespace-pre-wrap break-words font-mono">{value.slice(0, LONG_CODE_PREVIEW_CHAR_LIMIT)}</pre>
          <div className="mt-2 text-[12px] leading-5 text-gray-500 dark:text-gray-400">{t("chat.code.expandFull", { size: codeSizeLabel })}</div>
        </div>
      )}
    </div>
  );
}
