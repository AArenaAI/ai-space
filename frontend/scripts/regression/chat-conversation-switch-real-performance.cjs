#!/usr/bin/env node
const assert = require("node:assert/strict");
const http = require("node:http");
const { chromium } = require("playwright");

const apiBaseUrl = trimTrailingSlash(process.env.REAL_CHAT_API_BASE_URL || "http://127.0.0.1:9091");
const frontendBaseUrl = trimTrailingSlash(process.env.REAL_CHAT_FRONTEND_BASE_URL || "http://127.0.0.1:3000");
const proxyPort = Number(process.env.REAL_CHAT_SWITCH_PERF_PROXY_PORT || 3212);
const model = process.env.REAL_CHAT_SWITCH_PERF_MODEL || "gpt-5.5";
const timeoutMs = Number(process.env.REAL_CHAT_SWITCH_PERF_TIMEOUT_MS || 90000);
const verbose = process.env.REAL_CHAT_SWITCH_PERF_VERBOSE === "1";
const requestStats = {
  restore: 0,
  messageCount: 0,
  messageStatus: 0,
  restoreRequests: [],
};

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function log(message) {
  if (verbose) console.error(`[switch-perf] ${message}`);
}

function redact(value) {
  return String(value || "")
    .replace(/Bearer\s+[-._~+/=A-Za-z0-9]+/g, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9._-]+/g, "[REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/(api[_-]?key|token|password|secret)(["'=:\s]+)([^"'\s,}]+)/gi, "$1$2[REDACTED]");
}

async function fetchText(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  return { res, text };
}

async function registerUser() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `chat-switch-perf-${suffix}@example.test`;
  const password = `E2E-${suffix}-pw`;
  const { res, text } = await fetchText(`${apiBaseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: "Switch Perf E2E" }),
  });
  assert.equal(res.status, 201, `register failed: ${res.status} ${redact(text.slice(0, 500))}`);
  const data = JSON.parse(text);
  assert.ok(data.token, "register response missing token");
  return { token: data.token, user: data.user || {}, email };
}

async function createConversation(token, title) {
  const { res, text } = await fetchText(`${apiBaseUrl}/api/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title, model }),
  });
  assert.equal(res.status, 201, `conversation create failed: ${res.status} ${redact(text.slice(0, 500))}`);
  const data = JSON.parse(text);
  assert.ok(data.id, "conversation create response missing id");
  return data;
}

