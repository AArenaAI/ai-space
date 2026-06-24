#!/usr/bin/env node
const { env, login, apiGet, openAuthedPage, summarizeConsole, printResult } = require('./chat-live-utils.cjs');

(async () => {
  const baseUrl = env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz');
  const auth = await login({ baseUrl });
  const { browser, page } = await openAuthedPage({ baseUrl, token: auth.token, user: auth.user });
  const events = { requests: [], responses: [], console: [], errors: [] };
  page.on('request', (req) => { const u = req.url(); if (u.includes('/api/chat/bootstrap')) events.requests.push({ method: req.method(), url: u }); });
  page.on('response', (res) => { const u = res.url(); if (u.includes('/api/chat/bootstrap')) events.responses.push({ status: res.status(), url: u }); });
  page.on('console', (msg) => events.console.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (error) => events.errors.push(String(error).slice(0, 300)));

  await page.goto(`${baseUrl}/chat/?quick_switch=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-conversation-row]', { state: 'attached', timeout: 30000 });
  await page.waitForTimeout(1500);
  const visibleIds = await page.evaluate(() => Array.from(document.querySelectorAll('[data-conversation-id]')).map((el) => Number(el.getAttribute('data-conversation-id'))).filter(Boolean));
  const picked = [];
  for (const id of Array.from(new Set(visibleIds))) {
    const data = await apiGet(`/api/conversations/${id}/messages?limit=10`, auth.token, { baseUrl }).catch(() => ({ messages: [] }));
    const msg = (data.messages || []).find((item) => (item.content || '').trim().length > 8);
    if (msg) picked.push({ id, needle: msg.content.trim().slice(0, 18) });
    if (picked.length >= 3) break;
  }
  if (picked.length < 3) throw new Error(`need 3 visible conversations, got ${picked.length}`);
  const [a, b, c] = picked;
  await page.evaluate((ids) => {
    const rows = ids.map((id) => {
      const el = document.querySelector(`[data-conversation-id="${id}"]`);
      if (!el) throw new Error(`missing row ${id}`);
      return el;
    });
    rows.forEach((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })));
  }, [a.id, b.id, c.id]);
  await page.waitForURL(new RegExp(`[?&]id=${c.id}(&|$)`), { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const finalUrl = page.url();
  const mainText = await page.locator('main').innerText().catch(() => '');
  await browser.close();
  const finalId = new URL(finalUrl).searchParams.get('id');
  const oldNeedlesInMain = [a.needle, b.needle].filter((needle) => needle && mainText.includes(needle) && needle !== c.needle);
  const result = {
    picked,
    finalId,
    expected: String(c.id),
    finalHasNeedle: mainText.includes(c.needle),
    oldNeedlesInMain,
    requests: events.requests,
    responsesTail: events.responses.slice(-20),
    errors: events.errors,
    consoleErrors: summarizeConsole(events.console),
    mainTail: mainText.slice(-1000),
  };
  result.ok = finalId === String(c.id) && result.finalHasNeedle && oldNeedlesInMain.length === 0 && events.errors.length === 0;
  printResult(result);
  if (!result.ok) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
