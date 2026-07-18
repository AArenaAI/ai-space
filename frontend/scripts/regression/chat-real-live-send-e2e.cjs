#!/usr/bin/env node
const { authHeaders, cleanupConversations, env, login, openAuthedPage, printResult, summarizeConsole } = require('./chat-live-utils.cjs');

const baseUrl = trimTrailingSlash(env('REAL_CHAT_BASE_URL', env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz')));
const apiBaseUrl = trimTrailingSlash(env('REAL_CHAT_API_BASE_URL', baseUrl));
const frontendBaseUrl = trimTrailingSlash(env('REAL_CHAT_FRONTEND_BASE_URL', baseUrl));
const model = env('REAL_CHAT_MODEL', 'gpt-5.5');
const searchEnabled = env('REAL_CHAT_SEARCH') === '1';
const reasoningEnabled = env('REAL_CHAT_REASONING') === '1';
const reasoningEffort = env('REAL_CHAT_REASONING_EFFORT', 'standard');
const prompt = env('REAL_CHAT_PROMPT', '真实页面发送 E2E：请只回答 OK 42。');
const expectSource = env('REAL_CHAT_EXPECT', 'OK[\\s\\S]*42').replace(/\\\\/g, '\\');
const expectPattern = new RegExp(expectSource, 'i');
const timeoutMs = Number(env('REAL_CHAT_TIMEOUT_MS', '180000'));
const keepConversation = env('KEEP_LIVE_CONVERSATIONS') === '1';
const verbose = env('REAL_CHAT_VERBOSE') === '1';

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function redact(value) {
  return String(value || '')
    .replace(/Bearer\s+[-._~+/=A-Za-z0-9]+/g, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9._-]+/g, '[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/(api[_-]?key|token|password|secret)(["'=:\s]+)([^"'\s,}]+)/gi, '$1$2[REDACTED]');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function logStep(message) {
  if (verbose) console.error(`[live-e2e] ${message}`);
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

async function waitForHttpOk(url, timeout = 60000) {
  const deadline = Date.now() + timeout;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`timeout waiting for ${url}: ${lastError}`);
}

async function main() {
  const startedAt = Date.now();
  const report = {
    apiBaseUrl,
    frontendBaseUrl,
    model,
    searchEnabled,
    reasoningEnabled,
    reasoningEffort,
    keepConversation,
    startedAt: new Date(startedAt).toISOString(),
  };
  let browser;
  let conversation;
  let auth;
  let cleanup;

  try {
    const health = await fetch(`${apiBaseUrl}/health`);
    assert(health.ok, `backend health failed: ${health.status}`);
    logStep('backend health ok');
    await waitForHttpOk(`${frontendBaseUrl}/chat/`, 60000);
    logStep('frontend health ok');

    const modelsRes = await fetch(`${apiBaseUrl}/api/models/chat`);
    assert(modelsRes.ok, `models failed: ${modelsRes.status}`);
    const models = await modelsRes.json();
    assert(Array.isArray(models) && models.some((m) => m.id === model), `model ${model} not found in chat models`);

    auth = await login({ baseUrl: apiBaseUrl });
    report.userId = auth.user?.id;
    conversation = await apiJson('/api/conversations', auth, {
      method: 'POST',
      body: JSON.stringify({ title: `real live send ${startedAt}`, model }),
    });
    report.conversationId = conversation.id;
    logStep(`created conversation ${conversation.id}`);

    const opened = await openAuthedPage({
      baseUrl: frontendBaseUrl,
      auth,
      user: auth.user,
      sessionToken: auth.sessionToken,
      refreshToken: auth.refreshToken,
      viewport: { width: 1440, height: 980 },
    });
    browser = opened.browser;
    const page = opened.page;
    const issues = [];
    const chatResponses = [];
    const consoleEvents = [];
    const pageErrors = [];
    const requestfailed = [];

    page.on('console', (msg) => {
      const event = { type: msg.type(), text: msg.text().slice(0, 300) };
      consoleEvents.push(event);
      if (msg.type() === 'error') issues.push(`console.error: ${event.text}`);
    });
    page.on('pageerror', (err) => {
      pageErrors.push(String(err).slice(0, 300));
      issues.push(`pageerror: ${err.message}`);
    });
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText || 'failed';
      requestfailed.push({ method: request.method(), url: request.url(), failure });
      if (!/analytics|favicon|_rsc=/.test(request.url())) issues.push(`requestfailed: ${request.method()} ${request.url()} ${failure}`);
    });
    page.on('response', (response) => {
      const url = response.url();
      if (/\/api\/(chat|tasks)\b/.test(url)) chatResponses.push({ status: response.status(), url, contentType: response.headers()['content-type'] || '' });
      if (response.status() >= 400 && !/favicon\.ico|analytics|_rsc=/.test(url)) issues.push(`response ${response.status()}: ${url}`);
    });

    await page.addInitScript(({ modelValue, searchEnabledValue, reasoningEnabledValue, reasoningEffortValue }) => {
      localStorage.setItem('selected-model', modelValue);
      localStorage.setItem('recent-models', JSON.stringify([modelValue]));
      localStorage.setItem('search-enabled', searchEnabledValue ? 'true' : 'false');
      localStorage.setItem('reasoning-enabled', reasoningEnabledValue ? 'true' : 'false');
      localStorage.setItem('reasoning-mode', reasoningEnabledValue ? 'think' : 'fast');
      localStorage.setItem('reasoning-effort', reasoningEffortValue);
    }, {
      modelValue: model,
      searchEnabledValue: searchEnabled,
      reasoningEnabledValue: reasoningEnabled,
      reasoningEffortValue: reasoningEffort,
    });

    const response = await page.goto(`${frontendBaseUrl}/chat/?id=${conversation.id}&real_live_send=${startedAt}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    assert((response?.status() || 0) < 400, `chat page HTTP ${response?.status()}`);
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForSelector('textarea', { timeout: 30000 });
    const textareaCount = await page.locator('textarea').count();
    const textarea = page.locator('textarea').nth(textareaCount > 1 ? textareaCount - 1 : 0);
    await textarea.fill(prompt, { force: true });
    await page.locator('button[type="submit"]:not([disabled])').last().click({ force: true });
    logStep('send clicked');

    await page.waitForFunction(() => document.querySelector('[data-chat-message-row="true"][data-message-role="assistant"]'), null, { timeout: 30000 });
    await page.waitForFunction(() => {
      const rows = Array.from(document.querySelectorAll('[data-chat-message-row="true"][data-message-role="assistant"]'));
      const latest = rows[rows.length - 1];
      const text = latest?.textContent || '';
      const pending = latest?.querySelector('[data-chat-pending-shell="true"]');
      return Boolean(latest && text.trim().length > 0 && !pending);
    }, null, { timeout: timeoutMs });
    await page.waitForTimeout(1000);

    const sample = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-chat-message-row="true"]')).map((row) => ({
        role: row.getAttribute('data-message-role'),
        id: row.getAttribute('data-message-id'),
        serverId: row.getAttribute('data-server-message-id'),
        taskId: row.getAttribute('data-generation-task-id'),
        pending: row.querySelectorAll('[data-chat-pending-shell="true"]').length,
        spinner: row.querySelectorAll('.animate-spin,[data-chat-status-icon="spinning"]').length,
        text: (row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500),
      }));
      const assistantRows = rows.filter((row) => row.role === 'assistant');
      const latestAssistant = assistantRows[assistantRows.length - 1] || null;
      const textarea = Array.from(document.querySelectorAll('textarea')).pop();
      return {
        rows,
        latestAssistant,
        assistantTexts: assistantRows.map((row) => row.text),
        textareaValue: textarea?.value || '',
        stopButtons: document.querySelectorAll('[data-testid="chat-stop-button"]').length,
        pendingShells: document.querySelectorAll('[data-chat-pending-shell="true"]').length,
        bodyTail: (document.body.innerText || '').slice(-1000),
      };
    }, expectPattern.source);

    const boot = await apiJson(`/api/chat/bootstrap?id=${conversation.id}&message_tail=32&conversation_limit=30`, auth);
    const latest = [...(boot.snapshot?.messages || [])].reverse().find((message) => message.role === 'assistant') || null;
    const answerMatches = (sample.assistantTexts || []).filter((text) => expectPattern.test(text)).length;
    const ok = answerMatches === 1
      && sample.latestAssistant?.pending === 0
      && sample.latestAssistant?.spinner === 0
      && sample.textareaValue === ''
      && sample.stopButtons === 0
      && chatResponses.some((r) => r.status === 202 && /\/api\/chat\/init/.test(r.url))
      && chatResponses.some((r) => r.status < 400 && /\/api\/tasks\//.test(r.url) && /text\/event-stream/.test(r.contentType))
      && latest?.generation_status === 'completed'
      && expectPattern.test(latest?.content || '')
      && issues.length === 0;

    Object.assign(report, {
      ok,
      latestAssistant: latest ? {
        id: latest.id,
        generation_task_id: latest.generation_task_id,
        generation_status: latest.generation_status,
        phase: latest.phase,
        content: (latest.content || '').slice(0, 300),
      } : null,
      answerMatches,
      sample,
      chatResponses: chatResponses.slice(-20),
      requestfailed: requestfailed.slice(-20),
      consoleErrors: summarizeConsole(consoleEvents),
      pageErrors,
      issues: issues.slice(0, 12),
      elapsedMs: Date.now() - startedAt,
    });
    assert(ok, `real live-send e2e failed: ${JSON.stringify(report, null, 2)}`);
  } finally {
    await browser?.close().catch(() => {});
    if (conversation?.id && auth?.token) {
      cleanup = await cleanupConversations({ baseUrl: apiBaseUrl, auth, conversationIds: [conversation.id] });
      report.cleanup = cleanup;
    }
  }

  printResult(report);
  console.log('chat real live-send e2e passed');
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error(redact(err.stack || err.message || err));
  process.exit(1);
});
