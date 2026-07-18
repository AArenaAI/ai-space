#!/usr/bin/env node
const { authHeaders, cleanupConversations, env, login, openAuthedPage, printResult, summarizeConsole } = require('./chat-live-utils.cjs');

const apiBaseUrl = trim(env('COMPARE_PERSIST_API_BASE_URL', env('REAL_CHAT_API_BASE_URL', env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz'))));
const frontendBaseUrl = trim(env('COMPARE_PERSIST_FRONTEND_BASE_URL', env('REAL_CHAT_FRONTEND_BASE_URL', apiBaseUrl)));
const initialModels = env('COMPARE_PERSIST_INITIAL_MODELS', 'gpt-5.4,gpt-5.4-mini').split(',').map((item) => item.trim()).filter(Boolean).slice(0, 2);
const targetModels = env('COMPARE_PERSIST_TARGET_MODELS', 'deepseek-v4-pro,deepseek-v4-flash').split(',').map((item) => item.trim()).filter(Boolean).slice(0, 2);

function trim(value) { return String(value || '').replace(/\/+$/, ''); }
function redact(value) {
  return String(value || '')
    .replace(/Bearer\s+[-._~+/=A-Za-z0-9]+/g, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9._-]+/g, '[REDACTED]')
    .replace(/(password|token|secret)(["'=:\s]+)([^"'\s,}]+)/gi, '$1$2[REDACTED]');
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function parseCompareModels(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}
async function apiJson(path, token, init = {}) {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(token), ...(init.headers || {}) },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} ${res.status}: ${redact(text.slice(0, 500))}`);
  return data;
}
async function selectModel(page, trigger, modelId) {
  await trigger.click({ timeout: 10000 });
  const provider = modelId.startsWith('deepseek') ? 'deepseek'
    : modelId.startsWith('gpt') ? 'openai'
    : modelId.startsWith('gemini') ? 'google'
    : modelId.startsWith('kimi') ? 'moonshot'
    : '';
  if (provider) {
    const providerNode = page.locator(`[data-testid="model-selector-provider-${provider}"]`).last();
    if (await providerNode.isVisible().catch(() => false)) await providerNode.hover();
  }
  const option = page.locator(`[data-testid="model-selector-option-${modelId}"]`).last();
  await option.waitFor({ state: 'visible', timeout: 15000 });
  await option.click({ timeout: 10000 });
  await page.waitForTimeout(800);
}
async function waitForPostBody(page, urlPattern, timeout = 30000) {
  const req = await page.waitForRequest((request) => request.method() === 'POST' && urlPattern.test(request.url()), { timeout });
  const body = req.postData() || '{}';
  try { return JSON.parse(body); } catch { return { raw: body }; }
}

(async () => {
  const startedAt = Date.now();
  const result = { apiBaseUrl, frontendBaseUrl, initialModels, targetModels, startedAt };
  let browser;
  let auth;
  let conversation;
  try {
    assert(initialModels.length === 2 && targetModels.length === 2, 'Need two initial and two target models');
    auth = await login({ baseUrl: apiBaseUrl });
    conversation = await apiJson('/api/conversations', auth, {
      method: 'POST',
      body: JSON.stringify({ title: `compare persist live ${startedAt}`, model: initialModels[0], compare: true, compare_models: JSON.stringify(initialModels) }),
    });
    await apiJson(`/api/conversations/${conversation.id}`, auth, {
      method: 'PUT',
      body: JSON.stringify({ compare: true, compare_models: JSON.stringify(initialModels) }),
    });

    const opened = await openAuthedPage({ baseUrl: frontendBaseUrl, auth, user: auth.user, sessionToken: auth.sessionToken, refreshToken: auth.refreshToken, viewport: { width: 1440, height: 980 } });
    browser = opened.browser;
    const page = opened.page;
    const consoleEvents = [];
    const pageErrors = [];
    const requestFailed = [];
    page.on('console', (msg) => consoleEvents.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
    page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));
    page.on('requestfailed', (request) => requestFailed.push({ method: request.method(), url: request.url(), failure: request.failure()?.errorText || '' }));
    await page.addInitScript(({ models }) => {
      localStorage.setItem('compare-mode', 'true');
      localStorage.setItem('compare-models', JSON.stringify(models));
      localStorage.setItem('search-enabled', 'false');
      localStorage.setItem('reasoning-enabled', 'false');
      localStorage.setItem('reasoning-mode', 'fast');
    }, { models: initialModels });

    await page.goto(`${frontendBaseUrl}/chat/?id=${conversation.id}&compare_persist_live=${startedAt}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    let header = page.locator('[data-testid="chat-compare-header"]').first();
    if (!(await header.isVisible().catch(() => false))) {
      await page.locator('[data-testid="chat-compare-toggle"]').last().click({ timeout: 10000 });
      header = page.locator('[data-testid="chat-compare-header"]').first();
    }
    await header.waitFor({ state: 'visible', timeout: 20000 });
    const beforeHeaderModels = await header.locator('[data-testid="model-selector-trigger"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-model-id')));
    const triggers = header.locator('[data-testid="model-selector-trigger"]');
    await selectModel(page, triggers.nth(0), targetModels[0]);
    await selectModel(page, triggers.nth(1), targetModels[1]);
    await page.waitForTimeout(1500);
    const afterSelectHeaderModels = await header.locator('[data-testid="model-selector-trigger"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-model-id')));
    const storageAfterSelect = await page.evaluate(() => ({ mode: localStorage.getItem('compare-mode'), models: localStorage.getItem('compare-models') }));
    const persistedAfterSelectData = await apiJson(`/api/conversations/${conversation.id}?message_tail=2`, auth);
    const persistedAfterSelect = parseCompareModels(persistedAfterSelectData.compare_models || persistedAfterSelectData.conversation?.compare_models);

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    const reloadHeader = page.locator('[data-testid="chat-compare-header"]').first();
    await reloadHeader.waitFor({ state: 'visible', timeout: 30000 });
    const afterReloadHeaderModels = await reloadHeader.locator('[data-testid="model-selector-trigger"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-model-id')));

    const compareBodyPromise = waitForPostBody(page, /\/api\/chat\/compare\/init\b/);
    await page.locator('textarea').last().fill(`Compare persistence live ${startedAt}：请只回答 OK`);
    await page.locator('button[type="submit"]:not([disabled])').last().click({ force: true });
    const compareBody = await compareBodyPromise;

    const consoleErrors = summarizeConsole(consoleEvents).filter((event) => event.type === 'error' && !/401|favicon|Failed to load resource/.test(event.text));
    result.beforeHeaderModels = beforeHeaderModels;
    result.afterSelectHeaderModels = afterSelectHeaderModels;
    result.storageAfterSelect = storageAfterSelect;
    result.persistedAfterSelect = persistedAfterSelect;
    result.afterReloadHeaderModels = afterReloadHeaderModels;
    result.requestModels = compareBody.compare_models;
    result.requestModel = compareBody.model;
    result.consoleErrors = consoleErrors;
    result.pageErrors = pageErrors;
    result.requestFailed = requestFailed.filter((item) => !/analytics|favicon|_rsc=/.test(item.url));
    result.ok = targetModels.every((model) => afterSelectHeaderModels.includes(model))
      && targetModels.every((model) => persistedAfterSelect.includes(model))
      && targetModels.every((model) => afterReloadHeaderModels.includes(model))
      && targetModels.every((model) => Array.isArray(compareBody.compare_models) && compareBody.compare_models.includes(model))
      && pageErrors.length === 0
      && consoleErrors.length === 0;
    assert(result.ok, `compare model persistence live failed: ${JSON.stringify(result, null, 2)}`);
  } finally {
    await browser?.close().catch(() => {});
    if (conversation?.id && auth?.token) {
      result.cleanup = await cleanupConversations({ baseUrl: apiBaseUrl, auth, conversationIds: [conversation.id] }).catch((error) => ({ error: error.message }));
    }
  }
  printResult(result);
  console.log('chat compare model persistence live passed');
})().catch((error) => {
  console.error(redact(error.stack || error.message || error));
  process.exit(1);
});
