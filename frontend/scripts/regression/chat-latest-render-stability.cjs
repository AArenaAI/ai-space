#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const { chromium } = require("playwright");

const apiBaseUrl = process.env.REAL_API_BASE_URL || "http://127.0.0.1:9091";
const frontendBaseUrl = process.env.FRONTEND_BASE_URL || "http://127.0.0.1:3012";
const proxyPort = Number(process.env.AI_SPACE_E2E_PROXY_PORT || 3435);
const baseUrl = process.env.AI_SPACE_E2E_PROXY_BASE_URL || `http://127.0.0.1:${proxyPort}`;
const email = process.env.AI_SPACE_E2E_EMAIL;
const password = process.env.AI_SPACE_E2E_PASSWORD;
const outPath = process.env.AI_SPACE_E2E_REPORT || "/tmp/ai-space-chat-latest-render-stability.json";
const conversations = (process.env.AI_SPACE_E2E_STABILITY_CONVERSATIONS || "62,607,606,608,264,213")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const earlyDelayMs = Math.max(0, Number(process.env.AI_SPACE_E2E_STABILITY_EARLY_MS || 180));
const lateDelayMs = Math.max(earlyDelayMs + 100, Number(process.env.AI_SPACE_E2E_STABILITY_LATE_MS || 2500));
const failOnRendererChanged = process.env.AI_SPACE_E2E_ALLOW_RENDERER_CHANGED !== "1";
const expectedLatestIds = Object.fromEntries(
  (process.env.AI_SPACE_E2E_EXPECTED_LATEST_IDS || "62:124,607:1416")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split(":").map((value) => value.trim()))
    .filter(([cid, id]) => cid && id)
);

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
  const setCookie = response.headers.get("set-cookie") || "";
  const sessionToken = setCookie.match(/ai_space_session=([^;,]+)/)?.[1] || "";
  const refreshToken = setCookie.match(/ai_space_refresh_token=([^;,]+)/)?.[1] || "";
  return { sessionToken, refreshToken, user: data.user || data.data?.user || { email } };
}

async function installAuth(context, page, auth) {
  const domain = new URL(baseUrl).hostname;
  const cookies = [];
  if (auth.sessionToken) cookies.push({ name: "ai_space_session", value: auth.sessionToken, domain, path: "/", httpOnly: true, secure: baseUrl.startsWith("https:"), sameSite: "Lax" });
  if (auth.refreshToken) cookies.push({ name: "ai_space_refresh_token", value: auth.refreshToken, domain, path: "/", httpOnly: true, secure: baseUrl.startsWith("https:"), sameSite: "Lax" });
  if (cookies.length) await context.addCookies(cookies);
  await page.addInitScript(({ user }) => {
    localStorage.removeItem("token");
    localStorage.removeItem("admin_token");
    localStorage.setItem("user", JSON.stringify(user));
    localStorage.setItem("theme", "dark");
    window.__AI_SPACE_CHAT_PROFILE_ENABLED = true;
  }, { user: auth.user });
}

function rowSnapshotScript(cid) {
  const rows = Array.from(document.querySelectorAll('[data-chat-message-row="true"][data-message-id]'));
  const assistants = rows.filter((row) => {
    const role = row.getAttribute("data-message-role") || row.dataset.messageRole || "";
    return role === "assistant" || row.querySelector('[data-markdown-token-renderer], [data-markdown-lite-renderer]');
  });
  const latest = assistants.at(-1) || rows.at(-1) || null;
  const scroller = document.querySelector('[data-testid="chat-history-scroll-container"]');
  const latestText = latest?.textContent || "";
  const token = latest ? Array.from(latest.querySelectorAll('[data-markdown-token-renderer]')).map((node) => node.getAttribute("data-markdown-token-renderer") || "") : [];
  const lite = latest ? Array.from(latest.querySelectorAll('[data-markdown-lite-renderer]')).map((node) => node.getAttribute("data-markdown-lite-renderer") || "") : [];
  const events = Array.isArray(window.__AI_SPACE_CHAT_PROFILE_EVENTS) ? window.__AI_SPACE_CHAT_PROFILE_EVENTS : [];
  const latestId = latest?.getAttribute("data-message-id") || "";
  const latestEvents = events.filter((event) => String(event.messageId || "") === latestId);
  return {
    cid,
    url: location.href,
    rowCount: rows.length,
    assistantRowCount: assistants.length,
    latestId,
    textLen: latestText.length,
    token,
    lite,
    distanceToBottom: scroller ? Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) : null,
    tokenRenderedCounts: latestEvents.filter((event) => event.phase === "markdown-token-rendered").map((event) => Number(event.renderedBlockCount || 0)),
    skippedBrowseCount: latestEvents.filter((event) => event.phase === "markdown-token-upgrade-skipped-browse").length,
    hydratePhases: latestEvents.filter((event) => String(event.phase || "").startsWith("markdown-hydrate")).map((event) => event.phase),
  };
}

