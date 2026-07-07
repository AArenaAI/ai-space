#!/usr/bin/env node
const assert = require('node:assert/strict');
const { cleanupConversations, env, login, openAuthedPage, printResult, summarizeConsole } = require('./chat-live-utils.cjs');

const apiBaseUrl = (env('USER_EDIT_MULTI_API_BASE_URL', env('USER_EDIT_API_BASE_URL', env('TESTNET_BASE_URL', 'http://127.0.0.1:19091'))) || '').replace(/\/+$/, '');
const frontendBaseUrl = (env('USER_EDIT_MULTI_FRONTEND_BASE_URL', env('USER_EDIT_FRONTEND_BASE_URL', 'http://127.0.0.1:3000')) || '').replace(/\/+$/, '');
const model = env('USER_EDIT_MULTI_MODEL', env('USER_EDIT_MODEL', env('REAL_CHAT_MODEL', 'gpt-5.4-mini')));
const timeoutMs = Number(env('USER_EDIT_MULTI_TIMEOUT_MS', '180000'));
const stamp = Date.now();
const firstToken = `USER_EDIT_MULTI_FIRST_${stamp}`;
const secondOriginalToken = `USER_EDIT_MULTI_SECOND_ORIGINAL_${stamp}`;
const thirdToken = `USER_EDIT_MULTI_THIRD_${stamp}`;
const secondEditedToken = `USER_EDIT_MULTI_SECOND_EDITED_${stamp}`;

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

async function waitForLatestAssistantToken(page, token) {
  await page.waitForFunction((needle) => {
    const rows = Array.from(document.querySelectorAll('[data-chat-message-row="true"][data-message-role="assistant"]'));
    const latest = rows[rows.length - 1];
    if (!latest) return false;
    const text = latest.textContent || '';
    return text.includes(needle)
      && latest.querySelectorAll('[data-chat-pending-shell="true"]').length === 0
      && latest.querySelectorAll('[data-chat-status-icon="spinning"], .animate-spin').length === 0;
  }, token, { timeout: timeoutMs });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="chat-stop-button"]').length === 0, undefined, { timeout: timeoutMs }).catch(() => {});
  await page.waitForTimeout(800);
}

async function sampleRows(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-chat-message-row="true"]')).map((row, index) => ({
      index,
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
      bodyText: document.body.innerText || '',
      bodyTail: (document.body.innerText || '').slice(-1800),
    };
  });
}

async function sendTurn(page, token, label) {
  const prompt = `多轮二次编辑 live 第${label}轮：请只回答 ${token}，不要添加其他内容。`;
  await page.locator('textarea').last().fill(prompt, { force: true });
  await page.locator('button[type="submit"]:not([disabled])').last().click({ force: true });
  await waitForLatestAssistantToken(page, token);
  return prompt;
}

function messageSummary(messages) {
  return messages.map((msg) => ({
    id: msg.id,
    role: msg.role,
    content: (msg.content || '').slice(0, 260),
    generation_status: msg.generation_status,
    generation_task_id: msg.generation_task_id,
  }));
}

function assertBranchState(sample, label) {
  assert.equal(sample.userRows.length, 2, `${label}: should have two user rows after editing second turn`);
  assert.equal(sample.assistantRows.length, 2, `${label}: should have two assistant rows after editing second turn`);
  assert.equal(sample.bodyText.includes(firstToken), true, `${label}: first branch should remain visible`);
  assert.equal(sample.bodyText.includes(secondEditedToken), true, `${label}: edited second branch should be visible`);
  assert.equal(sample.bodyText.includes(secondOriginalToken), false, `${label}: original second token should be truncated`);
  assert.equal(sample.bodyText.includes(thirdToken), false, `${label}: third branch should be truncated`);
  assert.equal(sample.stopButtons, 0, `${label}: stop button should be gone`);
  assert.equal(sample.pendingShells, 0, `${label}: pending shell should be gone`);
}

