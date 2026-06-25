export type ParsedThinkContent = {
  reasoning: string | null;
  answer: string;
  isThinking: boolean;
};

export type ChatSourceLike = {
  title: string;
  url: string;
  description: string;
};

export type MessageGenerationLike = {
  content?: string;
  completedAt?: unknown;
  createdAt?: number;
  stopped?: boolean;
  activityStatus?: { status?: string } | null;
  searchStatus?: "searching" | "completed" | "failed";
  serverMessageId?: unknown;
  generationTaskId?: unknown;
  backgroundTaskId?: unknown;
  serverGenerationStatus?: string;
  useBackground?: boolean;
  isComplexTask?: boolean;
};

export function parseThinkContent(content: string): ParsedThinkContent {
  const startIdx = content.indexOf("<think>");
  if (startIdx === -1) return { reasoning: null, answer: content, isThinking: false };

  const endIdx = content.indexOf("</think>");
  if (endIdx === -1) {
    return {
      reasoning: content.slice(startIdx + 7),
      answer: content.slice(0, startIdx),
      isThinking: true,
    };
  }

  return {
    reasoning: content.slice(startIdx + 7, endIdx).trim(),
    answer: (content.slice(0, startIdx) + content.slice(endIdx + 8)).trim(),
    isThinking: false,
  };
}

export function extractCitations(content: string): number[] {
  const matches = content.match(/\[(\d+)\]/g);
  if (!matches) return [];
  const nums = matches.map((m) => parseInt(m.slice(1, -1), 10));
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

export function sanitizeContent(content: string): string {
  let result = content;

  result = result.replace(
    /^\[\s*([^\]]*(?:[=+\-*/^\\]|\\[a-zA-Z]+|[_^])[^\]]*)\s*\]$/gm,
    (_match, formula) => `$$${String(formula).trim()}$$`
  );

  result = result.replace(/\n{2,}[*_]*\s*(?:引用来源|参考来源|References|参考链接)[：:]\s*[\s\S]*$/, "");
  result = result.replace(/(?:\n+\[\d+\]\s+[^\n]*)+$/, "");
  result = result.replace(/\n*---+\s*$/, "");
  result = result.replace(/(?<!\d)\[(\d+)\](?!\s*[.)])/g, "");

  return result.trim();
}

export function getCitedSources(content: string, allSources?: ChatSourceLike[]) {
  if (!allSources || allSources.length === 0) return [];
  const citations = extractCitations(content);
  if (citations.length === 0) return [];
  return citations
    .filter((n) => n >= 1 && n <= allSources.length)
    .map((n) => allSources[n - 1]);
}

const EMPTY_ASSISTANT_RECOVERY_GRACE_MS = 8_000;

export function isMessageGenerating(msg: MessageGenerationLike, isStreaming: boolean): boolean {
  if (isStreaming) return true;
  if (msg.serverGenerationStatus === "completed" || msg.serverGenerationStatus === "failed" || msg.serverGenerationStatus === "cancelled" || msg.serverGenerationStatus === "incomplete") return false;
  if (msg.completedAt || msg.stopped) return false;
  if (msg.activityStatus?.status === "running" || msg.activityStatus?.status === "searching") return true;
  if (msg.searchStatus === "searching") return true;
  if (msg.generationTaskId || msg.backgroundTaskId || msg.useBackground || msg.isComplexTask) return true;
  if (!msg.content?.trim() && typeof msg.createdAt === "number" && Date.now() - msg.createdAt < EMPTY_ASSISTANT_RECOVERY_GRACE_MS) {
    return true;
  }
  return false;
}
