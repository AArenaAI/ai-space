#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

function usage() {
  console.error("Usage: node scripts/regression/chat-render-profile-summary.cjs <profile.json> [--json]");
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarizeNumbers(values) {
  const numeric = values.filter((value) => Number.isFinite(value));
  if (!numeric.length) {
    return { count: 0, min: 0, p50: 0, p95: 0, max: 0, total: 0, avg: 0 };
  }
  const total = numeric.reduce((sum, value) => sum + value, 0);
  return {
    count: numeric.length,
    min: round(Math.min(...numeric)),
    p50: round(percentile(numeric, 50)),
    p95: round(percentile(numeric, 95)),
    max: round(Math.max(...numeric)),
    total: round(total),
    avg: round(total / numeric.length),
  };
}

function histogramBy(items, keyFn) {
  const result = {};
  for (const item of items) {
    const key = keyFn(item);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function topBy(items, valueFn, limit = 8) {
  return [...items]
    .sort((a, b) => (valueFn(b) || 0) - (valueFn(a) || 0))
    .slice(0, limit);
}

function readProfile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  const profile = data.profile || data;
  const renderEvents = profile.renderEvents || profile.events || data.renderEvents || [];
  const longTasks = profile.longTasks || data.longTasks || [];
  return { data, profile, renderEvents, longTasks };
}

function summarizeProfile(filePath) {
  const { data, profile, renderEvents, longTasks } = readProfile(filePath);
  const byPhase = histogramBy(renderEvents, (event) => event.phase || "unknown");
  const durationEvents = renderEvents.filter((event) => Number.isFinite(event.durationMs));
  const liteEvents = renderEvents.filter((event) => event.phase === "markdown-lite-rendered");
  const hydrateEvents = renderEvents.filter((event) => String(event.phase || "").startsWith("markdown-hydrate"));
  const rowCommits = renderEvents.filter((event) => event.phase === "message-row-commit");
  const listCommits = renderEvents.filter((event) => event.phase === "message-list-commit");
  const routeEvents = renderEvents.filter((event) => String(event.phase || "").startsWith("route-"));

  const liteCacheHits = liteEvents.filter((event) => event.cacheHit === true).length;
  const litePreviewEvents = liteEvents.filter((event) => event.isPreview === true).length;
  const liteParseMs = summarizeNumbers(liteEvents.map((event) => Number(event.parseMs || 0)));
  const liteContentLengths = summarizeNumbers(liteEvents.map((event) => Number(event.contentLength || 0)));
  const hydrateByPhase = histogramBy(hydrateEvents, (event) => event.phase || "unknown");
  const longTaskDurations = summarizeNumbers(longTasks.map((task) => Number(task.duration || task.durationMs || 0)));

  const longTaskTop = topBy(longTasks, (task) => Number(task.duration || task.durationMs || 0), 8).map((task) => ({
    startTime: round(Number(task.startTime || task.at || 0)),
    duration: round(Number(task.duration || task.durationMs || 0)),
    name: task.name || null,
  }));

  const slowRenderEvents = topBy(durationEvents, (event) => Number(event.durationMs || 0), 12).map((event) => ({
    phase: event.phase,
    at: round(Number(event.at || 0)),
    durationMs: round(Number(event.durationMs || 0)),
    conversationId: event.conversationId,
    messageId: event.messageId,
    contentLength: event.contentLength,
    visibleMessageCount: event.visibleMessageCount,
    messageCount: event.messageCount,
  }));

  const liteTopParse = topBy(liteEvents, (event) => Number(event.parseMs || 0), 8).map((event) => ({
    at: round(Number(event.at || 0)),
    parseMs: round(Number(event.parseMs || 0)),
    cacheHit: Boolean(event.cacheHit),
    isPreview: Boolean(event.isPreview),
    blockCount: event.blockCount,
    contentLength: event.contentLength,
    codeBlocks: event.codeBlocks,
    tableLines: event.tableLines,
  }));

  const rows = profile.rows || [];
  const visibleRows = rows.filter((row) => row.inViewport).length;
  const fallbackRows = rows.filter((row) => Number(row.markdownFallback || 0) > 0).length;

  return {
    ok: data.ok !== false,
    source: path.resolve(filePath),
    conversationId: data.conversationId || profile.conversationId || null,
    scroller: profile.scroller || null,
    rows: {
      total: rows.length,
      visible: visibleRows,
      fallback: fallbackRows,
    },
    renderEvents: {
      total: renderEvents.length,
      byPhase,
      durationMs: summarizeNumbers(durationEvents.map((event) => Number(event.durationMs || 0))),
      slowest: slowRenderEvents,
    },
    markdownLite: {
      total: liteEvents.length,
      cacheHits: liteCacheHits,
      cacheMisses: liteEvents.length - liteCacheHits,
      cacheHitRate: liteEvents.length ? round(liteCacheHits / liteEvents.length, 4) : 0,
      previewEvents: litePreviewEvents,
      parseMs: liteParseMs,
      contentLength: liteContentLengths,
      topParse: liteTopParse,
    },
    markdownHydrate: {
      total: hydrateEvents.length,
      byPhase: hydrateByPhase,
      delayedHeavy: hydrateEvents.filter((event) => event.phase === "markdown-hydrate-delayed-heavy").length,
      waitingForViewport: hydrateEvents.filter((event) => event.phase === "markdown-hydrate-waiting-for-viewport").length,
    },
    commits: {
      row: summarizeNumbers(rowCommits.map((event) => Number(event.durationMs || 0))),
      list: summarizeNumbers(listCommits.map((event) => Number(event.durationMs || 0))),
    },
    route: {
      total: routeEvents.length,
      byPhase: histogramBy(routeEvents, (event) => event.phase || "unknown"),
    },
    longTasks: {
      total: longTasks.length,
      durationMs: longTaskDurations,
      top: longTaskTop,
    },
    issues: data.issues || profile.issues || [],
  };
}

function printText(summary) {
  console.log(`chat render profile summary: ${summary.source}`);
  console.log(`- ok=${summary.ok} conversationId=${summary.conversationId ?? "n/a"}`);
  if (summary.scroller) {
    console.log(`- scroller distanceToBottom=${summary.scroller.distanceToBottom} scrollTop=${summary.scroller.scrollTop} clientHeight=${summary.scroller.clientHeight} scrollHeight=${summary.scroller.scrollHeight}`);
  }
  console.log(`- rows total=${summary.rows.total} visible=${summary.rows.visible} fallback=${summary.rows.fallback}`);
  console.log(`- longTasks total=${summary.longTasks.total} totalMs=${summary.longTasks.durationMs.total} maxMs=${summary.longTasks.durationMs.max} p95Ms=${summary.longTasks.durationMs.p95}`);
  console.log(`- markdownLite total=${summary.markdownLite.total} cacheHitRate=${summary.markdownLite.cacheHitRate} parseTotalMs=${summary.markdownLite.parseMs.total} parseMaxMs=${summary.markdownLite.parseMs.max} previews=${summary.markdownLite.previewEvents}`);
  console.log(`- markdownHydrate total=${summary.markdownHydrate.total} delayedHeavy=${summary.markdownHydrate.delayedHeavy} waitingForViewport=${summary.markdownHydrate.waitingForViewport}`);
  console.log(`- rowCommit maxMs=${summary.commits.row.max} p95Ms=${summary.commits.row.p95} totalMs=${summary.commits.row.total}`);
  console.log(`- listCommit maxMs=${summary.commits.list.max} p95Ms=${summary.commits.list.p95} totalMs=${summary.commits.list.total}`);
  console.log(`- render phases=${JSON.stringify(summary.renderEvents.byPhase)}`);
  if (summary.longTasks.top.length) console.log(`- topLongTasks=${JSON.stringify(summary.longTasks.top)}`);
  if (summary.renderEvents.slowest.length) console.log(`- slowRenderEvents=${JSON.stringify(summary.renderEvents.slowest)}`);
  if (summary.markdownLite.topParse.length) console.log(`- liteTopParse=${JSON.stringify(summary.markdownLite.topParse)}`);
  if (summary.issues.length) console.log(`- issues=${JSON.stringify(summary.issues)}`);
}

const args = process.argv.slice(2);
const json = args.includes("--json");
const filePath = args.find((arg) => arg !== "--json");
if (!filePath) {
  usage();
  process.exit(2);
}

try {
  const summary = summarizeProfile(filePath);
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printText(summary);
  }
} catch (error) {
  console.error(error.stack || error.message || error);
  process.exit(1);
}
