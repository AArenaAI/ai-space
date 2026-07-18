#!/usr/bin/env node
const assert = require('node:assert/strict');
const { authHeaders, cleanupConversations, env, login, openAuthedPage, printResult, summarizeConsole } = require('./chat-live-utils.cjs');

const apiBaseUrl = (env('COMPARE_EDIT_API_BASE_URL', env('USER_EDIT_API_BASE_URL', env('TESTNET_BASE_URL', 'http://127.0.0.1:9091'))) || '').replace(/\/+$/, '');
const frontendBaseUrl = (env('COMPARE_EDIT_FRONTEND_BASE_URL', env('USER_EDIT_FRONTEND_BASE_URL', 'http://127.0.0.1:3001')) || '').replace(/\/+$/, '');
const models = (env('COMPARE_EDIT_MODELS', 'gpt-5.4-mini,deepseek-v4-flash')).split(',').map((item) => item.trim()).filter(Boolean);
const timeoutMs = Number(env('COMPARE_EDIT_TIMEOUT_MS', '240000'));
const stamp = Date.now();
const initialToken = `COMPARE_EDIT_INITIAL_${stamp}`;
const editedToken = `COMPARE_EDIT_EDITED_${stamp}`;
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
    headers: { 'Content-Type': 'application/json', ...authHeaders(token), ...(init.headers || {}) },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} ${res.status}: ${redact(text.slice(0, 500))}`);
  return data;
}

function parseSseDataChunk(raw) {
  return raw.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
}

async function streamTaskToDone(token, taskId) {
  const res = await fetch(`${apiBaseUrl}/api/tasks/${taskId}/stream?after=0`, { headers: { ...authHeaders(token) } });
  if (!res.ok || !res.body) throw new Error(`stream task ${taskId} ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawDone = false;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';
    for (const chunk of chunks) {
      const data = parseSseDataChunk(chunk);
      if (data === '[DONE]') { sawDone = true; break; }
      if (!data) continue;
      try {
        const json = JSON.parse(data);
        if (json.type === 'done' || json.status === 'completed') sawDone = true;
      } catch {}
    }
    if (sawDone) break;
  }
  await reader.cancel().catch(() => {});
  assert.equal(sawDone, true, `task ${taskId} did not finish`);
}

async function createCompletedCompareConversation(token) {
  const conversation = await apiJson('/api/conversations', token, {
    method: 'POST',
    body: JSON.stringify({ title: `compare edit live ${stamp}`, model: models[0], compare: true, compare_models: JSON.stringify(models) }),
  });
  await apiJson(`/api/conversations/${conversation.id}`, token, {
    method: 'PUT',
    body: JSON.stringify({ compare: true, compare_models: JSON.stringify(models) }),
  });
  const init = await apiJson('/api/chat/compare/init', token, {
    method: 'POST',
    body: JSON.stringify({ conversation_id: conversation.id, content: initialPrompt, model: models[0], compare_models: models }),
  });
  const taskIds = [];
  for (let index = 0; index < models.length; index += 1) {
    const taskInit = await apiJson('/api/chat/init', token, {
      method: 'POST',
      body: JSON.stringify({
        model: models[index],
        messages: [{ role: 'user', content: initialPrompt }],
        stream: true,
        init_only: true,
        conversation_id: conversation.id,
        reasoning_effort: 'thinking',
        search: false,
        template_id: 0,
        skip_save_user_msg: true,
        group_id: init.group.id,
        user_message_id: init.user_message.id,
        group_index: index,
        group_models: models,
      }),
    });
    const taskId = Number(taskInit.task_id || taskInit.assistant_message?.generation_task_id || 0);
    assert.ok(taskId, `missing task id for ${models[index]}`);
    taskIds.push(taskId);
  }
  await Promise.all(taskIds.map((taskId) => streamTaskToDone(token, taskId)));
  return { conversation, init, taskIds };
}

