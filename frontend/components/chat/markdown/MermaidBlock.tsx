"use client";

import { useEffect, useMemo, useState } from "react";

type MermaidBlockProps = {
  value: string;
  blockId?: string;
};

let mermaidInitialized = false;

function stableMermaidId(blockId: string | undefined, value: string) {
  let hash = 2166136261;
  const source = `${blockId || "mermaid"}:${value}`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `md-mermaid-${(hash >>> 0).toString(36)}`;
}

export default function MermaidBlock({ value, blockId }: MermaidBlockProps) {
  const diagramId = useMemo(() => stableMermaidId(blockId, value), [blockId, value]);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setSvg(null);

    import("mermaid")
      .then(async (module) => {
        const mermaid = module.default;
        if (!mermaidInitialized) {
          mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
          mermaidInitialized = true;
        }
        const rendered = await mermaid.render(diagramId, value);
        if (!cancelled) setSvg(rendered.svg);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [diagramId, value]);

  if (failed) {
    return (
      <pre className="my-4 overflow-x-auto rounded-xl border border-surface-border bg-surface-card/50 p-3 text-xs text-text-secondary">
        {value}
      </pre>
    );
  }

  return (
    <div className="my-4 overflow-x-auto rounded-xl border border-surface-border bg-surface-card/40 p-4" data-md-mermaid="true">
      {svg ? <div className="min-w-fit text-text-primary" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="text-sm text-text-tertiary">渲染图表中…</div>}
    </div>
  );
}
