#!/usr/bin/env node
const http = require("node:http");
const { chromium } = require("playwright");

const apiBaseUrl = trimTrailingSlash(process.env.REAL_CHAT_API_BASE_URL || "http://127.0.0.1:9091");
const frontendBaseUrl = trimTrailingSlash(process.env.REAL_CHAT_FRONTEND_BASE_URL || "http://127.0.0.1:3000");
const model = process.env.REAL_CHAT_MODEL || "gpt-5.5";
const searchEnabled = process.env.REAL_CHAT_SEARCH === "1";
const reasoningEnabled = process.env.REAL_CHAT_REASONING === "1";
const reasoningEffort = process.env.REAL_CHAT_REASONING_EFFORT || "standard";
const prompt = process.env.REAL_CHAT_PROMPT || "真实页面发送 E2E：请只回答 OK 42。";
const expectPattern = new RegExp(process.env.REAL_CHAT_EXPECT || "OK[\\s\\S]*42", "i");
const timeoutMs = Number(process.env.REAL_CHAT_TIMEOUT_MS || 180000);
const proxyPort = Number(process.env.REAL_CHAT_PROXY_PORT || 3211);
const verbose = process.env.REAL_CHAT_VERBOSE === "1";
const expectTimelineTexts = String(process.env.REAL_CHAT_EXPECT_TIMELINE || "")
  .split("|")
  .map((item) => item.trim())
  .filter(Boolean);

function logStep(message) {
  if (verbose) console.error(`[live-e2e] ${message}`);
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function redact(value) {
  return String(value || "")
    .replace(/Bearer\s+[-._~+/=A-Za-z0-9]+/g, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9._-]+/g, "[REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/(api[_-]?key|token|password|secret)(["'=:\s]+)([^"'\s,}]+)/gi, "$1$2[REDACTED]");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchText(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  return { res, text };
}

