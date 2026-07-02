#!/usr/bin/env node
const { chromium } = require('playwright');
const { env, login, printResult, summarizeConsole } = require('./chat-live-utils.cjs');

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${url} ${res.status}: ${text.slice(0, 500)}`);
  return data;
}

function yesterdayIso() {
  return new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
}

async function createConversation(baseUrl, token, title, model, updatedAt) {
  const conv = await jsonFetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title, model }),
  });
  await jsonFetch(`${baseUrl}/api/conversations/${conv.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title, updated_at: updatedAt }),
  }).catch(() => undefined);
  return conv;
}

async function sidebarSnapshot(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-conversation-row]')).map((row) => ({
      id: row.getAttribute('data-conversation-id'),
      text: (row.textContent || '').replace(/\s+/g, ' ').trim(),
    }));
    const labels = Array.from(document.querySelectorAll('button,div,span'))
      .map((el) => (el.textContent || '').trim())
      .filter((text) => ['今天', '昨天', '七天内', '30天内'].includes(text));
    return { rows, labels };
  });
}

(async () => {
  const baseUrl = env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz');
  const model = env('SIDEBAR_HISTORY_MODEL', env('REAL_CHAT_MODEL', 'deepseek-v4-flash'));
  const auth = await login({ baseUrl });
  const token = auth.token;
  const stamp = Date.now();
  const target = await createConversation(baseUrl, token, `Sidebar yesterday target ${stamp}`, model, yesterdayIso());
  const peer = await createConversation(baseUrl, token, `Sidebar yesterday peer ${stamp}`, model, yesterdayIso());
  const browser = await chromium.launch({ headless: env('HEADFUL') !== '1' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleEvents = [];
  const pageErrors = [];
  const requests = [];
  page.on('console', (msg) => consoleEvents.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));
  page.on('request', (req) => { const u = req.url(); if (u.includes('/api/conversations') || u.includes('/api/chat/bootstrap')) requests.push({ method: req.method(), url: u }); });
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  }, { token, user: auth.user });
  await page.goto(`${baseUrl}/chat/?id=${target.id}&sidebar_history_live=${stamp}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const before = await sidebarSnapshot(page);

  await page.locator('textarea').last().fill(`侧栏历史实时更新时间测试 ${stamp}`);
  await page.locator('textarea').last().press('Enter');
  await page.waitForTimeout(350);
  const immediate = await sidebarSnapshot(page);
  await page.waitForTimeout(4500);
  const delayed = await sidebarSnapshot(page);
  await browser.close();

  const targetId = String(target.id);
  const peerId = String(peer.id);
  const targetImmediate = immediate.rows.find((row) => row.id === targetId);
  const targetDelayed = delayed.rows.find((row) => row.id === targetId);
  const peerDelayed = delayed.rows.find((row) => row.id === peerId);
  const canonicalFetch = requests.some((r) => r.url.includes('/api/conversations') && r.url.includes('limit=500'));
  const result = {
    targetId: target.id,
    peerId: peer.id,
    before,
    immediate,
    delayed,
    canonicalFetch,
    requests,
    consoleErrors: summarizeConsole(consoleEvents),
    pageErrors,
  };
  result.ok = Boolean(targetImmediate)
    && Boolean(targetDelayed)
    && Boolean(peerDelayed)
    && canonicalFetch
    && pageErrors.length === 0;
  printResult(result);
  if (!result.ok) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
