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
const maxAnchorDeltaPx = Number(process.env.AI_SPACE_HISTORY_PROFILE_MAX_ANCHOR_DELTA_PX || 32);
const maxPostPrependLongTaskMs = Number(process.env.AI_SPACE_HISTORY_PROFILE_MAX_POST_PREPEND_LONG_TASK_MS || 200);
const maxLocalReleasePageSize = Number(process.env.AI_SPACE_HISTORY_PROFILE_MAX_LOCAL_RELEASE_PAGE_SIZE || 8);

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
  const res = await fetch(`${apiBaseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${apiBaseUrl}/api/auth/login -> ${res.status} ${redact(text.slice(0, 500))}`);
  const data = JSON.parse(text);
  const setCookie = res.headers.get("set-cookie") || "";
  data.sessionToken = setCookie.match(/ai_space_session=([^;,]+)/)?.[1] || "";
  data.refreshToken = setCookie.match(/ai_space_refresh_token=([^;,]+)/)?.[1] || "";
  data.cookieHeader = [data.sessionToken ? `ai_space_session=${data.sessionToken}` : "", data.refreshToken ? `ai_space_refresh_token=${data.refreshToken}` : ""].filter(Boolean).join("; ");
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
    const scroller = document.querySelector('[data-testid="chat-history-scroll-container"]');
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
    const scroller = document.querySelector('[data-testid="chat-history-scroll-container"]');
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
  const box = await page.locator('[data-testid="chat-history-scroll-container"]').boundingBox();
  assert.ok(box, "missing scroller bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(160, box.height / 2));

  const targetScrollTop = Number(process.env.AI_SPACE_HISTORY_PROFILE_PREPEND_TRIGGER_SCROLL_TOP || 800);
  const samples = [];
  let previous = await readState(page, "scroll-near-top-before-0");
  let previousAnchorId = previous.firstVisible?.messageId || null;
  let previousAnchorMarker = previousAnchorId ? await readMarker(page, previousAnchorId, "scroll-near-top-before-0-anchor") : null;
  samples.push(previous);
  for (let i = 0; i < 80; i += 1) {
    if ((previous.scroller?.scrollTop || 0) <= targetScrollTop) return { state: previous, samples, release: null };
    await page.mouse.wheel(0, -900);
    await sleep(70);
    const current = await readState(page, `scroll-near-top-${i}`);
    samples.push(current);
    const released = current.list.visibleMessageCount > baselineWindow.list.visibleMessageCount;
    if (released) {
      const anchorAfter = previousAnchorId ? await readMarker(page, previousAnchorId, `scroll-near-top-${i}-anchor-after-release`) : null;
      return {
        state: current,
        samples,
        release: {
          before: previous,
          after: current,
          anchorId: previousAnchorId,
          anchorBefore: previousAnchorMarker,
          anchorAfter,
        },
      };
    }
    previous = current;
    previousAnchorId = previous.firstVisible?.messageId || null;
    previousAnchorMarker = previousAnchorId ? await readMarker(page, previousAnchorId, `scroll-near-top-${i}-anchor-before-next`) : null;
  }
  const finalState = await readState(page, "scroll-near-top-final");
  samples.push(finalState);
  return { state: finalState, samples, release: null };
}

