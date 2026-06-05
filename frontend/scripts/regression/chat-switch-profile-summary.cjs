#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
const { chromium } = require("playwright");

const apiBaseUrl = process.env.REAL_API_BASE_URL || "http://127.0.0.1:9091";
const frontendBaseUrl = process.env.FRONTEND_BASE_URL || "http://127.0.0.1:3012";
const proxyPort = Number(process.env.AI_SPACE_E2E_PROXY_PORT || 3411);
const sequence = (process.env.AI_SPACE_E2E_CONVERSATION_SEQUENCE || "62,12,116,608,264,607,606,213,62,606,213")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const runs = Math.max(1, Number(process.env.AI_SPACE_E2E_PROFILE_RUNS || 3));
const outPath = process.env.AI_SPACE_E2E_REPORT || "/tmp/ai-space-chat-switch-profile-summary.json";
const email = process.env.AI_SPACE_E2E_EMAIL;
const password = process.env.AI_SPACE_E2E_PASSWORD;

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values, p) {
  const numeric = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!numeric.length) return 0;
  const index = Math.min(numeric.length - 1, Math.max(0, Math.round(((numeric.length - 1) * p) / 100)));
  return numeric[index];
}

function stats(values) {
  const numeric = values.filter((value) => Number.isFinite(value));
  if (!numeric.length) return { count: 0, p50: 0, p90: 0, max: 0, avg: 0, total: 0 };
  const total = numeric.reduce((sum, value) => sum + value, 0);
  return {
    count: numeric.length,
    p50: round(percentile(numeric, 50)),
    p90: round(percentile(numeric, 90)),
    max: round(Math.max(...numeric)),
    avg: round(total / numeric.length),
    total: round(total),
  };
}

