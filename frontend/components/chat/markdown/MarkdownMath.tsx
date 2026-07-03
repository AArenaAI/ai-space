"use client";

import { useMemo } from "react";
import katex from "katex";

type MarkdownMathProps = {
  value: string;
  displayMode?: boolean;
};

export default function MarkdownMath({ value, displayMode = false }: MarkdownMathProps) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(value, {
        displayMode,
        throwOnError: false,
        strict: false,
        trust: false,
        output: "html",
      });
    } catch {
      return null;
    }
  }, [displayMode, value]);

  if (!html) {
    return displayMode ? <pre className="my-4 overflow-x-auto rounded-xl bg-surface-card p-3 text-sm">{`$$\n${value}\n$$`}</pre> : <code>{`$${value}$`}</code>;
  }

  const className = displayMode
    ? "my-4 overflow-x-auto rounded-xl bg-surface-card/40 px-4 py-3 text-text-primary"
    : "mx-0.5 inline-block align-baseline text-text-primary";

  return <span className={className} data-md-math={displayMode ? "block" : "inline"} dangerouslySetInnerHTML={{ __html: html }} />;
}