async function addMessage(token, conversationId, role, content) {
  const { res, text } = await fetchText(`${apiBaseUrl}/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ role, content, model: role === "assistant" ? model : "" }),
  });
  assert.equal(res.status, 201, `message create failed: ${res.status} ${redact(text.slice(0, 500))}`);
  return JSON.parse(text);
}

async function seedConversation(token, title, marker) {
  const conversation = await createConversation(token, title);
  await addMessage(token, conversation.id, "user", `${marker} 用户问题`);
  await addMessage(token, conversation.id, "assistant", `${marker} 助手回答 OK 42`);
  return conversation;
}

function startProxy() {
  const server = http.createServer((req, res) => {
    const targetBase = req.url.startsWith("/api/") || req.url === "/health" ? apiBaseUrl : frontendBaseUrl;
    const requestStartedAt = Date.now();
    const isRestoreRequest = req.method === "GET" && /^\/api\/conversations\/\d+\?/.test(req.url) && /message_tail=/.test(req.url);
    if (req.method === "GET") {
      if (isRestoreRequest) requestStats.restore += 1;
      if (/^\/api\/conversations\/\d+\/messages\?/.test(req.url) && /limit=1/.test(req.url)) requestStats.messageCount += 1;
      if (/^\/api\/conversations\/\d+\/messages\/\d+/.test(req.url)) requestStats.messageStatus += 1;
    }
    const target = new URL(req.url, targetBase);
    const headers = { ...req.headers, host: target.host };
    const proxyReq = http.request(target, { method: req.method, headers }, (proxyRes) => {
      let responseBytes = 0;
      if (isRestoreRequest) {
        proxyRes.on("data", (chunk) => {
          responseBytes += chunk.length || 0;
        });
        proxyRes.on("end", () => {
          requestStats.restoreRequests.push({
            status: proxyRes.statusCode || 0,
            durationMs: Date.now() - requestStartedAt,
            bytes: responseBytes,
            path: redact(req.url),
          });
        });
      }
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
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`timeout waiting for ${url}: ${lastError}`);
}

async function clickConversationRow(page, conversationId) {
  await page.waitForSelector(`[data-conversation-id="${conversationId}"]`, { state: "attached", timeout: 20000 });
  const clicked = await page.evaluate((id) => {
    const row = document.querySelector(`[data-conversation-id="${id}"]`);
    if (!row) return false;
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  }, conversationId);
  assert.ok(clicked, `conversation row not found: ${conversationId}`);
}

async function waitForBodyText(page, expected) {
  await page.waitForFunction((needle) => document.body.innerText.includes(needle), expected, { timeout: timeoutMs });
}

async function switchConversationAndMeasure(page, conversationId, expectedText, label) {
  const startedAt = Date.now();
  await page.waitForSelector(`[data-conversation-id="${conversationId}"]`, { state: "attached", timeout: 20000 });
  const rowAttachedAt = Date.now();
  const clicked = await page.evaluate((id) => {
    const row = document.querySelector(`[data-conversation-id="${id}"]`);
    if (!row) return false;
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  }, conversationId);
  assert.ok(clicked, `conversation row not found: ${conversationId}`);
  const dispatchedAt = Date.now();
  await waitForBodyText(page, expectedText);
  const textVisibleAt = Date.now();
  return {
    label,
    conversationId,
    rowAttachedMs: rowAttachedAt - startedAt,
    dispatchMs: dispatchedAt - rowAttachedAt,
    dispatchToTextVisibleMs: textVisibleAt - dispatchedAt,
    clickToTextVisibleMs: textVisibleAt - startedAt,
  };
}

async function clearVolatileConversationMemoryCache(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("chat-conversation-switch-test-control", { detail: { action: "clear-memory-cache" } }));
  });
}

async function waitForPersistentSnapshot(page, conversationId) {
  await page.waitForFunction((id) => new Promise((resolve) => {
    let ownerKey;
    try {
      const rawUser = localStorage.getItem("user");
      const user = rawUser ? JSON.parse(rawUser) : null;
      const ownerId = user?.id ?? user?.email;
      ownerKey = ownerId === undefined || ownerId === null || String(ownerId).trim() === "" ? undefined : `user:${String(ownerId)}`;
    } catch {
      ownerKey = undefined;
    }
    if (!ownerKey) {
      resolve(false);
      return;
    }
    const request = indexedDB.open("ai-space-chat-snapshot-cache");
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("conversationSnapshots", "readonly");
      const cacheKey = `${ownerKey}:conversation:${id}`;
      const get = tx.objectStore("conversationSnapshots").get(cacheKey);
      get.onsuccess = () => resolve(Boolean(get.result));
      get.onerror = () => resolve(false);
    };
  }), conversationId, { timeout: timeoutMs });
}

function summarizeEvents(events, conversationId) {
  const matching = events.filter((event) => Number(event.conversationId) === Number(conversationId));
  const byPhase = Object.fromEntries(matching.map((event) => [`${event.phase}:${event.source || ""}`, Math.round(event.durationMs || 0)]));
  const firstSnapshot = matching.find((event) => event.phase === "first-snapshot");
  const shellDisplayed = matching.find((event) => event.phase === "shell-displayed");
  const revalidateStart = matching.find((event) => event.phase === "revalidate-start");
  const restore = matching.find((event) => event.phase === "restore-response");
  const reconciled = matching.find((event) => event.phase === "restore-reconciled");
  const notModified = matching.find((event) => event.phase === "restore-not-modified");
  const snapshotSource = firstSnapshot?.snapshotSource || firstSnapshot?.source || null;
  const revalidateEnd = notModified || reconciled || restore;
  return {
    eventCount: matching.length,
    firstSnapshotSource: firstSnapshot?.source || null,
    firstSnapshotMs: firstSnapshot ? Math.round(firstSnapshot.durationMs || 0) : null,
    stages: {
      cache: {
        source: snapshotSource,
        displayMode: firstSnapshot?.displayMode || null,
        firstSnapshotMs: firstSnapshot ? Math.round(firstSnapshot.durationMs || 0) : null,
      },
      shell: {
        displayed: Boolean(shellDisplayed),
        shellMs: shellDisplayed ? Math.round(shellDisplayed.durationMs || 0) : null,
      },
      revalidate: {
        startedMs: revalidateStart ? Math.round(revalidateStart.durationMs || 0) : null,
        completedMs: revalidateEnd ? Math.round(revalidateEnd.durationMs || 0) : null,
        mode: revalidateStart?.displayMode || restore?.displayMode || notModified?.displayMode || null,
        notModified: Boolean(notModified),
        reconciled: Boolean(reconciled),
      },
    },
    restoreResponseMs: restore ? Math.round(restore.durationMs || 0) : null,
    restoreReconciledMs: reconciled ? Math.round(reconciled.durationMs || 0) : null,
    restoreNotModifiedMs: notModified ? Math.round(notModified.durationMs || 0) : null,
    phases: byPhase,
    loads: summarizeSwitchLoads(matching),
  };
}

function summarizeSwitchLoads(events) {
  const loads = [];
  let current = [];
  for (const event of events) {
    if (event.phase === "start" && current.length > 0) {
      loads.push(current);
      current = [];
    }
    current.push(event);
  }
  if (current.length > 0) loads.push(current);

  return loads.map((loadEvents, index) => {
    const firstSnapshot = loadEvents.find((event) => event.phase === "first-snapshot");
    const shellDisplayed = loadEvents.find((event) => event.phase === "shell-displayed");
    const revalidateStart = loadEvents.find((event) => event.phase === "revalidate-start");
    const restore = loadEvents.find((event) => event.phase === "restore-response");
    const reconciled = loadEvents.find((event) => event.phase === "restore-reconciled");
    const notModified = loadEvents.find((event) => event.phase === "restore-not-modified");
    const revalidateEnd = notModified || reconciled || restore;
    return {
      index,
      loadSeq: loadEvents[0]?.loadSeq ?? "unknown",
      phases: loadEvents.map((event) => event.phase),
      cache: {
        source: firstSnapshot?.snapshotSource || firstSnapshot?.source || null,
        displayMode: firstSnapshot?.displayMode || null,
        firstSnapshotMs: firstSnapshot ? Math.round(firstSnapshot.durationMs || 0) : null,
        messageCount: firstSnapshot?.messageCount,
      },
      shell: {
        displayed: Boolean(shellDisplayed),
        shellMs: shellDisplayed ? Math.round(shellDisplayed.durationMs || 0) : null,
      },
      revalidate: {
        startedMs: revalidateStart ? Math.round(revalidateStart.durationMs || 0) : null,
        completedMs: revalidateEnd ? Math.round(revalidateEnd.durationMs || 0) : null,
        mode: revalidateStart?.displayMode || restore?.displayMode || notModified?.displayMode || null,
        notModified: Boolean(notModified),
        reconciled: Boolean(reconciled),
      },
    };
  });
}

function summarizeRenderEvents(events, conversationId) {
  return events
    .filter((event) => event.conversationId === undefined || Number(event.conversationId) === Number(conversationId))
    .map((event) => ({
      phase: event.phase,
      messageCount: event.messageCount,
      visibleMessageCount: event.visibleMessageCount,
      contentLength: event.contentLength,
      staggerMs: event.staggerMs,
      delayMs: event.delayMs,
      blockCount: event.blockCount,
      cacheHit: event.cacheHit,
      isPreview: event.isPreview,
      parseMs: typeof event.parseMs === "number" ? Number(event.parseMs.toFixed(2)) : event.parseMs,
      codeBlocks: event.codeBlocks,
      tableLines: event.tableLines,
      durationMs: Math.round(event.durationMs || 0),
    }))
    .slice(-32);
}

async function main() {
  const health = await fetch(`${apiBaseUrl}/health`);
  assert.ok(health.ok, `backend health failed: ${health.status}`);
  await waitForHttpOk(`${frontendBaseUrl}/chat/`, 60000);

  const auth = await registerUser();
  const suffix = `${Date.now()}`;
  const convA = await seedConversation(auth.token, `Switch Perf A ${suffix}`, `SWITCH_PERF_A_${suffix}`);
  const convB = await seedConversation(auth.token, `Switch Perf B ${suffix}`, `SWITCH_PERF_B_${suffix}`);

  const proxy = await startProxy();
  const proxyBase = `http://127.0.0.1:${proxyPort}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const issues = [];
  const switchTimings = [];

  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" && !/Hydration failed|Expected server HTML|matching/.test(text)) {
      issues.push(`console.error: ${text}`);
    }
  });
  page.on("pageerror", (err) => {
    if (!/Hydration failed|error while hydrating this Suspense boundary/.test(err.message)) {
      issues.push(`pageerror: ${err.message}`);
    }
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText || "failed";
    if (failure === "net::ERR_ABORTED") return;
    issues.push(`requestfailed: ${request.method()} ${request.url()} ${failure}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !/favicon\.ico/.test(response.url())) issues.push(`response ${response.status()}: ${response.url()}`);
  });

  try {
    await page.addInitScript(({ tokenValue, userValue, modelValue }) => {
      localStorage.setItem("token", tokenValue);
      localStorage.setItem("user", JSON.stringify(userValue || {}));
      localStorage.setItem("selected-model", modelValue);
      localStorage.setItem("recent-models", JSON.stringify([modelValue]));
      localStorage.setItem("chat-conversation-disable-prefetch", "1");
      window.__chatSwitchPerfEvents = [];
      window.__chatRenderProfileEvents = [];
      window.addEventListener("chat-conversation-switch-performance", (event) => {
        window.__chatSwitchPerfEvents.push(event.detail);
      });
      window.addEventListener("chat-render-profile", (event) => {
        window.__chatRenderProfileEvents.push(event.detail);
      });
    }, { tokenValue: auth.token, userValue: auth.user, modelValue: model });

    const response = await page.goto(`${proxyBase}/chat/?id=${convA.id}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    assert.ok((response?.status() || 0) < 400, `chat page HTTP ${response?.status()}`);
    await waitForBodyText(page, `SWITCH_PERF_A_${suffix}`);
    log("loaded conversation A");

    switchTimings.push(await switchConversationAndMeasure(page, convB.id, `SWITCH_PERF_B_${suffix}`, "cache-miss-to-B"));
    await page.waitForTimeout(500);
    log("cache miss switch to B done");

    switchTimings.push(await switchConversationAndMeasure(page, convA.id, `SWITCH_PERF_A_${suffix}`, "memory-hit-to-A"));
    await page.waitForTimeout(500);
    log("memory hit switch to A done");

    await waitForPersistentSnapshot(page, convB.id);
    await clearVolatileConversationMemoryCache(page);
    const eventsBeforeReload = await page.evaluate(() => window.__chatSwitchPerfEvents || []);
    const renderEventsBeforeReload = await page.evaluate(() => window.__chatRenderProfileEvents || []);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await waitForBodyText(page, `SWITCH_PERF_A_${suffix}`);
    switchTimings.push(await switchConversationAndMeasure(page, convB.id, `SWITCH_PERF_B_${suffix}`, "indexeddb-hit-to-B"));
    await page.waitForTimeout(800);
    log("indexeddb switch to B done");

    const eventsAfterReload = await page.evaluate(() => window.__chatSwitchPerfEvents || []);
    const renderEventsAfterReload = await page.evaluate(() => window.__chatRenderProfileEvents || []);
    const events = [...eventsBeforeReload, ...eventsAfterReload];
    const renderEvents = [...renderEventsBeforeReload, ...renderEventsAfterReload];
    const bEvents = events.filter((event) => Number(event.conversationId) === Number(convB.id));
    const aEvents = events.filter((event) => Number(event.conversationId) === Number(convA.id));
    const firstSnapshots = events.filter((event) => event.phase === "first-snapshot");
    assert.ok(firstSnapshots.some((event) => event.source === "backend"), `backend first-snapshot missing: ${JSON.stringify(events)}`);
    assert.ok(firstSnapshots.some((event) => event.source === "memory"), `memory first-snapshot missing: ${JSON.stringify(events)}`);
    assert.ok(
      bEvents.some((event) => event.phase === "first-snapshot" && event.source === "indexeddb"),
      `indexeddb first-snapshot missing for conversation B: ${JSON.stringify(bEvents)}`
    );
    assert.ok(
      renderEvents.some((event) => event.phase === "message-list-commit"),
      `message-list render profile missing: ${JSON.stringify(renderEvents)}`
    );
    assert.ok(
      renderEvents.some((event) => event.phase === "route-conversation-change" || event.phase === "route-push-start"),
      `route profile missing: ${JSON.stringify(renderEvents)}`
    );
    assert.equal(requestStats.messageCount, 0, `expected restore meta to avoid message count requests, got ${requestStats.messageCount}`);
    assert.equal(requestStats.messageStatus, 0, `expected restore meta to avoid message status requests, got ${requestStats.messageStatus}`);

    if (issues.length > 0) throw new Error(`browser issues:\n${issues.slice(0, 12).join("\n")}`);

    const report = {
      ok: true,
      apiBaseUrl,
      frontendBaseUrl,
      userId: auth.user?.id,
      conversationAId: convA.id,
      conversationBId: convB.id,
      conversationB: summarizeEvents(events, convB.id),
      conversationA: summarizeEvents(events, convA.id),
      renderProfileB: summarizeRenderEvents(renderEvents, convB.id),
      switchTimings,
      indexedDbObserved: bEvents.some((event) => event.phase === "first-snapshot" && event.source === "indexeddb"),
      requestStats: { ...requestStats },
      totalEvents: events.length,
    };
    console.log(JSON.stringify(report, null, 2));
    console.log("chat conversation switch real performance passed");
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolve) => proxy.close(resolve));
  }
}

main().catch((error) => {
  console.error(redact(error.stack || error.message || error));
  process.exit(1);
});