(async () => {
  const report = { apiBaseUrl, frontendBaseUrl, model, stamp, firstToken, secondOriginalToken, thirdToken, secondEditedToken };
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
      body: JSON.stringify({ title: `user edit multiturn live ${stamp}`, model }),
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
      localStorage.setItem('reasoning-mode', 'fast');
      localStorage.removeItem('compare-mode');
      localStorage.removeItem('compare-models');
    }, { modelValue: model });

    await page.goto(`${frontendBaseUrl}/chat/?id=${conversation.id}&user_edit_multiturn_live=${stamp}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForSelector('textarea', { timeout: 30000 });

    report.prompts = [];
    report.prompts.push(await sendTurn(page, firstToken, '一'));
    report.prompts.push(await sendTurn(page, secondOriginalToken, '二'));
    report.prompts.push(await sendTurn(page, thirdToken, '三'));
    report.beforeEdit = await sampleRows(page);
    assert.equal(report.beforeEdit.userRows.length, 3, `before edit user row count: ${report.beforeEdit.userRows.length}`);
    assert.equal(report.beforeEdit.assistantRows.length, 3, `before edit assistant row count: ${report.beforeEdit.assistantRows.length}`);
    assert.equal(report.beforeEdit.bodyText.includes(firstToken), true, 'before edit should include first token');
    assert.equal(report.beforeEdit.bodyText.includes(secondOriginalToken), true, 'before edit should include second original token');
    assert.equal(report.beforeEdit.bodyText.includes(thirdToken), true, 'before edit should include third token');

    const secondUserRow = page.locator('[data-chat-message-row="true"][data-message-role="user"]').nth(1);
    await secondUserRow.scrollIntoViewIfNeeded();
    await secondUserRow.hover();
    await secondUserRow.locator('[data-testid="chat-user-message-edit-action"]').click({ timeout: 15000 });
    await page.locator('[data-testid="chat-user-message-edit-form"] textarea').fill(`多轮二次编辑 live 第二轮改写：请只回答 ${secondEditedToken}，不要添加其他内容。`);
    await page.locator('[data-testid="chat-user-message-edit-save"]').click();
    await waitForLatestAssistantToken(page, secondEditedToken);

    report.afterEdit = await sampleRows(page);
    const patchResponses = apiResponses.filter((item) => item.method === 'PATCH' && /\/api\/conversations\/\d+\/messages\/\d+/.test(item.url));
    report.patchResponses = patchResponses;
    report.chatInitResponseCount = apiResponses.filter((item) => item.method === 'POST' && /\/api\/chat\/init/.test(item.url)).length;
    assert.equal(patchResponses.some((item) => item.status === 200), true, `PATCH edit did not return 200: ${JSON.stringify(patchResponses)}`);
    assertBranchState(report.afterEdit, 'after edit');

    const bootstrapAfterEdit = await apiJson(`/api/chat/bootstrap?id=${conversation.id}&message_tail=24&conversation_limit=20`, auth.token);
    const persistedMessages = bootstrapAfterEdit.snapshot?.messages || [];
    report.persistedAfterEdit = messageSummary(persistedMessages);
    assert.equal(persistedMessages.filter((msg) => msg.role === 'user').length, 2, 'persisted should have two user rows after edit');
    assert.equal(persistedMessages.filter((msg) => msg.role === 'assistant').length, 2, 'persisted should have two assistant rows after edit');
    const persistedText = persistedMessages.map((msg) => msg.content || '').join('\n');
    assert.equal(persistedText.includes(firstToken), true, 'persisted should keep first token');
    assert.equal(persistedText.includes(secondEditedToken), true, 'persisted should include edited second token');
    assert.equal(persistedText.includes(secondOriginalToken), false, 'persisted should not include original second token');
    assert.equal(persistedText.includes(thirdToken), false, 'persisted should not include third token');

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), secondEditedToken, { timeout: 30000 });
    report.afterReload = await sampleRows(page);
    assertBranchState(report.afterReload, 'after reload');

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
  console.log('chat user message edit multiturn live passed');
})().catch((error) => {
  console.error(redact(error.stack || error.message || error));
  process.exit(1);
});