async function registerUser() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `chat-live-e2e-${suffix}@example.test`;
  const password = `E2E-${suffix}-pw`;
  const { res, text } = await fetchText(`${apiBaseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: "Live Chat E2E" }),
  });
  assert(res.status === 201, `register failed: ${res.status} ${redact(text.slice(0, 500))}`);
  const data = JSON.parse(text);
  assert(data.token, "register response missing token");
  return { token: data.token, user: data.user };
}

function startProxy() {
  const server = http.createServer((req, res) => {
    const targetBase = req.url.startsWith("/api/") ? apiBaseUrl : frontendBaseUrl;
    const target = new URL(req.url, targetBase);
    const headers = { ...req.headers, host: target.host };
    const proxyReq = http.request(target, { method: req.method, headers }, (proxyRes) => {
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

async function main() {
  const startedAt = Date.now();
  const report = { apiBaseUrl, frontendBaseUrl, model, searchEnabled, reasoningEnabled, reasoningEffort, startedAt: new Date(startedAt).toISOString() };
  const health = await fetch(`${apiBaseUrl}/health`);
  assert(health.ok, `backend health failed: ${health.status}`);
  logStep("backend health ok");
  await waitForHttpOk(`${frontendBaseUrl}/chat/`, 60000);
  logStep("frontend health ok");
  const modelsRes = await fetch(`${apiBaseUrl}/api/models/chat`);
  assert(modelsRes.ok, `models failed: ${modelsRes.status}`);
  const models = await modelsRes.json();
  assert(Array.isArray(models) && models.some((m) => m.id === model), `model ${model} not found in chat models`);
  const auth = await registerUser();
  report.userId = auth.user?.id;
  logStep(`registered user ${report.userId || ""}`);

  const proxy = await startProxy();
  const proxyBase = `http://127.0.0.1:${proxyPort}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const issues = [];
  const chatResponses = [];
  page.on("console", (msg) => { if (msg.type() === "error") issues.push(`console.error: ${msg.text()}`); });
  page.on("pageerror", (err) => issues.push(`pageerror: ${err.message}`));
  page.on("requestfailed", (request) => issues.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`));
  page.on("response", (response) => {
    if (/\/api\/chat(?:\?|$)/.test(response.url())) chatResponses.push({ status: response.status(), url: response.url(), contentType: response.headers()["content-type"] || "" });
    if (response.status() >= 400 && !/favicon\.ico/.test(response.url())) issues.push(`response ${response.status()}: ${response.url()}`);
  });

  try {
    await page.addInitScript(({ tokenValue, userValue, modelValue, searchEnabledValue, reasoningEnabledValue, reasoningEffortValue }) => {
      localStorage.setItem("token", tokenValue);
      localStorage.setItem("user", JSON.stringify(userValue || {}));
      localStorage.setItem("selected-model", modelValue);
      localStorage.setItem("recent-models", JSON.stringify([modelValue]));
      localStorage.setItem("search-enabled", searchEnabledValue ? "true" : "false");
      localStorage.setItem("reasoning-enabled", reasoningEnabledValue ? "true" : "false");
      localStorage.setItem("reasoning-mode", reasoningEnabledValue ? "think" : "fast");
      localStorage.setItem("reasoning-effort", reasoningEffortValue);
    }, {
      tokenValue: auth.token,
      userValue: auth.user || {},
      modelValue: model,
      searchEnabledValue: searchEnabled,
      reasoningEnabledValue: reasoningEnabled,
      reasoningEffortValue: reasoningEffort,
    });

    const response = await page.goto(`${proxyBase}/chat/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    assert((response?.status() || 0) < 400, `chat page HTTP ${response?.status()}`);
    logStep("chat page loaded");
    await page.waitForSelector("textarea", { timeout: 30000 });
    await page.fill("textarea", prompt);
    logStep("prompt filled");
    await page.locator('button[type="submit"]:not([disabled])').first().click();
    logStep("send clicked");

    const forbidden = /生成中断|生成失败|请求失败|Generation failed/i;
    let forbiddenText = "";
    const deadline = Date.now() + timeoutMs;
    let bodyText = "";
    let assistantTexts = [];
    while (Date.now() < deadline) {
      bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
      assistantTexts = await page.locator('[data-chat-message-row="true"][data-message-role="assistant"] .streaming-answer-markdown').evaluateAll((nodes) => nodes.map((node) => node.textContent || "")).catch(() => []);
      const match = bodyText.match(forbidden);
      if (match) {
        forbiddenText = bodyText.slice(Math.max(0, match.index - 200), Math.min(bodyText.length, match.index + 300));
        break;
      }
      if (assistantTexts.some((text) => expectPattern.test(text))) break;
      await page.waitForTimeout(500);
    }
    logStep("finished waiting for answer/error");
    assert(!forbiddenText, `live page showed forbidden interruption/error text: ${JSON.stringify(forbiddenText)}`);
    assert(assistantTexts.some((text) => expectPattern.test(text)), `live page did not show expected answer in assistant rows; assistantRows=${JSON.stringify(assistantTexts.slice(-3))} body=${JSON.stringify(bodyText.slice(0, 1500))}`);
    await page.waitForTimeout(800);
    bodyText = await page.locator("body").innerText({ timeout: 5000 });
    assistantTexts = await page.locator('[data-chat-message-row="true"][data-message-role="assistant"] .streaming-answer-markdown').evaluateAll((nodes) => nodes.map((node) => node.textContent || ""));
    const assistantMatches = assistantTexts.flatMap((text) => text.match(new RegExp(expectPattern.source, "gi")) || []);
    assert(assistantMatches.length === 1, `live page rendered expected answer ${assistantMatches.length} times in assistant rows; possible duplicate. assistantRows=${JSON.stringify(assistantTexts.slice(-3))} body=${JSON.stringify(bodyText.slice(0, 1500))}`);
    await page.waitForFunction(() => (document.querySelector('[data-chat-status-kind="completed"]')?.textContent || '').length > 0, null, { timeout: 30000 });
    const completedBadgeText = await page.locator('[data-chat-status-kind="completed"]').first().textContent({ timeout: 5000 });
    assert(/生成完成|Completed/.test(completedBadgeText || ""), `completed status badge missing expected label: ${JSON.stringify(completedBadgeText)}`);
    let timelineText = "";
    if (expectTimelineTexts.length) {
      await page.locator('[data-chat-status-kind="completed"]').first().click();
      await page.waitForFunction((expected) => {
        const text = Array.from(document.querySelectorAll('[data-chat-status-timeline="true"]'))
          .map((node) => node.textContent || "")
          .join("\n");
        return expected.every((item) => text.includes(item));
      }, expectTimelineTexts, { timeout: 30000 }).catch(async (error) => {
        const actualTimelineText = await page.locator('[data-chat-status-timeline="true"]').evaluateAll((nodes) => nodes.map((node) => node.textContent || "").join("\n")).catch(() => "");
        throw new Error(`${error.message}; actual timeline=${JSON.stringify(actualTimelineText)}`);
      });
      timelineText = await page.locator('[data-chat-status-timeline="true"]').first().textContent({ timeout: 5000 });
    }
    assert(chatResponses.some((r) => r.status < 400 && /text\/event-stream/.test(r.contentType)), `no successful chat event-stream response observed: ${JSON.stringify(chatResponses)}`);
    assert(issues.length === 0, `browser issues:\n${issues.slice(0, 12).join("\n")}`);

    Object.assign(report, {
      chatResponses,
      bodyTextLength: bodyText.length,
      answerMatches: assistantMatches.length,
      completedBadgeText,
      timelineTextLength: timelineText.length,
      elapsedMs: Date.now() - startedAt,
    });
    console.log(JSON.stringify(report, null, 2));
    console.log("chat real live-send e2e passed");
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolve) => proxy.close(resolve));
  }
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error(redact(err.stack || err.message || err));
  process.exit(1);
});
