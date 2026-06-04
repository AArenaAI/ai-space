#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const { chromium } = require("playwright");

const apiBaseUrl = trimTrailingSlash(process.env.REAL_CHAT_API_BASE_URL || "http://127.0.0.1:9091");
const frontendBaseUrl = trimTrailingSlash(process.env.REAL_CHAT_FRONTEND_BASE_URL || "http://127.0.0.1:3000");
const proxyPort = Number(process.env.AI_SPACE_HISTORY_PROFILE_PROXY_PORT || 3262);
const email = process.env.AI_SPACE_E2E_EMAIL;
const password = process.env.AI_SPACE_E2E_PASSWORD;
const conversationId = Number(process.env.AI_SPACE_E2E_CONVERSATION_ID || 62);
const timeoutMs = Number(process.env.AI_SPACE_HISTORY_PROFILE_TIMEOUT_MS || 90000);
const reportPath = process.env.AI_SPACE_HISTORY_PROFILE_REPORT || `/tmp/ai-space-history-profile-${conversationId}.json`;
const verbose = process.env.AI_SPACE_HISTORY_PROFILE_VERBOSE === "1";
const requirePrepend = process.env.AI_SPACE_HISTORY_PROFILE_REQUIRE_PREPEND !== "0";

if (!email || !password) {
  throw new Error("missing AI_SPACE_E2E_EMAIL / AI_SPACE_E2E_PASSWORD");
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  if (verbose) console.error(`[history-profile] ${message}`);
}

function redact(value) {
  let result = String(value || "");
  if (email) result = result.replace(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "[EMAIL]");
  return result
    .replace(/Bearer\s+[-._~+/=A-Za-z0-9]+/g, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9._-]+/g, "[REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/(api[_-]?key|token|password|secret)(["'=:\s]+)([^"'\s,}]+)/gi, "$1$2[REDACTED]");
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${redact(text.slice(0, 500))}`);
  return JSON.parse(text);
}

async function login() {
  const data = await fetchJson(`${apiBaseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.ok(data.token, "login response missing token");
  return data;
}

function startProxy(requestStats) {
  const server = http.createServer((req, res) => {
    const startedAt = Date.now();
    const targetBase = req.url.startsWith("/api/") || req.url === "/health" ? apiBaseUrl : frontendBaseUrl;
    const isRestore = req.method === "GET" && /^\/api\/conversations\/\d+\?/.test(req.url) && /message_tail=/.test(req.url);
    const isOlderPage = req.method === "GET" && /^\/api\/conversations\/\d+\/messages\?/.test(req.url) && /limit=/.test(req.url) && !/limit=1(?:&|$)/.test(req.url);
    const isMessageCount = req.method === "GET" && /^\/api\/conversations\/\d+\/messages\?/.test(req.url) && /limit=1(?:&|$)/.test(req.url);

    if (isRestore) requestStats.restore += 1;
    if (isOlderPage) requestStats.olderPage += 1;
    if (isMessageCount) requestStats.messageCount += 1;

    const target = new URL(req.url, targetBase);
    const headers = { ...req.headers, host: target.host };
    const proxyReq = http.request(target, { method: req.method, headers }, (proxyRes) => {
      let bytes = 0;
      if (isRestore || isOlderPage || isMessageCount) {
        proxyRes.on("data", (chunk) => {
          bytes += chunk.length || 0;
        });
        proxyRes.on("end", () => {
          const entry = {
            path: redact(req.url),
            status: proxyRes.statusCode || 0,
            durationMs: Date.now() - startedAt,
            bytes,
          };
          if (isRestore) requestStats.restoreRequests.push(entry);
          if (isOlderPage) requestStats.olderPageRequests.push(entry);
          if (isMessageCount) requestStats.messageCountRequests.push(entry);
        });
      }
      requestStats.statusCodes[proxyRes.statusCode || 0] = (requestStats.statusCodes[proxyRes.statusCode || 0] || 0) + 1;
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on("error", (err) => {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`proxy error: ${err.message}`);
    });
    req.pipe(proxyReq);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(proxyPort, "127.0.0.1", () => resolve(server));
  });
}

async function waitForHttpOk(url, timeout = 60000) {
  const deadline = Date.now() + timeout;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err.message;
    }
    await sleep(1000);
  }
  throw new Error(`timeout waiting for ${url}: ${last}`);
}