async function sampleConversation(page, cid) {
  await page.evaluate(() => { window.__AI_SPACE_CHAT_PROFILE_EVENTS = []; });
  await page.goto(`${baseUrl}/chat/?id=${encodeURIComponent(cid)}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForSelector('[data-testid="chat-history-scroll-container"]', { state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-chat-message-row="true"][data-message-id]').length > 0, null, { timeout: 30_000 });
  await page.waitForTimeout(earlyDelayMs);
  const early = await page.evaluate(rowSnapshotScript, cid);
  await page.waitForTimeout(Math.max(0, lateDelayMs - earlyDelayMs));
  const late = await page.evaluate(rowSnapshotScript, cid);
  return {
    cid,
    early,
    late,
    latestIdChanged: early.latestId !== late.latestId,
    expectedLatestId: expectedLatestIds[cid] || "",
    expectedLatestIdMatched: expectedLatestIds[cid] ? late.latestId === expectedLatestIds[cid] : true,
    textDelta: late.textLen - early.textLen,
    rendererChanged: JSON.stringify({ token: early.token, lite: early.lite }) !== JSON.stringify({ token: late.token, lite: late.lite }),
  };
}

(async () => {
  const proxy = await createProxy();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const failures = [];
  page.on("console", (message) => { if (message.type() === "error") failures.push(`console error: ${message.text()}`); });
  page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));
  try {
    const auth = await login();
    await installAuth(context, page, auth);
    const samples = [];
    for (const cid of conversations) samples.push(await sampleConversation(page, cid));
    const summary = {
      ok: samples.every((sample) => sample.textDelta === 0 && !sample.latestIdChanged && sample.expectedLatestIdMatched && (!failOnRendererChanged || !sample.rendererChanged) && sample.late.distanceToBottom === 0 && sample.late.skippedBrowseCount === 0),
      conversations,
      earlyDelayMs,
      lateDelayMs,
      failOnRendererChanged,
      textDeltaNonZero: samples.filter((sample) => sample.textDelta !== 0).map((sample) => sample.cid),
      rendererChanged: samples.filter((sample) => sample.rendererChanged).map((sample) => sample.cid),
      latestIdChanged: samples.filter((sample) => sample.latestIdChanged).map((sample) => sample.cid),
      expectedLatestIdMismatched: samples.filter((sample) => !sample.expectedLatestIdMatched).map((sample) => sample.cid),
      distanceToBottomNonZero: samples.filter((sample) => sample.late.distanceToBottom !== 0).map((sample) => sample.cid),
      skippedBrowse: samples.filter((sample) => sample.late.skippedBrowseCount > 0).map((sample) => sample.cid),
      samples,
    };
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
    assert.equal(summary.textDeltaNonZero.length, 0, `latest text changed: ${summary.textDeltaNonZero.join(",")}`);
    assert.equal(summary.latestIdChanged.length, 0, `latest row id changed: ${summary.latestIdChanged.join(",")}`);
    assert.equal(summary.expectedLatestIdMismatched.length, 0, `expected latest id mismatched: ${summary.expectedLatestIdMismatched.join(",")}`);
    assert.equal(summary.distanceToBottomNonZero.length, 0, `not at bottom: ${summary.distanceToBottomNonZero.join(",")}`);
    assert.equal(summary.skippedBrowse.length, 0, `browse skip residue: ${summary.skippedBrowse.join(",")}`);
    if (failOnRendererChanged) assert.equal(summary.rendererChanged.length, 0, `latest renderer changed: ${summary.rendererChanged.join(",")}`);
    assert.equal(failures.length, 0, failures.join("\n"));
    console.log(JSON.stringify({ ok: true, outPath, checked: conversations, rendererChanged: summary.rendererChanged }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => proxy.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
