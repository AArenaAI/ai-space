#!/usr/bin/env node
const { chromium } = require('playwright');
const { env, login, printResult } = require('./chat-live-utils.cjs');

const baseUrl = env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz');
const prompt = env('FINAL_RENDER_PROMPT', [
  '这是一个前端流式完成态稳定性测试。',
  '请只输出从 B001 到 B120 的编号，每 12 个编号换一行。',
  '不要解释，不要标题，不要 Markdown 表格，不要额外文字。',
].join('\n'));

async function openAuthedPage(token, user) {
  const browser = await chromium.launch({ headless: env('HEADFUL') !== '1' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    if (user?.default_workspace_id) localStorage.setItem('current-workspace', String(user.default_workspace_id));
  }, { token, user });
  return { browser, page };
}

async function latestAssistantSnapshot(page, label) {
  return page.evaluate((label) => {
    const rows = Array.from(document.querySelectorAll('[data-chat-message-row="true"][data-message-role="assistant"]'));
    const row = rows[rows.length - 1];
    const stableLayer = row?.querySelector('[data-chat-answer-stable-layer="true"]');
    const answer = row?.querySelector('.streaming-answer-markdown') || stableLayer;
    const renderer = row?.querySelector('[data-chat-answer-renderer="true"]');
    const text = answer?.textContent || row?.textContent || '';
    return {
      label,
      at: Date.now(),
      rowId: row?.getAttribute('data-message-id') || '',
      rowHeight: row?.getBoundingClientRect().height || 0,
      hasStableLayer: Boolean(stableLayer),
      renderState: renderer?.getAttribute('data-chat-answer-render-state') || '',
      contentSource: stableLayer?.getAttribute('data-chat-answer-content-source') || '',
      canonicalMatch: stableLayer?.getAttribute('data-chat-answer-canonical-match') || '',
      text,
      b001Count: (text.match(/B001/g) || []).length,
      b120Count: (text.match(/B120/g) || []).length,
      hasB001: text.includes('B001'),
      hasB120: text.includes('B120'),
      spinnerCount: row?.querySelectorAll('.animate-spin,[data-chat-status-icon="spinning"]').length || 0,
    };
  }, label);
}

async function waitForAssistant(page, timeout = 120000) {
  await page.waitForFunction(() => document.querySelectorAll('[data-chat-message-row="true"][data-message-role="assistant"]').length > 0, null, { timeout });
}

async function waitForDone(page, timeout = 180000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) {
    last = await latestAssistantSnapshot(page, 'poll');
    const body = await page.evaluate(() => document.body.innerText);
    const stopVisible = /停止|Stop/.test(body) && Boolean(document.querySelector('button svg'));
    const renderTerminalish = last.renderState === 'settling' || last.renderState === 'hydrated' || last.renderState === 'completed-stable';
    if ((last.hasB120 || /B120/.test(body)) && renderTerminalish && !stopVisible) return last;
    await page.waitForTimeout(1000);
  }
  throw new Error(`timed out waiting for completed answer; last=${JSON.stringify(last)}`);
}

(async () => {
  const auth = await login();
  const token = auth.token || auth.access_token;
  const user = auth.user || auth;
  if (!token) throw new Error('login did not return token');
  const { browser, page } = await openAuthedPage(token, user);
  const consoleEvents = [];
  const pageErrors = [];
  const requestfailed = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') consoleEvents.push({ type: msg.type(), text: msg.text().slice(0, 500) });
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('requestfailed', (req) => requestfailed.push({ url: req.url(), failure: req.failure()?.errorText }));

  try {
    await page.goto(`${baseUrl}/chat?final_render_probe=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('textarea', { timeout: 30000 });
    await page.evaluate((prompt) => {
      const visibleTextareas = Array.from(document.querySelectorAll('textarea'))
        .filter((node) => node instanceof HTMLTextAreaElement && !node.disabled && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
      const textarea = visibleTextareas.at(-1);
      if (!textarea) throw new Error('missing visible textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, prompt);
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      textarea.focus();
    }, prompt);
    const submit = page.locator('form').filter({ has: page.locator('textarea') }).last().locator('button[type="submit"]').last();
    await submit.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForFunction(() => {
      const visibleTextareas = Array.from(document.querySelectorAll('textarea'))
        .filter((node) => node instanceof HTMLTextAreaElement && !node.disabled && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
      return visibleTextareas.some((textarea) => textarea.value.trim());
    }, null, { timeout: 30000 });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
    await page.waitForTimeout(800);
    const assistantCountAfterHotkey = await page.locator('[data-chat-message-row="true"][data-message-role="assistant"]').count();
    if (assistantCountAfterHotkey === 0) await submit.click({ force: true });
    await waitForAssistant(page);

    await page.waitForFunction(() => {
      const rows = Array.from(document.querySelectorAll('[data-chat-message-row="true"][data-message-role="assistant"]'));
      const row = rows[rows.length - 1];
      return Boolean(row && (row.textContent || '').trim().length > 0);
    }, null, { timeout: 120000 });
    const streaming = await latestAssistantSnapshot(page, 'streaming');

    await waitForDone(page);
    const doneInstant = await latestAssistantSnapshot(page, 'done-instant');
    await page.waitForTimeout(300);
    const done300 = await latestAssistantSnapshot(page, 'done+300ms');
    await page.waitForTimeout(900);
    const done1200 = await latestAssistantSnapshot(page, 'done+1200ms');

    const snapshots = [streaming, doneInstant, done300, done1200];
    const completion = [doneInstant, done300, done1200];
    const issues = [];
    const rowIds = new Set(snapshots.map((s) => s.rowId).filter(Boolean));
    if (rowIds.size > 1) issues.push(`row id changed: ${JSON.stringify(snapshots.map((s) => ({ label: s.label, rowId: s.rowId })))}`);
    const missingStable = completion.filter((s) => !s.hasStableLayer);
    if (missingStable.length) issues.push(`stable layer missing after completion: ${JSON.stringify(missingStable)}`);
    const duplicate = completion.find((s) => s.b001Count > 1 || s.b120Count > 1);
    if (duplicate) issues.push(`B tokens duplicated: ${JSON.stringify(duplicate)}`);
    const missingB = completion.find((s) => !s.hasB001 || !s.hasB120);
    if (missingB) issues.push(`B001/B120 missing after completion: ${JSON.stringify(missingB)}`);
    const heights = completion.map((s) => s.rowHeight).filter(Boolean);
    if (heights.length && Math.max(...heights) - Math.min(...heights) > 80) issues.push(`height shifted: ${JSON.stringify(completion.map((s) => ({ label: s.label, rowHeight: s.rowHeight, renderState: s.renderState })))}`);
    const badErrors = consoleEvents.filter((e) => !/favicon|ResizeObserver/i.test(e.text));

    printResult({ ok: issues.length === 0 && pageErrors.length === 0, issues, snapshots, consoleEvents: badErrors.slice(-10), pageErrors, requestfailed: requestfailed.slice(-10), url: page.url() });
    if (issues.length || pageErrors.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