async function sampleRows(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-chat-message-row="true"]')).map((row) => ({
      role: row.getAttribute('data-message-role'),
      id: row.getAttribute('data-message-id'),
      renderKey: row.getAttribute('data-message-render-key'),
      serverId: row.getAttribute('data-server-message-id'),
      text: (row.textContent || '').replace(/\s+/g, ' ').trim(),
    }));
    const compareColumns = Array.from(document.querySelectorAll('[data-chat-compare-column-shell="true"]')).map((column) => ({
      text: (column.textContent || '').replace(/\s+/g, ' ').trim(),
      model: column.getAttribute('data-chat-compare-column-model') || '',
    }));
    return {
      rows,
      userRows: rows.filter((row) => row.role === 'user'),
      assistantRows: rows.filter((row) => row.role === 'assistant'),
      compareColumns,
      editForms: document.querySelectorAll('[data-testid="chat-user-message-edit-form"]').length,
      stopButtons: document.querySelectorAll('[data-testid="chat-stop-button"]').length,
      pendingShells: document.querySelectorAll('[data-chat-pending-shell="true"]').length,
      bodyText: (document.body.innerText || '').replace(/\s+/g, ' '),
    };
  });
}

async function waitForCompareEditedAnswers(page) {
  await page.waitForFunction((needle) => {
    const columns = Array.from(document.querySelectorAll('[data-chat-compare-column-shell="true"]'));
    return columns.length >= 2
      && columns.every((column) => (column.textContent || '').includes(needle))
      && document.querySelectorAll('[data-chat-pending-shell="true"]').length === 0
      && document.querySelectorAll('[data-testid="chat-stop-button"]').length === 0;
  }, editedToken, { timeout: timeoutMs });
  await page.waitForTimeout(1000);
}

