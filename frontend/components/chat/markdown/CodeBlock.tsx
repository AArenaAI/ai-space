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
    <div data-testid="markdown-code-block" className="relative group my-4 rounded-lg overflow-hidden border border-surface-border">
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
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-surface-border bg-[#F6F8FA] dark:bg-[#0D0D0D]">
        <span className="min-w-0 truncate text-[11px] font-mono uppercase text-gray-500 dark:text-gray-400">
          {language || "text"}
        </span>
        <div className="flex items-center gap-2">
          {isLongCode && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-gray-500 transition-colors hover:bg-surface-card hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
              data-testid="markdown-code-collapse-toggle"
              aria-expanded={expanded}
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
              {expanded ? t("chat.code.collapse", { size: codeSizeLabel }) : t("chat.code.longCollapsed", { size: codeSizeLabel })}
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 text-[11px] transition-colors opacity-100 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
            data-testid="markdown-code-copy-button"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? t("chat.action.copied") : t("chat.action.copy")}
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="max-h-[400px] overflow-auto">
          {lightweight ? (
            <pre className="bg-[#0D1117] px-4 py-3 text-[13px] text-gray-300 whitespace-pre-wrap break-words font-mono">{value}</pre>
          ) : (
            <LazySyntaxHighlighter language={language} value={value} />
          )}
        </div>
      ) : (
        <div className="bg-[#0D1117] px-4 py-3 text-[13px] text-gray-300" data-testid="markdown-code-collapsed-preview">
          <pre className="max-h-28 overflow-hidden whitespace-pre-wrap break-words font-mono">{value.slice(0, LONG_CODE_PREVIEW_CHAR_LIMIT)}</pre>
          <div className="mt-2 text-[11px] text-gray-500">{t("chat.code.expandFull", { size: codeSizeLabel })}</div>
        </div>
      )}
    </div>
  );
}
