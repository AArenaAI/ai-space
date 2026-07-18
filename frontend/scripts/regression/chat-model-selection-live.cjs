#!/usr/bin/env node
const { authHeaders, cleanupConversations, env, login, openAuthedPage, printResult, summarizeConsole } = require('./chat-live-utils.cjs');

const apiBaseUrl = trim(env('MODEL_SELECTION_API_BASE_URL', env('REAL_CHAT_API_BASE_URL', env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz'))));
const frontendBaseUrl = trim(env('MODEL_SELECTION_FRONTEND_BASE_URL', env('REAL_CHAT_FRONTEND_BASE_URL', apiBaseUrl)));
const normalTarget = env('MODEL_SELECTION_NORMAL_TARGET', 'deepseek-v4-flash');
const normalTargetName = env('MODEL_SELECTION_NORMAL_TARGET_NAME', 'DeepSeek-V4 Flash');
const compareTargets = env('MODEL_SELECTION_COMPARE_TARGETS', 'deepseek-v4-pro,deepseek-v4-flash').split(',').map((item) => item.trim()).filter(Boolean).slice(0, 2);
const timeoutMs = Number(env('MODEL_SELECTION_TIMEOUT_MS', '90000'));

function trim(value) { return String(value || '').replace(/\/+$/, ''); }
function redact(value) {
  return String(value || '')
    .replace(/Bearer\s+[-._~+/=A-Za-z0-9]+/g, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9._-]+/g, '[REDACTED]')
    .replace(/(password|token|secret)(["'=:\s]+)([^"'\s,}]+)/gi, '$1$2[REDACTED]');
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
function assert(condition, message) {
  if (!condition) throw new Error(message);
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
  await page.waitForTimeout(700);
}
async function waitForPostBody(page, urlPattern, timeout = 30000) {
  const req = await page.waitForRequest((request) => request.method() === 'POST' && urlPattern.test(request.url()), { timeout });
  const body = req.postData() || '{}';
  try { return JSON.parse(body); } catch { return { raw: body }; }
}
async function waitForUiAnswer(page, needle) {
  await page.waitForFunction((text) => document.body.innerText.includes(text), needle, { timeout: timeoutMs });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="chat-stop-button"]').length === 0 && document.querySelectorAll('[data-chat-pending-shell="true"]').length === 0, undefined, { timeout: timeoutMs }).catch(() => {});
}

(async () => {
  const startedAt = Date.now();
  const result = { apiBaseUrl, frontendBaseUrl, normalTarget, normalTargetName, compareTargets, startedAt };
  let browser;
  let auth;
  const cleanupIds = [];
  try {
    assert(compareTargets.length === 2, 'Need exactly two compare target models');
    auth = await login({ baseUrl: apiBaseUrl });
    const opened = await openAuthedPage({ baseUrl: frontendBaseUrl, auth, user: auth.user, sessionToken: auth.sessionToken, refreshToken: auth.refreshToken, viewport: { width: 1440, height: 980 } });
    browser = opened.browser;
    const page = opened.page;
    const consoleEvents = [];
    const pageErrors = [];
    const requestFailed = [];
    page.on('console', (msg) => consoleEvents.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
    page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));
    page.on('requestfailed', (request) => requestFailed.push({ method: request.method(), url: request.url(), failure: request.failure()?.errorText || '' }));

    const normalConv = await apiJson('/api/conversations', auth, { method: 'POST', body: JSON.stringify({ title: `model normal live ${startedAt}`, model: 'gpt-5.4-mini' }) });
    cleanupIds.push(normalConv.id);
    await page.addInitScript(({ selected }) => {
      localStorage.setItem('selected-model', selected);
      localStorage.setItem('recent-models', JSON.stringify([selected]));
      localStorage.removeItem('compare-mode');
      localStorage.removeItem('compare-models');
      localStorage.setItem('search-enabled', 'false');
      localStorage.setItem('reasoning-enabled', 'false');
      localStorage.setItem('reasoning-mode', 'fast');
    }, { selected: 'gpt-5.4-mini' });

    await page.goto(`${frontendBaseUrl}/chat/?id=${normalConv.id}&model_selection_live=${startedAt}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForSelector('[data-testid="model-selector-trigger"]', { timeout: 30000 });
    await selectModel(page, page.locator('header [data-testid="model-selector-trigger"]').first(), normalTarget);
    const normalBeforeReload = await page.evaluate(() => ({ selected: localStorage.getItem('selected-model'), recent: localStorage.getItem('recent-models') }));
    let normalPersistedModel = '';
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const conversationData = await apiJson(`/api/conversations/${normalConv.id}?message_tail=2`, auth);
      normalPersistedModel = conversationData.model || conversationData.conversation?.model || '';
      if (normalPersistedModel === normalTarget) break;
      await page.waitForTimeout(400);
    }
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    const normalTriggerAfterReload = page.locator('header [data-testid="model-selector-trigger"]').first();
    await normalTriggerAfterReload.waitFor({ state: 'visible', timeout: 30000 });
    const normalReloadModelId = await normalTriggerAfterReload.getAttribute('data-model-id');
    const normalPromptToken = `MODEL_NORMAL_OK_${startedAt}`;
    const normalBodyPromise = waitForPostBody(page, /\/api\/chat\/init\b/);
    await page.locator('textarea').last().fill(`模型选择普通 live：请只回答 ${normalPromptToken}`);
    await page.locator('button[type="submit"]:not([disabled])').last().click({ force: true });
    const normalBody = await normalBodyPromise;
    await waitForUiAnswer(page, normalPromptToken).catch(() => {});
    result.normal = { beforeReload: normalBeforeReload, persistedModel: normalPersistedModel, reloadModelId: normalReloadModelId, requestModel: normalBody.model };

    const compareConv = await apiJson('/api/conversations', auth, { method: 'POST', body: JSON.stringify({ title: `model compare live ${startedAt}`, model: 'gpt-5.4-mini' }) });
    cleanupIds.push(compareConv.id);
    await page.goto(`${frontendBaseUrl}/chat/?id=${compareConv.id}&model_selection_compare_live=${startedAt}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.locator('[data-testid="chat-compare-toggle"]').last().click({ timeout: 10000 });
    const compareHeader = page.locator('[data-testid="chat-compare-header"]').first();
    await compareHeader.waitFor({ state: 'visible', timeout: 15000 });
    const compareTriggers = compareHeader.locator('[data-testid="model-selector-trigger"]');
    await selectModel(page, compareTriggers.nth(0), compareTargets[0]);
    await selectModel(page, compareTriggers.nth(1), compareTargets[1]);
    await page.waitForTimeout(1200);
    const compareHeaderIds = await compareHeader.locator('[data-testid="model-selector-trigger"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-model-id')));
    const compareStorage = await page.evaluate(() => ({ mode: localStorage.getItem('compare-mode'), models: localStorage.getItem('compare-models') }));
    const comparePersisted = await apiJson(`/api/conversations/${compareConv.id}?message_tail=2`, auth).then((data) => data.compare_models || data.conversation?.compare_models || '').catch((error) => `ERROR: ${error.message}`);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    const reloadedHeader = page.locator('[data-testid="chat-compare-header"]').first();
    await reloadedHeader.waitFor({ state: 'visible', timeout: 30000 });
    const compareReloadIds = await reloadedHeader.locator('[data-testid="model-selector-trigger"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-model-id')));
    const comparePromptToken = `MODEL_COMPARE_OK_${startedAt}`;
    const compareBodyPromise = waitForPostBody(page, /\/api\/chat\/compare\/init\b/);
    await page.locator('textarea').last().fill(`模型选择对比 live：请只回答 ${comparePromptToken}`);
    await page.locator('button[type="submit"]:not([disabled])').last().click({ force: true });
    const compareBody = await compareBodyPromise;
    result.compare = { headerIds: compareHeaderIds, storage: compareStorage, persistedRaw: comparePersisted, reloadIds: compareReloadIds, requestModels: compareBody.compare_models, requestModel: compareBody.model };

    const consoleErrors = summarizeConsole(consoleEvents).filter((event) => event.type === 'error' && !/401|favicon|Failed to load resource/.test(event.text));
    result.consoleErrors = consoleErrors;
    result.pageErrors = pageErrors;
    result.requestFailed = requestFailed.filter((item) => !/analytics|favicon|_rsc=/.test(item.url));
    const persistedParsed = typeof comparePersisted === 'string' ? (() => { try { return JSON.parse(comparePersisted); } catch { return []; } })() : comparePersisted;
    result.ok = normalBeforeReload.selected === normalTarget
      && normalPersistedModel === normalTarget
      && normalReloadModelId === normalTarget
      && normalBody.model === normalTarget
      && compareTargets.every((id) => compareHeaderIds.includes(id))
      && compareTargets.every((id) => compareReloadIds.includes(id))
      && compareTargets.every((id) => Array.isArray(persistedParsed) && persistedParsed.includes(id))
      && compareTargets.every((id) => Array.isArray(compareBody.compare_models) && compareBody.compare_models.includes(id))
      && pageErrors.length === 0
      && consoleErrors.length === 0;
    assert(result.ok, `model selection live failed: ${JSON.stringify(result, null, 2)}`);
  } finally {
    await browser?.close().catch(() => {});
    if (auth?.token && cleanupIds.length) {
      result.cleanup = await cleanupConversations({ baseUrl: apiBaseUrl, auth, conversationIds: cleanupIds }).catch((error) => ({ error: error.message }));
    }
  }
  printResult(result);
  console.log('chat model selection live passed');
})().catch((error) => {
  console.error(redact(error.stack || error.message || error));
  process.exit(1);
});