(async () => {
  const report = { apiBaseUrl, frontendBaseUrl, models, stamp, initialToken, editedToken };
  let browser;
  let auth;
  let created;
  try {
    assert.ok(models.length >= 2, 'COMPARE_EDIT_MODELS must contain at least two models');
    assert.equal((await fetch(`${apiBaseUrl}/health`)).ok, true, 'backend health failed');
    let frontendReady = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const res = await fetch(`${frontendBaseUrl}/chat/`).catch(() => null);
      if (res?.ok) { frontendReady = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.equal(frontendReady, true, 'frontend health failed');
    auth = await login({ baseUrl: apiBaseUrl });
    created = await createCompletedCompareConversation(auth);
    report.conversationId = created.conversation.id;

    const { browser: openedBrowser, page } = await openAuthedPage({
      baseUrl: frontendBaseUrl,
      auth,
      user: auth.user,
      sessionToken: auth.sessionToken,
      refreshToken: auth.refreshToken,
      viewport: { width: 1440, height: 1000 },
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

    await page.goto(`${frontendBaseUrl}/chat/?id=${created.conversation.id}&compare_edit_live=${stamp}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.locator('[data-chat-compare-column-shell="true"]').first().waitFor({ state: 'visible', timeout: 40000 });
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), initialToken, { timeout: 40000 });
    report.beforeEdit = await sampleRows(page);
    assert.equal(report.beforeEdit.userRows.length, 1, 'before edit should have one shared user row');
    assert.equal(report.beforeEdit.compareColumns.length >= 2, true, 'before edit should have compare columns');

    const userRow = page.locator('[data-chat-message-row="true"][data-message-role="user"]').first();
    await userRow.hover();
    await userRow.locator('[data-testid="chat-user-message-edit-action"]').click({ timeout: 15000 });
    await page.locator('[data-testid="chat-user-message-edit-form"] textarea').fill(editedPrompt);
    const patchPromise = page.waitForResponse((res) => res.request().method() === 'PATCH' && /\/api\/conversations\/\d+\/messages\/\d+/.test(res.url()), { timeout: 30000 });
    const initResponses = [];
    page.on('response', (res) => {
      if (res.request().method() === 'POST' && /\/api\/chat\/init/.test(res.url())) initResponses.push(res.status());
    });
    await page.locator('[data-testid="chat-user-message-edit-save"]').click();
    const patchResponse = await patchPromise;
    assert.equal(patchResponse.status(), 200, `PATCH status ${patchResponse.status()}`);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="chat-user-message-edit-form"]').length === 0, undefined, { timeout: 15000 });
    report.afterAccepted = await sampleRows(page);
    assert.equal(report.afterAccepted.userRows.length, 1, 'after accepted should still have one user row');
    assert.equal(report.afterAccepted.userRows[0].text.includes(editedToken), true, 'edited user row should contain edited token');
    assert.equal(report.afterAccepted.bodyText.includes('发送中'), false, 'sending label must not be visible');

    await waitForCompareEditedAnswers(page);
    report.afterEdit = await sampleRows(page);
    assert.equal(report.afterEdit.userRows.length, 1, 'after edit should have one user row');
    assert.equal(report.afterEdit.compareColumns.length >= 2, true, 'after edit should have compare columns');
    assert.equal(report.afterEdit.compareColumns.every((column) => column.text.includes(editedToken)), true, 'each compare column should answer edited token');
    assert.equal(report.afterEdit.bodyText.includes(initialToken), false, 'initial branch should be removed from UI');
    assert.equal(report.afterEdit.bodyText.includes('发送中'), false, 'sending label must not appear after edit');
    report.initStatuses = initResponses;
    assert.equal(initResponses.filter((status) => [200, 202].includes(status)).length >= 2, true, `expected two chat init successes, got ${initResponses}`);

    const boot = await apiJson(`/api/chat/bootstrap?id=${created.conversation.id}&message_tail=24&conversation_limit=20`, auth);
    const persisted = boot.snapshot?.messages || [];
    report.persisted = persisted.map((msg) => ({ id: msg.id, role: msg.role, content: (msg.content || '').slice(0, 240), group_id: msg.group_id, group_index: msg.group_index, user_message_id: msg.user_message_id, generation_status: msg.generation_status }));
    assert.equal(persisted.filter((msg) => msg.role === 'user').length, 1, 'persisted should have one user row');
    assert.equal(persisted.filter((msg) => msg.role === 'assistant').length, models.length, 'persisted should have one assistant per model');
    assert.equal(persisted.some((msg) => (msg.content || '').includes(initialToken)), false, 'persisted should not include initial branch');
    assert.equal(persisted.filter((msg) => (msg.content || '').includes(editedToken)).length >= models.length + 1, true, 'persisted should include edited user and assistant tokens');

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), editedToken, { timeout: 40000 });
    report.afterReload = await sampleRows(page);
    assert.equal(report.afterReload.userRows.length, 1, 'after reload should have one user row');
    assert.equal(report.afterReload.compareColumns.length >= 2, true, 'after reload should keep compare columns');
    assert.equal(report.afterReload.bodyText.includes(initialToken), false, 'after reload should not include initial branch');
    assert.equal(report.afterReload.bodyText.includes('发送中'), false, 'sending label must not appear after reload');

    const consoleErrors = summarizeConsole(consoleEvents).filter((event) => event.type === 'error' && !/favicon|401/.test(event.text));
    report.consoleErrors = consoleErrors;
    report.pageErrors = pageErrors;
    report.requestFailed = requestFailed.filter((item) => !/analytics|favicon|_rsc=/.test(item.url));
    report.apiResponsesTail = apiResponses.slice(-40);
    assert.equal(pageErrors.length, 0, `page errors: ${JSON.stringify(pageErrors)}`);
    assert.equal(consoleErrors.length, 0, `console errors: ${JSON.stringify(consoleErrors)}`);
    assert.equal(report.requestFailed.length, 0, `request failures: ${JSON.stringify(report.requestFailed)}`);
    report.ok = true;
  } finally {
    await browser?.close().catch(() => {});
    if (created?.conversation?.id && auth?.token) {
      report.cleanup = await cleanupConversations({ baseUrl: apiBaseUrl, auth, conversationIds: [created.conversation.id] }).catch((error) => ({ error: error.message }));
    }
  }
  printResult(report);
  console.log('chat compare user message edit live passed');
})().catch((error) => {
  console.error(redact(error.stack || error.message || error));
  process.exit(1);
});
