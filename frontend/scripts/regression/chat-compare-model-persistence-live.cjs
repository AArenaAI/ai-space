#!/usr/bin/env node
const { chromium } = require('playwright');
const { env, printResult, summarizeConsole } = require('./chat-live-utils.cjs');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${url} ${res.status}: ${text.slice(0, 500)}`);
  return data;
}

async function loginWithCookie(baseUrl) {
  const email = env('TESTNET_EMAIL');
  const password = env('TESTNET_PASSWORD');
  if (!email || !password) throw new Error('Missing TESTNET_EMAIL or TESTNET_PASSWORD');
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`login ${res.status}: ${text.slice(0, 500)}`);
  const setCookie = res.headers.get('set-cookie') || '';
  const refreshMatch = setCookie.match(/ai_space_refresh_token=([^;,]+)/);
  return { ...data, refreshToken: refreshMatch?.[1] || '' };
}

async function createCompareConversation({ baseUrl, token, initialModels }) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const title = `Compare Persist Live ${Date.now()}`;
  const prompt = `${title}，只回答 OK`;
  const conversation = await jsonFetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title, model: initialModels[0] }),
  });
  await jsonFetch(`${baseUrl}/api/conversations/${conversation.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ compare: true, compare_models: JSON.stringify(initialModels) }),
  });
  const init = await jsonFetch(`${baseUrl}/api/chat/compare/init`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      conversation_id: conversation.id,
      content: prompt,
      model: initialModels[0],
      compare_models: initialModels,
    }),
  });
  for (let index = 0; index < initialModels.length; index += 1) {
    const model = initialModels[index];
    await jsonFetch(`${baseUrl}/api/chat/init`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
        init_only: true,
        conversation_id: conversation.id,
        reasoning_effort: 'fast',
        search: false,
        template_id: 0,
        skip_save_user_msg: true,
        group_id: init.group.id,
        user_message_id: init.user_message.id,
        group_index: index,
        group_models: initialModels,
      }),
    });
  }
  return conversation;
}

