#!/usr/bin/env node
const { env, login, openAuthedPage, summarizeConsole, printResult } = require('./chat-live-utils.cjs');

(async () => {
  const baseUrl = env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz');
  const missingId = Number(env('TESTNET_MISSING_CONVERSATION_ID') || 99999999);
  const auth = await login({ baseUrl });
  const { browser, page } = await openAuthedPage({ baseUrl, token: auth.token, user: auth.user });
  const events = { responses: [], console: [], errors: [] };
  page.on('response', (res) => { if (res.url().includes('/api/chat/bootstrap')) events.responses.push({ status: res.status(), url: res.url() }); });
  page.on('console', (msg) => events.console.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (error) => events.errors.push(String(error).slice(0, 300)));
  await page.goto(`${baseUrl}/chat/?id=${missingId}&state_check=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const body = await page.locator('body').innerText();
  await browser.close();
  const result = {
    missingId,
    hasNotFound: body.includes('对话不存在'),
    hasWelcome: body.includes('What can we do for you?') || body.includes('Hello,'),
    responses: events.responses,
    errors: events.errors,
    consoleErrors: summarizeConsole(events.console),
    bodyTail: body.slice(-800),
  };
  result.ok = result.hasNotFound && !result.hasWelcome && events.errors.length === 0;
  printResult(result);
  if (!result.ok) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