async function readState(page, label) {
  return page.evaluate((stateLabel) => {
    const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
    const list = document.querySelector('[data-testid="chat-message-list"]');
    const scrollerRect = scroller?.getBoundingClientRect();
    const rows = Array.from(document.querySelectorAll('[data-chat-message-row="true"]')).map((row, index) => {
      const rect = row.getBoundingClientRect();
      const text = row.textContent || "";
      const inScroller = Boolean(scrollerRect && rect.bottom >= scrollerRect.top + 8 && rect.top <= scrollerRect.bottom - 8);
      return {
        index,
        messageId: row.getAttribute("data-message-id"),
        role: row.getAttribute("data-message-role"),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        height: Math.round(rect.height),
        textLength: text.length,
        inScroller,
        plainFallback: row.querySelectorAll('[data-markdown-plain-fallback]').length,
        liteRenderer: row.querySelectorAll('[data-markdown-lite-renderer]').length,
        fullMarkdownSignals: row.querySelectorAll('table, .markdown-body, pre code').length,
        preview: text.slice(0, 100).replace(/\s+/g, " "),
      };
    });
    const firstVisible = rows.find((row) => row.inScroller) || null;
    const lastVisible = rows.slice().reverse().find((row) => row.inScroller) || null;
    return {
      label: stateLabel,
      at: performance.now(),
      location: location.href,
      list: {
        visibleMessageCount: Number(list?.getAttribute("data-visible-message-count") || "0"),
        allVisibleMessageCount: Number(list?.getAttribute("data-all-visible-message-count") || "0"),
        hiddenLocalMessageCount: Number(list?.getAttribute("data-hidden-local-message-count") || "0"),
      },
      scroller: scroller ? {
        scrollTop: Math.round(scroller.scrollTop),
        scrollHeight: Math.round(scroller.scrollHeight),
        clientHeight: Math.round(scroller.clientHeight),
        distanceToBottom: Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight),
        rectTop: Math.round(scrollerRect?.top || 0),
        rectBottom: Math.round(scrollerRect?.bottom || 0),
      } : null,
      rowCount: rows.length,
      visibleRows: rows.filter((row) => row.inScroller).length,
      firstVisible,
      lastVisible,
      rows,
      eventCount: (window.__chatRenderProfileEvents || []).length,
      longTaskCount: (window.__longTasks || []).length,
    };
  }, label);
}

async function readMarker(page, markerId, label) {
  return page.evaluate(({ id, stateLabel }) => {
    const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
    const row = document.querySelector(`[data-chat-message-row="true"][data-message-id="${CSS.escape(id)}"]`);
    const scrollerRect = scroller?.getBoundingClientRect();
    if (!row || !scroller || !scrollerRect) {
      return { label: stateLabel, found: false, markerId: id, scrollTop: scroller?.scrollTop ?? -1 };
    }
    const rect = row.getBoundingClientRect();
    return {
      label: stateLabel,
      found: true,
      markerId: id,
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      height: Math.round(rect.height),
      visibleTop: Math.round(Math.max(rect.top, scrollerRect.top)),
      visibleBottom: Math.round(Math.min(rect.bottom, scrollerRect.bottom)),
      scrollerTop: Math.round(scrollerRect.top),
      scrollerBottom: Math.round(scrollerRect.bottom),
      intersectsScroller: rect.bottom >= scrollerRect.top + 8 && rect.top <= scrollerRect.bottom - 8,
      scrollTop: Math.round(scroller.scrollTop),
      scrollHeight: Math.round(scroller.scrollHeight),
      clientHeight: Math.round(scroller.clientHeight),
      rowCount: document.querySelectorAll('[data-chat-message-row="true"]').length,
    };
  }, { id: markerId, stateLabel: label });
}

