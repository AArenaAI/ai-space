"use client";

import { CSSProperties, useEffect, useState } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";

type PrismHighlighter = React.ComponentType<{
  language: string;
  style: Record<string, unknown>;
  customStyle: CSSProperties;
  children: string;
}>;

interface LoadedSyntaxHighlighter {
  SyntaxHighlighter: PrismHighlighter;
  vscDarkPlus: Record<string, unknown>;
  oneLight: Record<string, unknown>;
}

let loadedHighlighter: LoadedSyntaxHighlighter | null = null;
let loadPromise: Promise<LoadedSyntaxHighlighter> | null = null;

function loadSyntaxHighlighter() {
  if (loadedHighlighter) return Promise.resolve(loadedHighlighter);
  if (!loadPromise) {
    loadPromise = Promise.all([
      import("react-syntax-highlighter").then((mod) => mod.Prism as unknown as PrismHighlighter),
      import("react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus").then((mod) => mod.default as Record<string, unknown>),
      import("react-syntax-highlighter/dist/esm/styles/prism/one-light").then((mod) => mod.default as Record<string, unknown>),
    ]).then(([SyntaxHighlighter, vscDarkPlus, oneLight]) => {
      loadedHighlighter = { SyntaxHighlighter, vscDarkPlus, oneLight };
      return loadedHighlighter;
    });
  }
  return loadPromise;
}

function CodeFallback({ language, value }: { language: string; value: string }) {
  return (
    <pre className="my-4 overflow-x-auto rounded-lg border border-surface-border bg-[#F6F8FA] p-4 text-[13px] leading-6 text-[#333333] dark:bg-[#0D0D0D] dark:text-[#E0E0E0]">
      <code data-language={language || "text"}>{value}</code>
    </pre>
  );
}

export default function LazySyntaxHighlighter({ language, value }: { language: string; value: string }) {
  const [loaded, setLoaded] = useState<LoadedSyntaxHighlighter | null>(loadedHighlighter);
  const themeCtx = useTheme();
  const isDark = themeCtx?.theme === "dark";

  useEffect(() => {
    let cancelled = false;
    loadSyntaxHighlighter().then((next) => {
      if (!cancelled) setLoaded(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) {
    return <CodeFallback language={language} value={value} />;
  }

  const { SyntaxHighlighter, vscDarkPlus, oneLight } = loaded;
  return (
    <SyntaxHighlighter
      language={language || "text"}
      style={isDark ? vscDarkPlus : oneLight}
      customStyle={{
        margin: 0,
        padding: "1rem",
        fontSize: "13px",
        lineHeight: "1.5",
        background: isDark ? "#0D0D0D" : "#F6F8FA",
        overflowX: "auto",
      }}
    >
      {value}
    </SyntaxHighlighter>
  );
}