function parseCompareModels(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function fetchConversation({ baseUrl, token, conversationId }) {
  const data = await jsonFetch(`${baseUrl}/api/conversations/${conversationId}?message_tail=20`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    id: data.id || data.conversation?.id,
    compare: Boolean(data.compare ?? data.conversation?.compare),
    compareModels: parseCompareModels(data.compare_models ?? data.conversation?.compare_models),
  };
}

async function clickDeepSeekModelOption(page, trigger, targetName) {
  await trigger.click({ timeout: 5000 });
  await page.locator('div').filter({ hasText: /^DeepSeek\s*2$/i }).last().click({ timeout: 5000 }).catch(() => {});
  const pattern = new RegExp(escapeRegExp(targetName).replace(/\\s+/g, '\\s*'), 'i');
  const option = page.locator('button').filter({ hasText: pattern }).last();
  await option.waitFor({ state: 'visible', timeout: 10000 });
  await option.click({ timeout: 5000 });
  await page.waitForTimeout(650);
}

async function getCompareHeader(page) {
  const headerByTestId = page.locator('[data-testid="chat-compare-header"]').first();
  if (await headerByTestId.isVisible().catch(() => false)) return headerByTestId;
  const exit = page.locator('[data-testid="chat-compare-exit-center"]').first();
  if (await exit.isVisible().catch(() => false)) {
    return exit.locator('xpath=ancestor::div[contains(@class,"bg-surface/80")][1]');
  }
  const headerWithTwoSelectors = page.locator('div').filter({ has: page.locator('button').filter({ hasText: /GPT|DeepSeek|Kimi|Gemini|Claude|V4/i }) }).filter({ hasText: /GPT|DeepSeek|Kimi|Gemini|Claude|V4/i }).first();
  if (await headerWithTwoSelectors.isVisible().catch(() => false)) return headerWithTwoSelectors;
  return null;
}

async function ensureCompareHeader(page) {
  let header = await getCompareHeader(page);
  if (header) return header;
  const compareButton = page.locator('button[aria-label="Compare Mode"], button[aria-label="对比模式"]').first();
  await compareButton.click({ timeout: 8000 }).catch(async () => {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+C' : 'Control+Shift+C').catch(() => {});
  });
  await page.waitForTimeout(1200);
  header = await getCompareHeader(page);
  if (!header) throw new Error('compare header not visible after enabling Compare Mode');
  return header;
}

async function headerText(page) {
  const header = await ensureCompareHeader(page);
  return (await header.innerText()).replace(/\s+/g, ' ');
}

async function waitForRequestBody(page, predicate, timeout = 30000) {
  const req = await page.waitForRequest((request) => request.method() === 'POST' && predicate(request.url()), { timeout });
  const body = req.postData() || '{}';
  try { return JSON.parse(body); } catch { return { raw: body }; }
}

(async () => {
  const baseUrl = env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz');
  const targetModels = (env('COMPARE_PERSIST_TARGET_MODELS', 'deepseek-v4-pro,deepseek-v4-flash'))
    .split(',').map((item) => item.trim()).filter(Boolean).slice(0, 2);
  const initialModels = (env('COMPARE_PERSIST_INITIAL_MODELS', 'gpt-5.4,gpt-5.4-mini'))
    .split(',').map((item) => item.trim()).filter(Boolean).slice(0, 2);
  if (targetModels.length < 2 || initialModels.length < 2) throw new Error('Need two initial and target models');

  const auth = await loginWithCookie(baseUrl);
  const created = await createCompareConversation({ baseUrl, token: auth.token, initialModels });
  const browser = await chromium.launch({ headless: env('HEADFUL') !== '1' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  if (auth.refreshToken) {
    await context.addCookies([{ name: 'ai_space_refresh_token', value: auth.refreshToken, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
  }
  const page = await context.newPage();
  const consoleEvents = [];
  const pageErrors = [];
  page.on('console', (msg) => consoleEvents.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.removeItem('compare-models');
    if (user?.default_workspace_id) localStorage.setItem('current-workspace', String(user.default_workspace_id));
  }, { token: auth.token, user: auth.user });

  await page.goto(`${baseUrl}/chat/?id=${created.id}&compare_persist_live=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await ensureCompareHeader(page);
  const beforeHeader = await headerText(page);

  const header = await ensureCompareHeader(page);
  const triggers = header.locator('button').filter({ hasText: /GPT|DeepSeek|Kimi|Gemini|Claude|V4/i });
  await clickDeepSeekModelOption(page, triggers.nth(0), 'DeepSeek-V4 Pro');
  await clickDeepSeekModelOption(page, triggers.nth(1), 'DeepSeek-V4 Flash');
  await page.waitForTimeout(1200);
  const afterSelectHeader = await headerText(page);
  const persisted = await fetchConversation({ baseUrl, token: auth.token, conversationId: created.id });

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await ensureCompareHeader(page);
  const afterReloadHeader = await headerText(page);

  const compareBodyPromise = waitForRequestBody(page, (url) => url.includes('/api/chat/compare/init'));
  await page.locator('textarea').last().fill(`Compare persistence live ${Date.now()}，只回答 OK`);
  await page.locator('textarea').last().press('Enter');
  const compareBody = await compareBodyPromise;
  await page.waitForTimeout(1000);
  await browser.close();

  const requestModels = parseCompareModels(compareBody.compare_models);
  const result = {
    ok: false,
    conversationId: created.id,
    initialModels,
    targetModels,
    beforeHeader,
    afterSelectHeader,
    afterReloadHeader,
    persisted,
    requestModels,
    requestModel: compareBody.model,
    consoleErrors: summarizeConsole(consoleEvents),
    pageErrors,
  };
  result.ok = targetModels.every((model) => persisted.compareModels.includes(model))
    && targetModels.every((model) => requestModels.includes(model))
    && /V4 Pro/i.test(afterReloadHeader)
    && /V4 Flash/i.test(afterReloadHeader)
    && pageErrors.length === 0;
  printResult(result);
  if (!result.ok) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