async function scrollNearTop(page, baselineWindow) {
  const box = await page.locator('[data-testid="virtuoso-scroller"]').boundingBox();
  assert.ok(box, "missing scroller bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(160, box.height / 2));

  const targetScrollTop = Number(process.env.AI_SPACE_HISTORY_PROFILE_PREPEND_TRIGGER_SCROLL_TOP || 800);
  const samples = [];
  let previous = await readState(page, "scroll-near-top-before-0");
  samples.push(previous);
  for (let i = 0; i < 80; i += 1) {
    if ((previous.scroller?.scrollTop || 0) <= targetScrollTop) return { state: previous, samples, release: null };
    await page.mouse.wheel(0, -900);
    await sleep(70);
    const current = await readState(page, `scroll-near-top-${i}`);
    samples.push(current);
    const released = current.list.visibleMessageCount > baselineWindow.list.visibleMessageCount || current.list.hiddenLocalMessageCount < baselineWindow.list.hiddenLocalMessageCount;
    if (released) return { state: current, samples, release: { before: previous, after: current } };
    previous = current;
  }
  const finalState = await readState(page, "scroll-near-top-final");
  samples.push(finalState);
  return { state: finalState, samples, release: null };
}

async function scrollToBottomAndWait(page) {
  await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
    if (!scroller) throw new Error("missing scroller");
    scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const deadline = Date.now() + 12000;
  let last = null;
  while (Date.now() < deadline) {
    last = await readState(page, "normalizing-bottom");
    if ((last.scroller?.distanceToBottom ?? Number.POSITIVE_INFINITY) <= 4) return last;
    await page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
      if (scroller) {
        scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      }
    });
    await sleep(200);
  }
  return last || readState(page, "normalizing-bottom-final");
}

async function triggerPrepend(page, beforeWindow) {
  const samples = [];
  const box = await page.locator('[data-testid="virtuoso-scroller"]').boundingBox();
  assert.ok(box, "missing scroller bounding box for prepend");
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(140, box.height / 2));

  const deadline = Date.now() + 7000;
  let triggered = false;
  while (Date.now() < deadline) {
    await page.mouse.wheel(0, -900);
    await sleep(80);
    const sample = await readState(page, `prepend-sample-${samples.length}`);
    samples.push(sample);
    if (sample.list.visibleMessageCount > beforeWindow.list.visibleMessageCount || sample.list.hiddenLocalMessageCount < beforeWindow.list.hiddenLocalMessageCount) {
      triggered = true;
      break;
    }
  }

  const settleDeadline = Date.now() + 2500;
  while (Date.now() < settleDeadline) {
    const sample = await readState(page, `settle-sample-${samples.length}`);
    samples.push(sample);
    if (sample.list.visibleMessageCount > beforeWindow.list.visibleMessageCount || sample.list.hiddenLocalMessageCount < beforeWindow.list.hiddenLocalMessageCount) break;
    await sleep(100);
  }
  await sleep(360);
  return { triggered, samples };
}

function summarizeEvents(events, afterAt = 0) {
  const filtered = events.filter((event) => typeof event.at !== "number" || event.at >= afterAt);
  const phases = filtered.reduce((acc, event) => {
    acc[event.phase] = (acc[event.phase] || 0) + 1;
    return acc;
  }, {});
  const markdown = filtered.filter((event) => String(event.phase || "").startsWith("markdown"));
  const row = filtered.filter((event) => String(event.phase || "").startsWith("message-row"));
  return {
    total: filtered.length,
    phases,
    markdownCount: markdown.length,
    rowEventCount: row.length,
    markdownSamples: markdown.slice(0, 20),
    rowSamples: row.slice(0, 20),
  };
}

