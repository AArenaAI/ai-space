#!/usr/bin/env node
const { chromium } = require('playwright');
const { authHeaders, env, login, printResult, summarizeConsole } = require('./chat-live-utils.cjs');

async function waitForMarkdownBlocks(page) {
  try {
    await page.waitForSelector('[data-md-block-id]', { state: 'attached', timeout: 60000 });
  } catch {
    const diagnostic = await page.evaluate(() => ({
      text: (document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 1200),
      assistantRows: document.querySelectorAll('[data-chat-message-row="true"][data-message-role="assistant"]').length,
      assistantTexts: Array.from(document.querySelectorAll('[data-chat-message-row="true"][data-message-role="assistant"]')).map((row) => (row.textContent || '').replace(/\s+/g, ' ').slice(0, 240)),
      blockCount: document.querySelectorAll('[data-md-block-id]').length,
      tokenRenderers: document.querySelectorAll('[data-markdown-token-renderer]').length,
    }));
    throw new Error(`markdown blocks did not appear: ${JSON.stringify(diagnostic)}`);
  }
  await page.waitForTimeout(1200);
}

async function sampleAnchor(page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('[data-chat-scroll-container="true"]') || document.scrollingElement || document.documentElement;
    const containerRect = scroller instanceof HTMLElement ? scroller.getBoundingClientRect() : { top: 0 };
    const blocks = Array.from(document.querySelectorAll('[data-md-block-id]'));
    const visible = blocks.find((block) => {
      const rect = block.getBoundingClientRect();
      return rect.bottom >= containerRect.top + 24;
    });
    const row = visible?.closest('[data-chat-message-row="true"][data-message-id]');
    const rect = visible?.getBoundingClientRect();
    const rowBlocks = row ? Array.from(row.querySelectorAll('[data-md-block-id]')) : [];
    const conversationId = new URLSearchParams(location.search).get('id') || '';
    const savedRaw = conversationId ? sessionStorage.getItem(`ai-space-chat-scroll:${conversationId}`) : null;
    let saved = null;
    try { saved = savedRaw ? JSON.parse(savedRaw) : null; } catch {}
    return {
      conversationId,
      rowId: row?.getAttribute('data-message-id') || '',
      serverMessageId: row?.getAttribute('data-server-message-id') || '',
      blockId: visible?.getAttribute('data-md-block-id') || '',
      blockIndex: visible ? rowBlocks.indexOf(visible) : -1,
      blockTop: Math.round((rect?.top || 0) - containerRect.top),
      blockCount: blocks.length,
      saved,
    };
  });
}

(async () => {
  const baseUrl = env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz');
  const conversationId = Number(env('ANCHOR_CONVERSATION_ID', '1310'));
  const auth = await login({ baseUrl });
  const browser = await chromium.launch({ headless: env('HEADFUL') !== '1' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const cookies = [];
  if (auth.sessionToken) cookies.push({ name: 'ai_space_session', value: auth.sessionToken, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, secure: baseUrl.startsWith('https:'), sameSite: 'Lax' });
  if (auth.refreshToken) cookies.push({ name: 'ai_space_refresh_token', value: auth.refreshToken, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, secure: baseUrl.startsWith('https:'), sameSite: 'Lax' });
  if (cookies.length) await context.addCookies(cookies);
  const page = await context.newPage();
  const consoleEvents = [];
  const pageErrors = [];
  page.on('console', (msg) => consoleEvents.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));
  await page.addInitScript(({ user }) => {
    localStorage.removeItem('token');
    localStorage.removeItem('admin_token');
    localStorage.setItem('user', JSON.stringify(user));
    if (user?.default_workspace_id) localStorage.setItem('current-workspace', String(user.default_workspace_id));
    localStorage.setItem('reasoning-mode', 'fast');
    localStorage.setItem('reasoning-enabled', 'false');
    localStorage.setItem('search-enabled', 'false');
    localStorage.setItem('theme', 'dark');
  }, { auth, user: auth.user });

  await page.goto(`${baseUrl}/chat/?id=${conversationId}&block_anchor=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForMarkdownBlocks(page);
  await page.evaluate(() => {
    const scroller = document.querySelector('[data-chat-scroll-container="true"]') || document.scrollingElement || document.documentElement;
    if ('scrollTop' in scroller) scroller.scrollTop = Math.round((scroller.scrollHeight - scroller.clientHeight) * 0.42);
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await page.waitForTimeout(700);
  const before = await sampleAnchor(page);
  await page.goto(`${baseUrl}/chat/?anchor_other=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(700);
  await page.goto(`${baseUrl}/chat/?id=${conversationId}&block_anchor_return=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForMarkdownBlocks(page);
  await page.waitForTimeout(1400);
  const after = await sampleAnchor(page);
  await browser.close();

  const failures = [];
  if (!before.blockId) failures.push('before anchor block missing');
  if (!before.saved?.anchorBlockId) failures.push('saved anchorBlockId missing');
  if (before.saved?.anchorBlockId !== before.blockId && before.saved?.anchorBlockIndex !== before.blockIndex) failures.push(`saved anchor mismatch ${before.saved?.anchorBlockId}#${before.saved?.anchorBlockIndex} != ${before.blockId}#${before.blockIndex}`);
  if (after.blockId !== before.blockId && after.blockIndex !== before.blockIndex) failures.push(`restored block mismatch ${before.blockId}#${before.blockIndex} -> ${after.blockId}#${after.blockIndex}`);
  if (Math.abs(after.blockTop - before.blockTop) > 16) failures.push(`restored block offset drift ${before.blockTop} -> ${after.blockTop}`);
  if (pageErrors.length) failures.push(`page errors: ${pageErrors.join('; ')}`);

  printResult({ ok: failures.length === 0, baseUrl, conversationId, failures, before, after, consoleErrors: summarizeConsole(consoleEvents), pageErrors });
  if (failures.length) process.exit(2);
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