async function scrollToBottomAndWait(page) {
  await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="chat-history-scroll-container"]');
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
      const scroller = document.querySelector('[data-testid="chat-history-scroll-container"]');
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
  const box = await page.locator('[data-testid="chat-history-scroll-container"]').boundingBox();
  assert.ok(box, "missing scroller bounding box for prepend");
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(140, box.height / 2));

  const deadline = Date.now() + 7000;
  let triggered = false;
  let release = null;
  let previous = beforeWindow;
  let previousAnchorId = previous.firstVisible?.messageId || null;
  let previousAnchorMarker = previousAnchorId ? await readMarker(page, previousAnchorId, "prepend-anchor-before-0") : null;
  while (Date.now() < deadline) {
    await page.mouse.wheel(0, -900);
    // Capture immediately after the scroll event, before a fast history request
    // can mutate the DOM. The product captures its load-more anchor in that
    // same scroll event; waiting 80ms can miss the real pre-prepend viewport.
    const immediate = await readState(page, `prepend-immediate-${samples.length}`);
    samples.push(immediate);
    if (immediate.list.visibleMessageCount <= beforeWindow.list.visibleMessageCount) {
      previous = immediate;
      previousAnchorId = previous.firstVisible?.messageId || null;
      previousAnchorMarker = previousAnchorId ? await readMarker(page, previousAnchorId, `prepend-anchor-before-${samples.length}`) : null;
    }
    await sleep(80);
    const sample = await readState(page, `prepend-sample-${samples.length}`);
    samples.push(sample);
    if (sample.list.visibleMessageCount > beforeWindow.list.visibleMessageCount) {
      triggered = true;
      const anchorAfter = previousAnchorId ? await readMarker(page, previousAnchorId, `prepend-anchor-after-${samples.length}`) : null;
      release = {
        before: previous,
        after: sample,
        anchorId: previousAnchorId,
        anchorBefore: previousAnchorMarker,
        anchorAfter,
      };
      break;
    }
    previous = sample;
    previousAnchorId = previous.firstVisible?.messageId || null;
    previousAnchorMarker = previousAnchorId ? await readMarker(page, previousAnchorId, `prepend-anchor-before-${samples.length}`) : null;
  }

  const settleDeadline = Date.now() + 2500;
  while (Date.now() < settleDeadline) {
    const sample = await readState(page, `settle-sample-${samples.length}`);
    samples.push(sample);
    if (sample.list.visibleMessageCount > beforeWindow.list.visibleMessageCount) break;
    await sleep(100);
  }
  await sleep(360);
  return { triggered, samples, release };
}

function summarizeEvents(events, afterAt = 0) {
  const filtered = events.filter((event) => typeof event.at !== "number" || event.at >= afterAt);
  const phases = filtered.reduce((acc, event) => {
    acc[event.phase] = (acc[event.phase] || 0) + 1;
    return acc;
  }, {});
  const markdown = filtered.filter((event) => String(event.phase || "").startsWith("markdown"));
  const row = filtered.filter((event) => String(event.phase || "").startsWith("message-row"));
  const loadMoreAnchor = filtered.filter((event) => String(event.phase || "").startsWith("message-list-load-more-anchor"));
  return {
    total: filtered.length,
    phases,
    markdownCount: markdown.length,
    rowEventCount: row.length,
    loadMoreAnchorCount: loadMoreAnchor.length,
    markdownSamples: markdown.slice(0, 20),
    rowSamples: row.slice(0, 20),
    loadMoreAnchorSamples: loadMoreAnchor.slice(0, 40),
  };
}

