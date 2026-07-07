#!/usr/bin/env node
const assert = require('node:assert/strict');
const { cleanupConversations, env, login, openAuthedPage, printResult, summarizeConsole } = require('./chat-live-utils.cjs');

const apiBaseUrl = (env('USER_EDIT_API_BASE_URL', env('TESTNET_BASE_URL', 'http://127.0.0.1:19091')) || '').replace(/\/+$/, '');
const frontendBaseUrl = (env('USER_EDIT_FRONTEND_BASE_URL', 'http://127.0.0.1:3000') || '').replace(/\/+$/, '');
const model = env('USER_EDIT_MODEL', env('REAL_CHAT_MODEL', 'gpt-5.4-mini'));
const timeoutMs = Number(env('USER_EDIT_TIMEOUT_MS', '180000'));
const stamp = Date.now();
const initialToken = `USER_EDIT_INITIAL_${stamp}`;
const editedToken = `USER_EDIT_EDITED_${stamp}`;
const initialPrompt = `请只回答 ${initialToken}，不要添加其他内容。`;
const editedPrompt = `请只回答 ${editedToken}，不要添加其他内容。`;

function redact(value) {
  return String(value || '')
    .replace(/Bearer\s+[-._~+/=A-Za-z0-9]+/g, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9._-]+/g, '[REDACTED]')
    .replace(/(password|token|secret)(["'=:\s]+)([^"'\s,}]+)/gi, '$1$2[REDACTED]');
}

async function apiJson(path, token, init = {}) {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} ${res.status}: ${redact(text.slice(0, 500))}`);
  return data;
}

async function waitForUiAnswer(page, token) {
  await page.waitForFunction((needle) => {
    const rows = Array.from(document.querySelectorAll('[data-chat-message-row="true"][data-message-role="assistant"]'));
    const latest = rows[rows.length - 1];
    if (!latest) return false;
    const text = latest.textContent || '';
    return text.includes(needle)
      && latest.querySelectorAll('[data-chat-pending-shell="true"]').length === 0
      && latest.querySelectorAll('[data-chat-status-icon="spinning"], .animate-spin').length === 0;
  }, token, { timeout: timeoutMs });
  await page.waitForTimeout(900);
}

async function sampleRows(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-chat-message-row="true"]')).map((row) => ({
      role: row.getAttribute('data-message-role'),
      id: row.getAttribute('data-message-id'),
      serverId: row.getAttribute('data-server-message-id'),
      taskId: row.getAttribute('data-generation-task-id'),
      pending: row.querySelectorAll('[data-chat-pending-shell="true"]').length,
      spinner: row.querySelectorAll('[data-chat-status-icon="spinning"], .animate-spin').length,
      text: (row.textContent || '').replace(/\s+/g, ' ').trim(),
    }));
    return {
      rows,
      userRows: rows.filter((row) => row.role === 'user'),
      assistantRows: rows.filter((row) => row.role === 'assistant'),
      stopButtons: document.querySelectorAll('[data-testid="chat-stop-button"]').length,
      pendingShells: document.querySelectorAll('[data-chat-pending-shell="true"]').length,
      editForms: document.querySelectorAll('[data-testid="chat-user-message-edit-form"]').length,
      bodyTail: (document.body.innerText || '').slice(-1200),
    };
  });
}

(async () => {
  const report = { apiBaseUrl, frontendBaseUrl, model, stamp, initialToken, editedToken };
  let browser;
  let auth;
  let conversation;
  try {
    const health = await fetch(`${apiBaseUrl}/health`);
    assert.equal(health.ok, true, `backend health ${health.status}`);
    const frontendHealth = await fetch(`${frontendBaseUrl}/chat/`);
    assert.equal(frontendHealth.ok, true, `frontend health ${frontendHealth.status}`);

    auth = await login({ baseUrl: apiBaseUrl });
    conversation = await apiJson('/api/conversations', auth.token, {
      method: 'POST',
      body: JSON.stringify({ title: `user edit live ${stamp}`, model }),
    });
    report.conversationId = conversation.id;

    const { browser: openedBrowser, page } = await openAuthedPage({
      baseUrl: frontendBaseUrl,
      token: auth.token,
      user: auth.user,
      sessionToken: auth.sessionToken,
      refreshToken: auth.refreshToken,
      viewport: { width: 1440, height: 980 },
    });
    browser = openedBrowser;
    const consoleEvents = [];
    const pageErrors = [];
    const requestFailed = [];
    const apiResponses = [];
    page.on('console', (msg) => consoleEvents.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
    page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 300)));
    page.on('requestfailed', (req) => requestFailed.push({ method: req.method(), url: req.url(), failure: req.failure()?.errorText || '' }));
    page.on('response', (res) => {
      const url = res.url();
      if (/\/api\/(chat|tasks|conversations)/.test(url)) apiResponses.push({ status: res.status(), method: res.request().method(), url });
    });

    await page.addInitScript(({ modelValue }) => {
      localStorage.setItem('selected-model', modelValue);
      localStorage.setItem('recent-models', JSON.stringify([modelValue]));
      localStorage.setItem('search-enabled', 'false');
      localStorage.setItem('reasoning-enabled', 'false');
    }, { modelValue: model });

    await page.goto(`${frontendBaseUrl}/chat/?id=${conversation.id}&user_edit_live=${stamp}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForSelector('textarea', { timeout: 30000 });
    await page.locator('textarea').last().fill(initialPrompt, { force: true });
    await page.locator('button[type="submit"]:not([disabled])').last().click({ force: true });
    await waitForUiAnswer(page, initialToken);
    report.afterInitial = await sampleRows(page);
    assert.equal(report.afterInitial.userRows.length, 1, 'initial should have one user row');
    assert.equal(report.afterInitial.assistantRows.length, 1, 'initial should have one assistant row');

    const userRow = page.locator('[data-chat-message-row="true"][data-message-role="user"]').first();
    await userRow.hover();
    await userRow.locator('[data-testid="chat-user-message-edit-action"]').click({ timeout: 15000 });
    await page.locator('[data-testid="chat-user-message-edit-form"] textarea').fill(editedPrompt);
    await page.locator('[data-testid="chat-user-message-edit-save"]').click();
    await waitForUiAnswer(page, editedToken);
    report.afterEdit = await sampleRows(page);

    const patchResponses = apiResponses.filter((item) => item.method === 'PATCH' && /\/api\/conversations\/\d+\/messages\/\d+/.test(item.url));
    const chatInitResponses = apiResponses.filter((item) => item.method === 'POST' && /\/api\/chat\/init/.test(item.url));
    report.patchResponses = patchResponses;
    report.chatInitResponseCount = chatInitResponses.length;

    assert.equal(patchResponses.some((item) => item.status === 200), true, `PATCH edit did not return 200: ${JSON.stringify(patchResponses)}`);
    assert.equal(report.afterEdit.userRows.length, 1, `after edit user row count: ${report.afterEdit.userRows.length}`);
    assert.equal(report.afterEdit.assistantRows.length, 1, `after edit assistant row count: ${report.afterEdit.assistantRows.length}`);
    assert.equal(report.afterEdit.userRows[0].text.includes(editedToken), true, 'edited user row should contain edited prompt token');
    assert.equal(report.afterEdit.bodyTail.includes(initialToken), false, 'initial token should not remain visible after edit branch');
    assert.equal(report.afterEdit.assistantRows[0].text.includes(editedToken), true, 'new assistant should answer edited token');
    assert.equal(report.afterEdit.stopButtons, 0, 'stop button should be gone after completion');
    assert.equal(report.afterEdit.pendingShells, 0, 'pending shell should be gone after completion');

    const bootstrapAfterEdit = await apiJson(`/api/chat/bootstrap?id=${conversation.id}&message_tail=16&conversation_limit=20`, auth.token);
    const persistedMessages = bootstrapAfterEdit.snapshot?.messages || [];
    report.persistedAfterEdit = persistedMessages.map((msg) => ({ id: msg.id, role: msg.role, content: (msg.content || '').slice(0, 300), generation_status: msg.generation_status, generation_task_id: msg.generation_task_id }));
    assert.equal(persistedMessages.filter((msg) => msg.role === 'user').length, 1, 'persisted should have one user row');
    assert.equal(persistedMessages.filter((msg) => msg.role === 'assistant').length, 1, 'persisted should have one assistant row');
    assert.equal(persistedMessages.some((msg) => (msg.content || '').includes(editedToken)), true, 'persisted branch should include edited token');
    assert.equal(persistedMessages.some((msg) => (msg.content || '').includes(initialToken)), false, 'persisted branch should not include initial token');

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), editedToken, { timeout: 30000 });
    report.afterReload = await sampleRows(page);
    assert.equal(report.afterReload.userRows.length, 1, `after reload user row count: ${report.afterReload.userRows.length}`);
    assert.equal(report.afterReload.assistantRows.length, 1, `after reload assistant row count: ${report.afterReload.assistantRows.length}`);
    assert.equal(report.afterReload.bodyTail.includes(editedToken), true, 'after reload should include edited branch');
    assert.equal(report.afterReload.bodyTail.includes(initialToken), false, 'after reload should not include initial branch');

    const consoleErrors = summarizeConsole(consoleEvents).filter((event) => event.type === 'error' && !/favicon|401/.test(event.text));
    report.consoleErrors = consoleErrors;
    report.pageErrors = pageErrors;
    report.requestFailed = requestFailed.filter((item) => !/analytics|favicon|_rsc=/.test(item.url));
    assert.equal(pageErrors.length, 0, `page errors: ${JSON.stringify(pageErrors)}`);
    assert.equal(consoleErrors.length, 0, `console errors: ${JSON.stringify(consoleErrors)}`);
    assert.equal(report.requestFailed.length, 0, `request failures: ${JSON.stringify(report.requestFailed)}`);

    report.ok = true;
  } finally {
    await browser?.close().catch(() => {});
    if (conversation?.id && auth?.token) {
      report.cleanup = await cleanupConversations({ baseUrl: apiBaseUrl, token: auth.token, conversationIds: [conversation.id] }).catch((error) => ({ error: error.message }));
    }
  }
  printResult(report);
  console.log('chat user message edit live passed');
})().catch((error) => {
  console.error(redact(error.stack || error.message || error));
  process.exit(1);
});