async function main() {
  const auth = await login();
  const requestStats = { restore: 0, olderPage: 0, messageCount: 0, statusCodes: {}, restoreRequests: [], olderPageRequests: [], messageCountRequests: [] };
  const proxy = await startProxy(requestStats);
  const proxyBase = `http://127.0.0.1:${proxyPort}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const issues = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") issues.push(`console.error: ${redact(msg.text()).slice(0, 400)}`);
  });
  page.on("pageerror", (err) => issues.push(`pageerror: ${redact(err.message).slice(0, 400)}`));

  try {
    await waitForHttpOk(`${proxyBase}/chat/`, 60000);
    await page.addInitScript(({ tokenValue, userValue }) => {
      localStorage.setItem("token", tokenValue);
      localStorage.setItem("user", JSON.stringify(userValue || {}));
      localStorage.setItem("theme", "green");
      window.__chatRenderProfileEvents = [];
      window.__longTasks = [];
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__longTasks.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name });
          }
        }).observe({ entryTypes: ["longtask"] });
      } catch {}
      window.addEventListener("chat-render-profile", (event) => window.__chatRenderProfileEvents.push(event.detail));
    }, { tokenValue: auth.token, userValue: auth.user || {} });

    await page.goto(`${proxyBase}/chat/?id=${conversationId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('[data-testid="virtuoso-scroller"]', { timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-chat-message-row="true"]').length > 0, null, { timeout: 30000 });
    await page.waitForTimeout(5000);

    const naturalInitial = await readState(page, "natural-initial-after-load");
    assert.ok(naturalInitial.scroller, "initial scroller missing");
    const initial = await scrollToBottomAndWait(page);
    assert.ok(initial?.scroller, "normalized initial scroller missing");
    const initialDistanceToBottom = initial.scroller.distanceToBottom;

    const scrollResult = await scrollNearTop(page, initial);
    const nearTop = scrollResult.state;
    const beforePrepend = scrollResult.release?.before || await readState(page, "before-prepend");
    const anchorId = beforePrepend.firstVisible?.messageId;
    assert.ok(anchorId, `missing first visible anchor before prepend: ${JSON.stringify(beforePrepend.scroller)}`);
    const anchorBefore = await readMarker(page, anchorId, "anchor-before-prepend");
    const eventsBeforePrepend = await page.evaluate(() => (window.__chatRenderProfileEvents || []).map((event) => ({ ...event })));
    const prependStartedAt = eventsBeforePrepend.reduce((max, event) => Math.max(max, typeof event.at === "number" ? event.at : 0), 0);

    const prepend = scrollResult.release
      ? { triggered: true, samples: scrollResult.samples }
      : await triggerPrepend(page, beforePrepend);
    const afterPrepend = scrollResult.release?.after || await readState(page, "after-prepend");
    const anchorAfter = await readMarker(page, anchorId, "anchor-after-prepend");
    await page.waitForTimeout(1800);
    const afterSettle = await readState(page, "after-settle");
    const anchorAfterSettle = await readMarker(page, anchorId, "anchor-after-settle");

    const events = await page.evaluate(() => (window.__chatRenderProfileEvents || []).map((event) => ({ ...event })));
    const longTasks = await page.evaluate(() => (window.__longTasks || []).map((entry) => ({ ...entry })));
    const resourceEntries = await page.evaluate(() => performance.getEntriesByType("resource").slice(-80).map((entry) => ({
      name: entry.name.replace(location.origin, ""),
      duration: Math.round(entry.duration),
      transferSize: entry.transferSize,
    })));

    const topDelta = anchorBefore.found && anchorAfter.found ? Math.abs(anchorAfter.visibleTop - anchorBefore.visibleTop) : null;
    const settleTopDelta = anchorBefore.found && anchorAfterSettle.found ? Math.abs(anchorAfterSettle.visibleTop - anchorBefore.visibleTop) : null;
    const postPrependEvents = summarizeEvents(events, prependStartedAt);
    const postPrependLongTasks = longTasks.filter((entry) => entry.startTime >= prependStartedAt);
    const markdownAfter = afterPrepend.rows.filter((row) => row.inScroller && row.role === "assistant").map((row) => ({
      messageId: row.messageId,
      textLength: row.textLength,
      plainFallback: row.plainFallback,
      liteRenderer: row.liteRenderer,
      fullMarkdownSignals: row.fullMarkdownSignals,
      preview: row.preview,
    }));

    const report = {
      ok: true,
      conversationId,
      frontendBaseUrl,
      apiBaseUrl: apiBaseUrl.replace(/\/[^/]*$/, "/[REDACTED]"),
      requestStats,
      naturalInitial,
      initial,
      nearTop,
      beforePrepend,
      afterPrepend,
      afterSettle,
      anchor: { id: anchorId, before: anchorBefore, after: anchorAfter, afterSettle: anchorAfterSettle, topDelta, settleTopDelta },
      scrollResult: { capturedReleaseDuringScroll: Boolean(scrollResult.release), sampleCount: scrollResult.samples.length },
      prepend: { triggered: prepend.triggered, sampleCount: prepend.samples.length, samples: prepend.samples },
      markdownAfter,
      postPrependEvents,
      longTasks: {
        totalCount: longTasks.length,
        totalMs: Math.round(longTasks.reduce((sum, entry) => sum + entry.duration, 0)),
        postPrependCount: postPrependLongTasks.length,
        postPrependTotalMs: Math.round(postPrependLongTasks.reduce((sum, entry) => sum + entry.duration, 0)),
        top: longTasks.slice().sort((a, b) => b.duration - a.duration).slice(0, 10).map((entry) => ({ startTime: Math.round(entry.startTime), duration: Math.round(entry.duration) })),
        postPrependTop: postPrependLongTasks.slice().sort((a, b) => b.duration - a.duration).slice(0, 10).map((entry) => ({ startTime: Math.round(entry.startTime), duration: Math.round(entry.duration) })),
      },
      renderEventPhases: events.reduce((acc, event) => {
        acc[event.phase] = (acc[event.phase] || 0) + 1;
        return acc;
      }, {}),
      resourceEntries,
      issues,
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    const summary = {
      ok: true,
      conversationId,
      reportPath,
      naturalInitialDistanceToBottom: naturalInitial.scroller?.distanceToBottom,
      initialDistanceToBottom,
      initialVisibleMessageCount: initial.list.visibleMessageCount,
      beforeVisibleMessageCount: beforePrepend.list.visibleMessageCount,
      afterVisibleMessageCount: afterPrepend.list.visibleMessageCount,
      beforeHiddenLocalMessageCount: beforePrepend.list.hiddenLocalMessageCount,
      afterHiddenLocalMessageCount: afterPrepend.list.hiddenLocalMessageCount,
      olderPageRequests: requestStats.olderPage,
      restoreRequests: requestStats.restoreRequests,
      olderPageRequestDetails: requestStats.olderPageRequests,
      capturedReleaseDuringScroll: Boolean(scrollResult.release),
      prependTriggered: prepend.triggered,
      anchorTopDelta: topDelta,
      anchorSettleTopDelta: settleTopDelta,
      visibleAssistantMarkdown: markdownAfter,
      postPrependEventPhases: postPrependEvents.phases,
      postPrependMarkdownCount: postPrependEvents.markdownCount,
      postPrependRowEventCount: postPrependEvents.rowEventCount,
      postPrependLongTaskCount: report.longTasks.postPrependCount,
      postPrependLongTaskTotalMs: report.longTasks.postPrependTotalMs,
      issues,
    };

    console.log(JSON.stringify(summary, null, 2));

    assert.ok(initialDistanceToBottom <= 4, `normalized initial state should land at bottom: ${initialDistanceToBottom}`);
    if (requirePrepend) {
      assert.ok(prepend.triggered, "history prepend should trigger a local release or older page request");
      assert.ok(afterPrepend.list.visibleMessageCount > beforePrepend.list.visibleMessageCount || afterPrepend.list.hiddenLocalMessageCount < beforePrepend.list.hiddenLocalMessageCount || requestStats.olderPage > 0, `history prepend should change window or request older page: before=${JSON.stringify(beforePrepend.list)} after=${JSON.stringify(afterPrepend.list)} older=${requestStats.olderPage}`);
    }
    if (topDelta !== null) assert.ok(topDelta <= 96, `anchor moved too far after prepend: ${topDelta}px`);
    if (settleTopDelta !== null) assert.ok(settleTopDelta <= 96, `anchor moved too far after settle: ${settleTopDelta}px`);
    assert.ok(report.longTasks.postPrependTotalMs < 500, `post-prepend long tasks too high: ${report.longTasks.postPrependTotalMs}ms`);
    if (issues.length > 0) throw new Error(issues.join("\n"));
  } finally {
    await browser.close();
    await new Promise((resolve) => proxy.close(resolve));
  }
}

main().catch((error) => {
  console.error(redact(error.stack || error.message || error));
  process.exit(1);
});