function histogram(items, keyFn) {
  const result = {};
  for (const item of items) {
    const key = keyFn(item) || "unknown";
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function topEntriesByCount(events, phase, limit = 10) {
  const counts = new Map();
  for (const event of events) {
    if (event.phase !== phase) continue;
    if (!event.messageId) continue;
    const key = String(event.messageId || "unknown");
    const current = counts.get(key) || { messageId: key, count: 0, contentLength: event.contentLength || 0, cacheHits: 0, parseMsTotal: 0 };
    current.count += 1;
    current.contentLength = Math.max(current.contentLength || 0, Number(event.contentLength || 0));
    if (event.cacheHit === true) current.cacheHits += 1;
    current.parseMsTotal += Number(event.parseMs || 0);
    counts.set(key, current);
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || b.contentLength - a.contentLength)
    .slice(0, limit)
    .map((entry) => ({ ...entry, parseMsTotal: round(entry.parseMsTotal, 2) }));
}

function topChangedKeys(events, limit = 16) {
  const counts = new Map();
  for (const event of events) {
    if (event.phase !== "message-row-commit") continue;
    const keys = Array.isArray(event.changedKeys) && event.changedKeys.length > 0 ? event.changedKeys : ["unknown"];
    for (const key of keys) {
      const value = String(key || "unknown");
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function contentBucket(event) {
  if (event.role === "user") return "user";
  const length = Number(event.contentLength || 0);
  const codeFenceCount = Number(event.codeFenceCount || 0);
  const tableLineCount = Number(event.tableLineCount || 0);
  if (event.skipViewportObservers) return "assistant-simple-skip-observer";
  if (codeFenceCount >= 10 || tableLineCount >= 20 || length >= 5000) return "assistant-heavy";
  if (length >= 500) return "assistant-medium";
  return "assistant-short";
}

function lifecycleBucket(event) {
  if (event.isLatestAssistant) return "latest";
  if (event.isInitialReadingAssistant) return "initial-reading";
  if (event.isInViewport) return "in-viewport";
  if (event.isNearViewport) return "near-viewport";
  return "offscreen";
}

function topRowCommitBuckets(events, filterFn, limit = 16) {
  const buckets = new Map();
  for (const event of events) {
    if (event.phase !== "message-row-commit") continue;
    if (filterFn && !filterFn(event)) continue;
    const groupKind = Number(event.groupSize || 0) > 1 ? "multi" : "single";
    const activeState = event.groupActiveState || (groupKind === "multi" ? (event.isActiveGroupMessage === false ? "inactive" : "active") : "na");
    const key = `${contentBucket(event)}|${lifecycleBucket(event)}|group:${groupKind}|active:${activeState}`;
    const current = buckets.get(key) || {
      bucket: key,
      count: 0,
      durationMsTotal: 0,
      contentLengthMax: 0,
      examples: [],
    };
    current.count += 1;
    current.durationMsTotal += Number(event.durationMs || 0);
    current.contentLengthMax = Math.max(current.contentLengthMax, Number(event.contentLength || 0));
    if (current.examples.length < 5 && event.messageId) current.examples.push(String(event.messageId));
    buckets.set(key, current);
  }
  return Array.from(buckets.values())
    .sort((a, b) => b.count - a.count || b.durationMsTotal - a.durationMsTotal)
    .slice(0, limit)
    .map((entry) => ({
      ...entry,
      durationMsTotal: round(entry.durationMsTotal, 1),
      durationMsAvg: round(entry.durationMsTotal / Math.max(1, entry.count), 2),
      examples: [...new Set(entry.examples)],
    }));
}

function topAssistantMetaBuckets(events, limit = 8) {
  const buckets = new Map();
  for (const event of events) {
    if (event.phase !== "assistant-message-meta-commit") continue;
    const key = `realtime:${event.realtimeSubscriptionEnabled === false ? "disabled" : "enabled"}|streaming:${event.isStreaming ? "yes" : "no"}|statuses:${event.statusCount || 0}|timeline:${event.hasTimeline ? "yes" : "no"}`;
    const current = buckets.get(key) || {
      bucket: key,
      count: 0,
      durationMsTotal: 0,
      contentLengthMax: 0,
      examples: [],
    };
    current.count += 1;
    current.durationMsTotal += Number(event.durationMs || 0);
    current.contentLengthMax = Math.max(current.contentLengthMax, Number(event.contentLength || 0));
    if (current.examples.length < 5 && event.messageId) current.examples.push(String(event.messageId));
    buckets.set(key, current);
  }
  return Array.from(buckets.values())
    .sort((a, b) => b.count - a.count || b.durationMsTotal - a.durationMsTotal)
    .slice(0, limit)
    .map((entry) => ({
      ...entry,
      durationMsTotal: round(entry.durationMsTotal, 1),
      durationMsAvg: round(entry.durationMsTotal / Math.max(1, entry.count), 2),
      examples: [...new Set(entry.examples)],
    }));
}

function topUserContentBuckets(events, limit = 8) {
  const buckets = new Map();
  for (const event of events) {
    if (event.phase !== "user-message-content-commit") continue;
    const fileKind = Number(event.imageFileCount || 0) > 0
      ? "image"
      : Number(event.otherFileCount || 0) > 0
        ? "file"
        : "text";
    const length = Number(event.contentLength || 0);
    const lengthKind = length >= 2000 ? "long" : length >= 500 ? "medium" : "short";
    const key = `${lengthKind}|${fileKind}|quote:${event.hasQuote ? "yes" : "no"}|collapsed:${event.isLong ? "yes" : "no"}`;
    const current = buckets.get(key) || {
      bucket: key,
      count: 0,
      durationMsTotal: 0,
      contentLengthMax: 0,
      examples: [],
    };
    current.count += 1;
    current.durationMsTotal += Number(event.durationMs || 0);
    current.contentLengthMax = Math.max(current.contentLengthMax, length);
    if (current.examples.length < 5 && event.messageId) current.examples.push(String(event.messageId));
    buckets.set(key, current);
  }
  return Array.from(buckets.values())
    .sort((a, b) => b.count - a.count || b.durationMsTotal - a.durationMsTotal)
    .slice(0, limit)
    .map((entry) => ({
      ...entry,
      durationMsTotal: round(entry.durationMsTotal, 1),
      durationMsAvg: round(entry.durationMsTotal / Math.max(1, entry.count), 2),
      examples: [...new Set(entry.examples)],
    }));
}

function topMessageActionsBuckets(events, limit = 8) {
  const buckets = new Map();
  for (const event of events) {
    if (event.phase !== "message-actions-commit") continue;
    const key = `align:${event.align || "unknown"}|visible:${event.visible ? "yes" : "no"}|regen:${event.showRegenerate ? "yes" : "no"}|favorite:${event.hasFavoriteAction ? "yes" : "no"}`;
    const current = buckets.get(key) || {
      bucket: key,
      count: 0,
      durationMsTotal: 0,
    };
    current.count += 1;
    current.durationMsTotal += Number(event.durationMs || 0);
    buckets.set(key, current);
  }
  return Array.from(buckets.values())
    .sort((a, b) => b.count - a.count || b.durationMsTotal - a.durationMsTotal)
    .slice(0, limit)
    .map((entry) => ({
      ...entry,
      durationMsTotal: round(entry.durationMsTotal, 1),
      durationMsAvg: round(entry.durationMsTotal / Math.max(1, entry.count), 2),
    }));
}

function topMessageListBuckets(events, limit = 8) {
  const buckets = new Map();
  for (const event of events) {
    if (event.phase !== "message-list-commit") continue;
    const visible = Number(event.visibleMessageCount || 0);
    const hidden = Number(event.hiddenLocalMessageCount || 0);
    const effectiveWindow = Number(event.effectiveRenderedMessageWindow || 0);
    const initialWindow = Number(event.initialMessageWindow || 0);
    const key = `heavy:${event.isContentHeavyConversation ? "yes" : "no"}|visible:${visible}|hidden:${hidden}|window:${effectiveWindow}|initial:${initialWindow}`;
    const current = buckets.get(key) || {
      bucket: key,
      count: 0,
      durationMsTotal: 0,
      messageCountMax: 0,
      totalCharsMax: 0,
    };
    current.count += 1;
    current.durationMsTotal += Number(event.durationMs || 0);
    current.messageCountMax = Math.max(current.messageCountMax, Number(event.messageCount || 0));
    current.totalCharsMax = Math.max(current.totalCharsMax, Number(event.contentWeight?.totalChars || 0));
    buckets.set(key, current);
  }
  return Array.from(buckets.values())
    .sort((a, b) => b.count - a.count || b.durationMsTotal - a.durationMsTotal)
    .slice(0, limit)
    .map((entry) => ({
      ...entry,
      durationMsTotal: round(entry.durationMsTotal, 1),
      durationMsAvg: round(entry.durationMsTotal / Math.max(1, entry.count), 2),
    }));
}

function topMarkdownLiteBuckets(events, limit = 10) {
  const buckets = new Map();
  for (const event of events) {
    if (event.phase !== "markdown-lite-rendered") continue;
    const contentLength = Number(event.contentLength || 0);
    const blockCount = Number(event.blockCount || 0);
    const blockSummary = event.blockSummary || {};
    const lengthBucket = contentLength > 10000
      ? ">10k"
      : contentLength > 3000
        ? "3k-10k"
        : contentLength > 1000
          ? "1k-3k"
          : contentLength > 500
            ? "500-1k"
            : "<=500";
    const blockBucket = blockCount > 32
      ? ">32"
      : blockCount > 16
        ? "17-32"
        : blockCount > 8
          ? "9-16"
          : "<=8";
    const key = `compact:${event.compactPreview ? "yes" : "no"}|cache:${event.cacheHit ? "hit" : "miss"}|preview:${event.isPreview ? "yes" : "no"}|len:${lengthBucket}|blocks:${blockBucket}|code:${Number(event.codeBlocks || 0) > 0 ? "yes" : "no"}|table:${Number(event.tableLines || 0) > 0 ? "yes" : "no"}|types:p${Number(blockSummary.paragraph || 0)}-l${Number(blockSummary.list || 0)}-c${Number(blockSummary.code || 0)}-t${Number(blockSummary.table || 0)}`;
    const current = buckets.get(key) || {
      bucket: key,
      count: 0,
      parseMsTotal: 0,
      contentLengthMax: 0,
      blockCountMax: 0,
      examples: [],
    };
    current.count += 1;
    current.parseMsTotal += Number(event.parseMs || 0);
    current.contentLengthMax = Math.max(current.contentLengthMax, contentLength);
    current.blockCountMax = Math.max(current.blockCountMax, blockCount);
    if (event.messageId && current.examples.length < 3) current.examples.push(String(event.messageId));
    buckets.set(key, current);
  }
  return Array.from(buckets.values())
    .sort((a, b) => b.count - a.count || b.parseMsTotal - a.parseMsTotal)
    .slice(0, limit)
    .map((entry) => ({
      ...entry,
      parseMsTotal: round(entry.parseMsTotal, 1),
      parseMsAvg: round(entry.parseMsTotal / Math.max(1, entry.count), 2),
      examples: [...new Set(entry.examples)],
    }));
}

function topCodeBlockBuckets(events, limit = 8) {
  const buckets = new Map();
  for (const event of events) {
    if (event.phase !== "markdown-code-block-commit") continue;
    const charCount = Number(event.charCount || 0);
    const lineCount = Number(event.lineCount || 0);
    const charBucket = charCount > 4000
      ? ">4k"
      : charCount > 1200
        ? "1.2k-4k"
        : charCount > 500
          ? "500-1.2k"
          : "<=500";
    const lineBucket = lineCount > 120
      ? ">120"
      : lineCount > 40
        ? "41-120"
        : lineCount > 10
          ? "11-40"
          : "<=10";
    const key = `light:${event.lightweight ? "yes" : "no"}|long:${event.isLongCode ? "yes" : "no"}|expanded:${event.expanded ? "yes" : "no"}|chars:${charBucket}|lines:${lineBucket}|lang:${event.language || "text"}`;
    const current = buckets.get(key) || {
      bucket: key,
      count: 0,
      durationMsTotal: 0,
      charCountMax: 0,
      lineCountMax: 0,
    };
    current.count += 1;
    current.durationMsTotal += Number(event.durationMs || 0);
    current.charCountMax = Math.max(current.charCountMax, charCount);
    current.lineCountMax = Math.max(current.lineCountMax, lineCount);
    buckets.set(key, current);
  }
  return Array.from(buckets.values())
    .sort((a, b) => b.count - a.count || b.durationMsTotal - a.durationMsTotal)
    .slice(0, limit)
    .map((entry) => ({
      ...entry,
      durationMsTotal: round(entry.durationMsTotal, 1),
      durationMsAvg: round(entry.durationMsTotal / Math.max(1, entry.count), 2),
    }));
}

function createProxy() {
  const server = http.createServer((req, res) => {
    const targetBase = req.url.startsWith("/api/") || req.url === "/health" ? apiBaseUrl : frontendBaseUrl;
    const target = new URL(req.url, targetBase);
    const headers = { ...req.headers, host: target.host };
    const transport = target.protocol === "https:" ? require("node:https") : require("node:http");
    const proxyRequest = transport.request(target, { method: req.method, headers }, (proxyResponse) => {
      res.writeHead(proxyResponse.statusCode || 502, proxyResponse.headers);
      proxyResponse.pipe(res);
    });
    proxyRequest.on("error", (error) => {
      res.writeHead(502);
      res.end(String(error));
    });
    req.pipe(proxyRequest);
  });
  return new Promise((resolve) => server.listen(proxyPort, "127.0.0.1", () => resolve(server)));
}

async function login() {
  if (!email || !password) throw new Error("AI_SPACE_E2E_EMAIL and AI_SPACE_E2E_PASSWORD are required");
  const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`login ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return { token: data.token || data.access_token || data.accessToken, user: data.user || data.data?.user || { email } };
}

async function clickConversationAndMeasure(page, cid) {
  return page.evaluate(async (targetCid) => {
    const row = document.querySelector(`[data-conversation-id="${targetCid}"]`);
    if (!row) return { clicked: false, startedAt: performance.now(), timeline: {} };

    row.scrollIntoView({ block: "center" });
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const startedAt = performance.now();
    const beforeRows = document.querySelectorAll('[data-chat-message-row="true"]').length;
    const timeline = {};

    row.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    let lastRows = beforeRows;
    let lastDistanceToBottom = null;
    for (let frame = 0; frame < 90; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const now = performance.now();
      const rows = Array.from(document.querySelectorAll('[data-chat-message-row="true"]'));
      const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
      const distanceToBottom = scroller
        ? Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight)
        : null;
      const hrefMatches = location.search.includes(`id=${targetCid}`);
      if (hrefMatches && timeline.urlMs == null) timeline.urlMs = Math.round(now - startedAt);
      if (hrefMatches && rows.length > 0 && rows.length !== beforeRows && timeline.rowsChangedMs == null) timeline.rowsChangedMs = Math.round(now - startedAt);
      if (hrefMatches && rows.some((candidate) => candidate.getAttribute("data-message-id")) && timeline.firstRowsMs == null) timeline.firstRowsMs = Math.round(now - startedAt);
      if (hrefMatches && distanceToBottom === 0 && rows.length > 0 && timeline.bottom0Ms == null) timeline.bottom0Ms = Math.round(now - startedAt);
      lastRows = rows.length;
      lastDistanceToBottom = distanceToBottom;
      if (timeline.urlMs != null && timeline.firstRowsMs != null && timeline.bottom0Ms != null && now - startedAt > 260) break;
    }

    return {
      clicked: true,
      startedAt,
      timeline: {
        ...timeline,
        beforeRows,
        lastRows,
        lastDistanceToBottom,
      },
    };
  }, cid);
}

function relativeMs(value, startedAt) {
  if (!Number.isFinite(value)) return undefined;
  return Math.round(value - startedAt);
}

async function sample(page, cid, startedAt, switchTimeline = {}) {
  await page.waitForFunction((expectedCid) => {
    const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
    const rows = document.querySelectorAll('[data-chat-message-row="true"]');
    return !!scroller && rows.length > 0 && location.search.includes(`id=${expectedCid}`);
  }, cid, { timeout: 30_000 });
  await page.waitForTimeout(350);
  return page.evaluate(({ cid, startedAt, switchTimeline }) => {
    const relativeMs = (value) => {
      if (!Number.isFinite(value)) return undefined;
      return Math.round(value - startedAt);
    };
    const now = performance.now();
    const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
    const rows = Array.from(document.querySelectorAll('[data-chat-message-row="true"]')).map((row) => {
      const rect = row.getBoundingClientRect();
      return {
        id: row.getAttribute("data-message-id"),
        role: row.getAttribute("data-message-role"),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        height: Math.round(rect.height),
        text: (row.textContent || "").length,
      };
    });
    const events = (window.__chatRenderProfileEvents || []).filter((event) => event.at >= startedAt - 20);
    const longTasks = (window.__longTasks || []).filter((task) => task.startTime >= startedAt - 20);
    const fetches = (window.__fetchProfileEvents || []).filter((event) => event.at >= startedAt - 20 || event.end >= startedAt - 20);
    const timeline = { ...switchTimeline };
    const bottom0Deadline = Number.isFinite(timeline.bottom0Ms) ? startedAt + timeline.bottom0Ms : undefined;
    const firstFetch = fetches[0];
    const conversationFetch = fetches.find((fetchEvent) => String(fetchEvent.url || "").includes(`/api/conversations/${cid}`));
    const longTasksBeforeBottom0 = bottom0Deadline ? longTasks.filter((task) => task.startTime <= bottom0Deadline) : [];
    const eventsBeforeBottom0 = bottom0Deadline ? events.filter((event) => event.at <= bottom0Deadline) : [];
    timeline.firstFetchStartMs = firstFetch ? relativeMs(firstFetch.at, startedAt) : undefined;
    timeline.firstFetchDoneMs = firstFetch ? relativeMs(firstFetch.end || now, startedAt) : undefined;
    timeline.conversationFetchStartMs = conversationFetch ? relativeMs(conversationFetch.at, startedAt) : undefined;
    timeline.conversationFetchDoneMs = conversationFetch ? relativeMs(conversationFetch.end || now, startedAt) : undefined;
    timeline.longTaskBeforeBottom0Count = longTasksBeforeBottom0.length;
    timeline.longTaskBeforeBottom0Total = Math.round(longTasksBeforeBottom0.reduce((sum, task) => sum + (task.duration || 0), 0));
    timeline.longTaskBeforeBottom0Max = Math.round(Math.max(0, ...longTasksBeforeBottom0.map((task) => task.duration || 0)));
    timeline.rowCommitBeforeBottom0 = eventsBeforeBottom0.filter((event) => event.phase === "message-row-commit").length;
    timeline.listCommitBeforeBottom0 = eventsBeforeBottom0.filter((event) => event.phase === "message-list-commit").length;
    timeline.liteBeforeBottom0 = eventsBeforeBottom0.filter((event) => event.phase === "markdown-lite-rendered").length;
    timeline.tokenBeforeBottom0 = eventsBeforeBottom0.filter((event) => event.phase === "markdown-token-rendered").length;
    return {
      cid,
      elapsedMs: Math.round(now - startedAt),
      switchTimeline: timeline,
      href: location.href,
      scroller: scroller ? {
        scrollTop: Math.round(scroller.scrollTop),
        scrollHeight: Math.round(scroller.scrollHeight),
        clientHeight: scroller.clientHeight,
        distanceToBottom: Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight),
      } : null,
      rowCount: rows.length,
      visibleIds: rows.filter((row) => row.bottom > 0 && row.top < window.innerHeight).map((row) => row.id),
      eventCounts: events.reduce((acc, event) => {
        acc[event.phase] = (acc[event.phase] || 0) + 1;
        return acc;
      }, {}),
      recentEvents: events.slice(-50),
      longMax: Math.round(Math.max(0, ...longTasks.map((task) => task.duration || 0))),
      longTotal: Math.round(longTasks.reduce((sum, task) => sum + (task.duration || 0), 0)),
      longTasks: longTasks.map((task) => ({ startTime: Math.round(task.startTime), duration: Math.round(task.duration) })),
      fetches: fetches.map((fetchEvent) => ({
        url: String(fetchEvent.url || "").replace(/^https?:\/\/[^/]+/, ""),
        at: Math.round(fetchEvent.at),
        end: Math.round(fetchEvent.end || 0),
        dur: Math.round((fetchEvent.end || now) - fetchEvent.at),
        ok: fetchEvent.ok,
        status: fetchEvent.status,
      })).slice(-20),
    };
  }, { cid, startedAt, switchTimeline });
}

function summarize(allResults) {
  const values = (key) => allResults.map((result) => Number(result[key] || 0));
  const timelineValues = (key) => allResults.map((result) => Number(result.switchTimeline?.[key]));
  const allRecentEvents = allResults.flatMap((result) => result.recentEvents || []);
  const byCid = {};
  for (const cid of [...new Set(allResults.map((result) => result.cid))].sort((a, b) => Number(a) - Number(b))) {
    const group = allResults.filter((result) => result.cid === cid);
    byCid[cid] = {
      samples: group.length,
      wallMs: stats(group.map((result) => result.wallMs)),
      longMax: stats(group.map((result) => result.longMax)),
      distanceToBottomNonZero: group.filter((result) => Number(result.scroller?.distanceToBottom || 0) !== 0).length,
      switchTimeline: {
        urlMs: stats(group.map((result) => Number(result.switchTimeline?.urlMs))),
        firstRowsMs: stats(group.map((result) => Number(result.switchTimeline?.firstRowsMs))),
        rowsChangedMs: stats(group.map((result) => Number(result.switchTimeline?.rowsChangedMs))),
        bottom0Ms: stats(group.map((result) => Number(result.switchTimeline?.bottom0Ms))),
        conversationFetchDoneMs: stats(group.map((result) => Number(result.switchTimeline?.conversationFetchDoneMs))),
        longTaskBeforeBottom0Total: stats(group.map((result) => Number(result.switchTimeline?.longTaskBeforeBottom0Total))),
        rowCommitBeforeBottom0: stats(group.map((result) => Number(result.switchTimeline?.rowCommitBeforeBottom0))),
        liteBeforeBottom0: stats(group.map((result) => Number(result.switchTimeline?.liteBeforeBottom0))),
      },
    };
  }
  return {
    ok: allResults.every((result) => Number(result.scroller?.distanceToBottom || 0) === 0),
    runs,
    sequence,
    samples: allResults.length,
    distanceToBottomNonZero: allResults.filter((result) => Number(result.scroller?.distanceToBottom || 0) !== 0).length,
    wallMs: stats(values("wallMs")),
    longMax: stats(values("longMax")),
    longTotal: stats(values("longTotal")),
    switchTimeline: {
      urlMs: stats(timelineValues("urlMs")),
      firstRowsMs: stats(timelineValues("firstRowsMs")),
      rowsChangedMs: stats(timelineValues("rowsChangedMs")),
      bottom0Ms: stats(timelineValues("bottom0Ms")),
      firstFetchStartMs: stats(timelineValues("firstFetchStartMs")),
      firstFetchDoneMs: stats(timelineValues("firstFetchDoneMs")),
      conversationFetchStartMs: stats(timelineValues("conversationFetchStartMs")),
      conversationFetchDoneMs: stats(timelineValues("conversationFetchDoneMs")),
      longTaskBeforeBottom0Count: stats(timelineValues("longTaskBeforeBottom0Count")),
      longTaskBeforeBottom0Total: stats(timelineValues("longTaskBeforeBottom0Total")),
      longTaskBeforeBottom0Max: stats(timelineValues("longTaskBeforeBottom0Max")),
      rowCommitBeforeBottom0: stats(timelineValues("rowCommitBeforeBottom0")),
      listCommitBeforeBottom0: stats(timelineValues("listCommitBeforeBottom0")),
      liteBeforeBottom0: stats(timelineValues("liteBeforeBottom0")),
      tokenBeforeBottom0: stats(timelineValues("tokenBeforeBottom0")),
    },
    chatInterfaceCommitCount: stats(allResults.map((result) => Number(result.eventCounts?.["chat-interface-commit"] || 0))),
    rowCommitCount: stats(allResults.map((result) => Number(result.eventCounts?.["message-row-commit"] || 0))),
    listCommitCount: stats(allResults.map((result) => Number(result.eventCounts?.["message-list-commit"] || 0))),
    markdownLiteCount: stats(allResults.map((result) => Number(result.eventCounts?.["markdown-lite-rendered"] || 0))),
    markdownTokenCount: stats(allResults.map((result) => Number(result.eventCounts?.["markdown-token-rendered"] || 0))),
    markdownDeferredCount: stats(allResults.map((result) => Number(result.eventCounts?.["markdown-token-deferred"] || 0))),
    assistantMetaCommitCount: stats(allResults.map((result) => Number(result.eventCounts?.["assistant-message-meta-commit"] || 0))),
    userContentCommitCount: stats(allResults.map((result) => Number(result.eventCounts?.["user-message-content-commit"] || 0))),
    messageActionsCommitCount: stats(allResults.map((result) => Number(result.eventCounts?.["message-actions-commit"] || 0))),
    codeBlockCommitCount: stats(allResults.map((result) => Number(result.eventCounts?.["markdown-code-block-commit"] || 0))),
    eventPhaseTotals: allResults.reduce((acc, result) => {
      for (const [phase, count] of Object.entries(result.eventCounts || {})) acc[phase] = (acc[phase] || 0) + Number(count || 0);
      return acc;
    }, {}),
    recentEventPhaseTotals: histogram(allRecentEvents, (event) => event.phase),
    unknownLiteCount: allRecentEvents.filter((event) => event.phase === "markdown-lite-rendered" && !event.messageId).length,
    unknownTokenCount: allRecentEvents.filter((event) => event.phase === "markdown-token-rendered" && !event.messageId).length,
    topLiteMessages: topEntriesByCount(allRecentEvents, "markdown-lite-rendered"),
    topMarkdownLiteBuckets: topMarkdownLiteBuckets(allRecentEvents),
    topRowCommitMessages: topEntriesByCount(allRecentEvents, "message-row-commit"),
    topRowChangedKeys: topChangedKeys(allRecentEvents),
    topRowMountBuckets: topRowCommitBuckets(allRecentEvents, (event) => Array.isArray(event.changedKeys) && event.changedKeys.includes("mount")),
    topRowUnknownBuckets: topRowCommitBuckets(allRecentEvents, (event) => !Array.isArray(event.changedKeys) || event.changedKeys.length === 0),
    topMessageListBuckets: topMessageListBuckets(allRecentEvents),
    topAssistantMetaMessages: topEntriesByCount(allRecentEvents, "assistant-message-meta-commit"),
    topAssistantMetaBuckets: topAssistantMetaBuckets(allRecentEvents),
    topUserContentMessages: topEntriesByCount(allRecentEvents, "user-message-content-commit"),
    topUserContentBuckets: topUserContentBuckets(allRecentEvents),
    topMessageActionsBuckets: topMessageActionsBuckets(allRecentEvents),
    topCodeBlockBuckets: topCodeBlockBuckets(allRecentEvents),
    topTokenMessages: topEntriesByCount(allRecentEvents, "markdown-token-rendered"),
    byCid,
  };
}

(async () => {
  const server = await createProxy();
  try {
    const { token, user } = await login();
    const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(({ token, user, port }) => {
      localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify(user || {}));
      window.__chatRenderProfileEvents = [];
      window.__AI_SPACE_CHAT_PROFILE_ENABLED = true;
      window.__AI_SPACE_CHAT_ROW_PROFILE_DETAIL = true;
      window.__longTasks = [];
      window.__fetchProfileEvents = [];
      window.addEventListener("chat-render-profile", (event) => window.__chatRenderProfileEvents.push(event.detail));
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__longTasks.push({ startTime: entry.startTime, duration: entry.duration });
        }).observe({ entryTypes: ["longtask"] });
      } catch {}
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        let url = typeof input === "string" ? input : input?.url || "";
        if (typeof input === "string" && input.startsWith("/api/")) input = `http://127.0.0.1:${port}${input}`;
        const at = performance.now();
        try {
          const response = await originalFetch(input, init);
          window.__fetchProfileEvents.push({ url, at, end: performance.now(), ok: response.ok, status: response.status });
          return response;
        } catch (error) {
          window.__fetchProfileEvents.push({ url, at, end: performance.now(), ok: false, status: 0 });
          throw error;
        }
      };
    }, { token, user, port: proxyPort });

    const allResults = [];
    for (let run = 1; run <= runs; run += 1) {
      await page.goto(`http://127.0.0.1:${proxyPort}/chat/?id=${sequence[0]}`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-conversation-row]", { state: "attached", timeout: 30_000 });
      for (const cid of sequence.slice(1)) {
        const wallStart = Date.now();
        const clickResult = await clickConversationAndMeasure(page, cid);
        if (!clickResult.clicked) throw new Error(`conversation row not found: ${cid}`);
        const result = await sample(page, cid, clickResult.startedAt, clickResult.timeline);
        result.run = run;
        result.wallMs = Date.now() - wallStart;
        allResults.push(result);
        await page.waitForTimeout(250);
      }
    }
    await browser.close();

    const summary = summarize(allResults);
    const payload = { summary, results: allResults };
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    server.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
