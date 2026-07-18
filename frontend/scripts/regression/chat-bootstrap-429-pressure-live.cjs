#!/usr/bin/env node
const { authHeaders, env, login, openAuthedPage, summarizeConsole, printResult } = require('./chat-live-utils.cjs');

async function apiJson(url, token, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(token), ...(init.headers || {}) },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${url} ${res.status}: ${text.slice(0, 500)}`);
  return data;
}

async function createConversation(baseUrl, token, title, model) {
  return apiJson(`${baseUrl}/api/conversations`, token, {
    method: 'POST',
    body: JSON.stringify({ title, model }),
  });
}

async function clickConversation(page, id, delayMs = 0) {
  await page.waitForFunction((convId) => Boolean(document.querySelector(`[data-conversation-id="${convId}"]`)), id, { timeout: 30000 });
  await page.evaluate((convId) => {
    const el = document.querySelector(`[data-conversation-id="${convId}"]`);
    if (!el) throw new Error(`missing conversation ${convId}`);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }, id);
  if (delayMs) await page.waitForTimeout(delayMs);
}

(async () => {
  const baseUrl = env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz');
  const model = env('BOOTSTRAP_429_MODEL', 'gpt-5.4-mini');
  const switchCount = Number(env('BOOTSTRAP_429_SWITCH_COUNT', '18'));
  const switchDelayMs = Number(env('BOOTSTRAP_429_SWITCH_DELAY_MS', '180'));
  const auth = await login({ baseUrl });
  const stamp = Date.now();
  const conversations = [];
  for (let i = 0; i < 3; i += 1) {
    conversations.push(await createConversation(baseUrl, auth, `Bootstrap 429 Probe ${stamp}-${i}`, model));
  }

  const { browser, page } = await openAuthedPage({ baseUrl, auth, user: auth.user, sessionToken: auth.sessionToken, refreshToken: auth.refreshToken });
  const responses = [];
  const failed = [];
  const consoleMessages = [];
  const pageErrors = [];
  page.on('response', (res) => {
    const url = res.url();
    if (url.includes('/api/chat/bootstrap')) responses.push({ status: res.status(), url });
  });
  page.on('requestfailed', (req) => {
    if (req.url().includes('/api/chat/bootstrap')) failed.push({ url: req.url(), failure: req.failure()?.errorText || '' });
  });
  page.on('console', (msg) => consoleMessages.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));

  await page.goto(`${baseUrl}/chat/?bootstrap_429_probe=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-conversation-row]', { state: 'attached', timeout: 30000 });
  for (let i = 0; i < switchCount; i += 1) {
    await clickConversation(page, conversations[i % conversations.length].id, switchDelayMs);
  }
  await page.waitForTimeout(Number(env('BOOTSTRAP_429_SETTLE_MS', '8000')));
  const currentUrl = page.url();
  await browser.close();

  const statusCounts = responses.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  const result = {
    ok: (statusCounts[429] || 0) === 0 && pageErrors.length === 0,
    currentUrl,
    conversationIds: conversations.map((c) => c.id),
    switchCount,
    switchDelayMs,
    bootstrapResponses: responses.length,
    statusCounts,
    failed,
    consoleErrors: summarizeConsole(consoleMessages),
    pageErrors,
  };
  printResult(result);
  if (!result.ok) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
