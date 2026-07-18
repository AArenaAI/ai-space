#!/usr/bin/env node
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { addAuthCookies } = require("./chat-live-utils.cjs");

const baseUrl = process.env.CHAT_BOOTSTRAP_SHELL_BASE_URL || "https://testnet.ai-space.xyz";
const email = process.env.TESTNET_EMAIL || "changsheng010909@gmail.com";
const password = process.argv[2] || process.env.TESTNET_PASSWORD;

if (!password) {
  console.error("Missing TESTNET_PASSWORD or password argument");
  process.exit(2);
}

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const text = await response.text();
  assert.equal(response.ok, true, `login failed ${response.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text);
  const setCookie = response.headers.get('set-cookie') || '';
  data.sessionToken = setCookie.match(/ai_space_session=([^;,]+)/)?.[1] || '';
  data.refreshToken = setCookie.match(/ai_space_refresh_token=([^;,]+)/)?.[1] || '';
  return data;
}

async function openConversation(browser, auth, id) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await addAuthCookies(context, { baseUrl, auth });
  const page = await context.newPage();
  const errors = [];
  const responses = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/api/chat/bootstrap") || url.includes("/api/conversations")) {
      responses.push({ url, status: response.status() });
    }
  });

  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ token, user }) => {
    localStorage.clear();
    localStorage.removeItem("token");
    localStorage.removeItem("admin_token");
    localStorage.setItem("user", JSON.stringify(user));
    if (user?.default_workspace_id) localStorage.setItem("current-workspace", String(user.default_workspace_id));
  }, { user: auth.user });

  await page.goto(`${baseUrl}/chat/?id=${id}`, { waitUntil: "domcontentloaded" });
  const early = await page.evaluate(() => ({
    hasEmptyHistory: document.body.innerText.includes("暂无对话") || document.body.innerText.includes("No conversations"),
    hasLogin: document.body.innerText.includes("登录") && document.body.innerText.includes("密码"),
    textHead: document.body.innerText.slice(0, 500),
  }));
  await page.waitForSelector('[data-testid="chat-history-scroll-container"], [data-testid="chat-message-list"]', { timeout: 30_000 });
  await page.waitForTimeout(3500);
  const finalState = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-chat-message-row="true"]')];
    const compareLikeRows = rows.filter((row) => [...row.querySelectorAll("div")].some((node) => {
      const className = node.getAttribute("class") || "";
      return className.includes("items-stretch") && className.includes("gap-4") && node.children.length >= 2;
    }));
    return {
      rowCount: rows.length,
      compareLikeRows: compareLikeRows.length,
      assistantRows: rows.filter((row) => row.getAttribute("data-message-role") === "assistant").length,
      userRows: rows.filter((row) => row.getAttribute("data-message-role") === "user").length,
      hasEmptyHistory: document.body.innerText.includes("暂无对话") || document.body.innerText.includes("No conversations"),
      hasLogin: document.body.innerText.includes("登录") && document.body.innerText.includes("密码"),
      resources: performance.getEntriesByType("resource")
        .filter((entry) => entry.name.includes("/api/chat/bootstrap") || entry.name.includes("/api/conversations"))
        .map((entry) => entry.name),
    };
  });
  await page.close();
  return { id, early, finalState, responses, errors };
}

async function openConversationWithBootstrapFailure(browser, auth, id) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await addAuthCookies(context, { baseUrl, auth });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/chat/bootstrap**", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "forced bootstrap failure" }),
  }));

  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ token, user }) => {
    localStorage.clear();
    localStorage.removeItem("token");
    localStorage.removeItem("admin_token");
    localStorage.setItem("user", JSON.stringify(user));
    if (user?.default_workspace_id) localStorage.setItem("current-workspace", String(user.default_workspace_id));
  }, { user: auth.user });

  await page.goto(`${baseUrl}/chat/?id=${id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="chat-history-scroll-container"], [data-testid="chat-message-list"]', { timeout: 30_000 });
  await page.waitForTimeout(3500);
  const finalState = await page.evaluate(() => ({
    rowCount: document.querySelectorAll('[data-chat-message-row="true"]').length,
    hasLogin: document.body.innerText.includes("登录") && document.body.innerText.includes("密码"),
    resources: performance.getEntriesByType("resource")
      .filter((entry) => entry.name.includes("/api/chat/bootstrap") || entry.name.includes("/api/conversations"))
      .map((entry) => entry.name),
  }));
  await page.close();
  return { id, finalState, errors };
}

