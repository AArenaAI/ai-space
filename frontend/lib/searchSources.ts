import type { SearchSource } from "./chatTypes";

function safeHost(url?: string) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "").toLowerCase();
  }
}

function normalizeDomainText(value?: string) {
  const text = (value || "").trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "").toLowerCase();
  return text;
}

function looksLikeDomain(value?: string) {
  const text = normalizeDomainText(value);
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(text);
}

export function searchSourceHost(source: Pick<SearchSource, "title" | "url">) {
  const host = safeHost(source.url);
  // Gemini grounding often returns URLs like
  // vertexaisearch.cloud.google.com/grounding-api-redirect/... while the title
  // contains the real cited domain. Show the real domain in the UI and use it
  // for redirect-source de-duping.
  if (host.includes("vertexaisearch.cloud.google.com") && looksLikeDomain(source.title)) {
    return normalizeDomainText(source.title);
  }
  return host || normalizeDomainText(source.title) || "网页";
}

export function sourceOrganization(host: string) {
  if (host.includes("bea.gov")) return "美国经济分析局";
  if (host.includes("bls.gov")) return "美国劳工统计局";
  if (host.includes("federalreserve.gov")) return "美联储";
  return host;
}

function sourceKey(source: SearchSource) {
  const host = searchSourceHost(source);
  const url = (source.url || "").trim();
  const title = normalizeDomainText(source.title);
  if (safeHost(url).includes("vertexaisearch.cloud.google.com") && host && host !== "网页") {
    return `redirect:${host}`;
  }
  return url ? `url:${url}` : `title:${title}`;
}

export function normalizeSearchSources(sources?: SearchSource[] | null) {
  const normalized: SearchSource[] = [];
  const seen = new Set<string>();
  for (const source of sources || []) {
    if (!source) continue;
    const key = sourceKey(source);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(source);
  }
  return normalized;
}

export type SearchSourceGroup = {
  host: string;
  organization: string;
  sources: SearchSource[];
};

export function groupSearchSourcesByHost(sources?: SearchSource[] | null) {
  const groups = new Map<string, SearchSourceGroup>();
  for (const source of normalizeSearchSources(sources)) {
    const host = searchSourceHost(source);
    const organization = sourceOrganization(host);
    const existing = groups.get(host);
    if (existing) {
      existing.sources.push(source);
    } else {
      groups.set(host, { host, organization, sources: [source] });
    }
  }
  return Array.from(groups.values());
}