async function main() {
  const auth = await login();
  const requestStats = { restore: 0, olderPage: 0, messageCount: 0, statusCodes: {}, restoreRequests: [], olderPageRequests: [], messageCountRequests: [] };
  const proxy = await startProxy(requestStats);
  const proxyBase = `http://127.0.0.1:${proxyPort}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const cookieDomain = new URL(baseUrl).hostname;
  const authCookies = [];
  if (auth.sessionToken) authCookies.push({ name: "ai_space_session", value: auth.sessionToken, domain: cookieDomain, path: "/", httpOnly: true, secure: baseUrl.startsWith("https:"), sameSite: "Lax" });
  if (auth.refreshToken) authCookies.push({ name: "ai_space_refresh_token", value: auth.refreshToken, domain: cookieDomain, path: "/", httpOnly: true, secure: baseUrl.startsWith("https:"), sameSite: "Lax" });
  if (authCookies.length) await context.addCookies(authCookies);
  const proxyHost = new URL(proxyBase).hostname;
  const cookies = [];
  if (auth.sessionToken) cookies.push({ name: "ai_space_session", value: auth.sessionToken, domain: proxyHost, path: "/", httpOnly: true, secure: false, sameSite: "Lax" });
  if (auth.refreshToken) cookies.push({ name: "ai_space_refresh_token", value: auth.refreshToken, domain: proxyHost, path: "/", httpOnly: true, secure: false, sameSite: "Lax" });
  if (cookies.length) await context.addCookies(cookies);
  const page = await context.newPage();
  const issues = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") issues.push(`console.error: ${redact(msg.text()).slice(0, 400)}`);
  });
  page.on("pageerror", (err) => issues.push(`pageerror: ${redact(err.message).slice(0, 400)}`));

  try {
    await waitForHttpOk(`${proxyBase}/chat/`, 60000);
    await page.addInitScript(({ userValue }) => {
      localStorage.removeItem("token");
      localStorage.removeItem("admin_token");
      localStorage.setItem("user", JSON.stringify(userValue || {}));
      localStorage.setItem("theme", "green");
      window.__chatRenderProfileEvents = [];
      window.__AI_SPACE_CHAT_PROFILE_ENABLED = true;
      window.__longTasks = [];
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__longTasks.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name });
          }
        }).observe({ entryTypes: ["longtask"] });
      } catch {}
      window.addEventListener("chat-render-profile", (event) => window.__chatRenderProfileEvents.push(event.detail));
    }, { userValue: auth.user || {} });

    await page.goto(`${proxyBase}/chat/?id=${conversationId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('[data-testid="chat-history-scroll-container"]', { timeout: 30000 });
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
    const anchorId = scrollResult.release?.anchorId || beforePrepend.firstVisible?.messageId;
    assert.ok(anchorId, `missing first visible anchor before prepend: ${JSON.stringify(beforePrepend.scroller)}`);
    const anchorBefore = scrollResult.release?.anchorBefore || await readMarker(page, anchorId, "anchor-before-prepend");
    const eventsBeforePrepend = await page.evaluate(() => (window.__chatRenderProfileEvents || []).map((event) => ({ ...event })));
    const prependStartedAt = eventsBeforePrepend.reduce((max, event) => Math.max(max, typeof event.at === "number" ? event.at : 0), 0);

    const prepend = scrollResult.release
      ? { triggered: true, samples: scrollResult.samples, release: scrollResult.release }
      : await triggerPrepend(page, beforePrepend);
    const effectiveRelease = scrollResult.release || prepend.release || null;
    const effectiveAnchorId = effectiveRelease?.anchorId || anchorId;
    const effectiveAnchorBefore = effectiveRelease?.anchorBefore || anchorBefore;
    const afterPrepend = effectiveRelease?.after || await readState(page, "after-prepend");
    const anchorAfter = effectiveRelease?.anchorAfter || await readMarker(page, effectiveAnchorId, "anchor-after-prepend");
    await page.waitForTimeout(1800);
    const afterSettle = await readState(page, "after-settle");
    const anchorAfterSettle = await readMarker(page, effectiveAnchorId, "anchor-after-settle");

    const events = await page.evaluate(() => (window.__chatRenderProfileEvents || []).map((event) => ({ ...event })));
    const longTasks = await page.evaluate(() => (window.__longTasks || []).map((entry) => ({ ...entry })));
    const resourceEntries = await page.evaluate(() => performance.getEntriesByType("resource").slice(-80).map((entry) => ({
      name: entry.name.replace(location.origin, ""),
      duration: Math.round(entry.duration),
      transferSize: entry.transferSize,
    })));

    const topDelta = effectiveAnchorBefore?.found && anchorAfter.found ? Math.abs(anchorAfter.visibleTop - effectiveAnchorBefore.visibleTop) : null;
    const settleTopDelta = effectiveAnchorBefore?.found && anchorAfterSettle.found ? Math.abs(anchorAfterSettle.visibleTop - effectiveAnchorBefore.visibleTop) : null;
    const releasedVisibleCount = Math.max(0, afterPrepend.list.visibleMessageCount - beforePrepend.list.visibleMessageCount);
    const beforeHiddenCount = Math.max(0, (beforePrepend.list.allVisibleMessageCount || 0) - (beforePrepend.list.visibleMessageCount || 0));
    const afterHiddenCount = Math.max(0, (afterPrepend.list.allVisibleMessageCount || 0) - (afterPrepend.list.visibleMessageCount || 0));
    const releasedHiddenCount = Math.max(0, beforeHiddenCount - afterHiddenCount);
    const changedLocalWindow = releasedVisibleCount > 0 || releasedHiddenCount > 0;
    const postPrependEvents = summarizeEvents(events, prependStartedAt);
    const productAnchorCaptures = postPrependEvents.loadMoreAnchorSamples.filter((event) => event.phase === "message-list-load-more-anchor-capture");
    const productAnchorRestores = postPrependEvents.loadMoreAnchorSamples.filter((event) => event.phase === "message-list-load-more-anchor-restore");
    const productAnchorCapture = productAnchorCaptures[productAnchorCaptures.length - 1] || null;
    const productAnchorStableRestore = [...productAnchorRestores].reverse().find((event) => event.messageId === productAnchorCapture?.messageId) || productAnchorRestores[productAnchorRestores.length - 1] || null;
    const productAnchorDelta = productAnchorCapture && productAnchorStableRestore
      ? Math.abs(Number(productAnchorStableRestore.rowTop || 0) - Number(productAnchorCapture.top || 0))
      : null;
    const effectiveTopDelta = productAnchorDelta ?? topDelta;
    const effectiveSettleTopDelta = productAnchorDelta ?? settleTopDelta;
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
      anchor: { id: effectiveAnchorId, originalId: anchorId, before: effectiveAnchorBefore, originalBefore: anchorBefore, after: anchorAfter, afterSettle: anchorAfterSettle, topDelta, settleTopDelta, productAnchorCapture, productAnchorStableRestore, productAnchorDelta, effectiveTopDelta, effectiveSettleTopDelta },
      scrollResult: { capturedReleaseDuringScroll: Boolean(scrollResult.release), capturedReleaseDuringPrepend: Boolean(prepend.release), sampleCount: scrollResult.samples.length },
      localRelease: { releasedVisibleCount, releasedHiddenCount, changedLocalWindow, maxLocalReleasePageSize },
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
      olderPageRequests: requestStats.olderPage,
      restoreRequests: requestStats.restoreRequests,
      olderPageRequestDetails: requestStats.olderPageRequests,
      capturedReleaseDuringScroll: Boolean(scrollResult.release),
      prependTriggered: prepend.triggered,
      releasedVisibleCount,
      releasedHiddenCount,
      changedLocalWindow,
      maxLocalReleasePageSize,
      maxAnchorDeltaPx,
      maxPostPrependLongTaskMs,
      anchorTopDelta: effectiveTopDelta,
      anchorSettleTopDelta: effectiveSettleTopDelta,
      scriptAnchorTopDelta: topDelta,
      scriptAnchorSettleTopDelta: settleTopDelta,
      productAnchorDelta,
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
      assert.ok(changedLocalWindow || requestStats.olderPage > 0, `history prepend should change window or request older page: before=${JSON.stringify(beforePrepend.list)} after=${JSON.stringify(afterPrepend.list)} older=${requestStats.olderPage}`);
    }
    if (changedLocalWindow) {
      assert.ok(releasedVisibleCount <= maxLocalReleasePageSize, `local history release should be paged: releasedVisibleCount=${releasedVisibleCount}, max=${maxLocalReleasePageSize}`);
      assert.ok(releasedHiddenCount <= maxLocalReleasePageSize, `local hidden history release should be paged: releasedHiddenCount=${releasedHiddenCount}, max=${maxLocalReleasePageSize}`);
    }
    const shouldAssertPrependAnchor = changedLocalWindow || requestStats.olderPage > 0 || prepend.triggered;
    if (shouldAssertPrependAnchor && effectiveTopDelta !== null) assert.ok(effectiveTopDelta <= maxAnchorDeltaPx, `anchor moved too far after prepend: ${effectiveTopDelta}px > ${maxAnchorDeltaPx}px`);
    if (shouldAssertPrependAnchor && effectiveSettleTopDelta !== null) assert.ok(effectiveSettleTopDelta <= maxAnchorDeltaPx, `anchor moved too far after settle: ${effectiveSettleTopDelta}px > ${maxAnchorDeltaPx}px`);
    assert.ok(report.longTasks.postPrependTotalMs <= maxPostPrependLongTaskMs, `post-prepend long tasks too high: ${report.longTasks.postPrependTotalMs}ms > ${maxPostPrependLongTaskMs}ms`);
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