function assertOnlyCurrentBootstrap(result) {
  assert.equal(result.errors.length, 0, `${result.id} console/page errors: ${result.errors.join("\n")}`);
  assert.equal(result.early.hasLogin, false, `${result.id} should not show login early`);
  assert.equal(result.finalState.hasLogin, false, `${result.id} should not show login final`);
  assert.equal(result.early.hasEmptyHistory, false, `${result.id} should not flash empty history before bootstrap`);
  assert.equal(result.finalState.hasEmptyHistory, false, `${result.id} should not show empty history final`);
  assert.ok(result.finalState.rowCount > 0, `${result.id} should render chat rows`);
  const conversationListCalls = result.finalState.resources.filter((url) => url.includes("/api/conversations?"));
  assert.deepEqual(conversationListCalls, [], `${result.id} should not call legacy conversations list: ${JSON.stringify(conversationListCalls)}`);
  const bootstrapCalls = result.finalState.resources.filter((url) => url.includes("/api/chat/bootstrap"));
  assert.equal(bootstrapCalls.length, 1, `${result.id} should issue exactly one bootstrap call: ${JSON.stringify(bootstrapCalls)}`);
  assert.ok(bootstrapCalls[0].includes(`id=${result.id}`), `${result.id} bootstrap should target current conversation: ${bootstrapCalls[0]}`);
}

(async () => {
  const auth = await login();
  const browser = await chromium.launch({ headless: true });
  try {
    const result903 = await openConversation(browser, auth, "903");
    assertOnlyCurrentBootstrap(result903);
    assert.equal(result903.finalState.compareLikeRows, 0, "903 should render normal layout");

    const result12 = await openConversation(browser, auth, "12");
    assertOnlyCurrentBootstrap(result12);
    assert.equal(result12.finalState.compareLikeRows, 0, "12 is normal mode and must not become full compare layout just because grouped metadata exists");
    assert.ok(result12.finalState.assistantRows > 0, "12 should render normal assistant rows");

    const result762 = await openConversation(browser, auth, "762");
    assertOnlyCurrentBootstrap(result762);

    const fallback903 = await openConversationWithBootstrapFailure(browser, auth, "903");
      const unexpectedFallbackErrors = fallback903.errors.filter((message) => !message.includes("503") && !message.includes("Service Unavailable"));
    assert.equal(unexpectedFallbackErrors.length, 0, `fallback console/page errors: ${unexpectedFallbackErrors.join("\n")}`);
    assert.equal(fallback903.finalState.hasLogin, false, "fallback should not show login");
    assert.ok(fallback903.finalState.rowCount > 0, "fallback should render rows from legacy restore when bootstrap fails");
    assert.ok(
      fallback903.finalState.resources.some((url) => url.includes("/api/conversations/903?message_tail")),
      `fallback should call legacy conversation restore: ${JSON.stringify(fallback903.finalState.resources)}`
    );

    console.log(JSON.stringify({
      ok: true,
      checked: [result903, result12, result762].map((r) => ({ id: r.id, rows: r.finalState.rowCount, compareLikeRows: r.finalState.compareLikeRows, resources: r.finalState.resources.length })),
      fallback: { id: fallback903.id, rows: fallback903.finalState.rowCount, resources: fallback903.finalState.resources },
    }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
