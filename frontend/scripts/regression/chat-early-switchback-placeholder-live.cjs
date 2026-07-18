#!/usr/bin/env node
const { authHeaders, env, login, openAuthedPage, printResult, summarizeConsole } = require('./chat-live-utils.cjs');

async function apiJson(baseUrl, path, token, init = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(token), ...(init.headers || {}) },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} ${res.status}: ${text.slice(0, 500)}`);
  return data;
}

async function createConversation(baseUrl, token, title, model) {
  return apiJson(baseUrl, '/api/conversations', token, { method: 'POST', body: JSON.stringify({ title, model }) });
}

async function clickConversation(page, id) {
  await page.waitForFunction((convId) => Boolean(document.querySelector(`[data-conversation-id="${convId}"]`)), id, { timeout: 30000 });
  await page.evaluate((convId) => {
    const el = document.querySelector(`[data-conversation-id="${convId}"]`);
    if (!el) throw new Error(`missing conversation ${convId}`);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }, id);
}

async function sample(page, label) {
  return page.evaluate((label) => {
    const rows = Array.from(document.querySelectorAll('[data-chat-message-row="true"]')).map((row) => ({
      role: row.getAttribute('data-message-role') || '',
      id: row.getAttribute('data-message-id') || '',
      serverId: row.getAttribute('data-server-message-id') || '',
      taskId: row.getAttribute('data-generation-task-id') || '',
      text: (row.textContent || '').slice(0, 500),
      spinner: row.querySelectorAll('[data-chat-status-icon="spinning"]').length,
      placeholder: row.querySelectorAll('[data-chat-empty-streaming-placeholder="true"]').length,
    }));
    const assistantRows = rows.filter((row) => row.role === 'assistant');
    const latestAssistant = assistantRows[assistantRows.length - 1] || null;
    const stopCount = Array.from(document.querySelectorAll('button')).filter((button) => /停止|Stop|stop/i.test(`${button.title || ''} ${button.getAttribute('aria-label') || ''}`) || /bg-red-500/.test(String(button.className || ''))).length;
    return { label, url: location.href, rowCount: rows.length, assistantCount: assistantRows.length, latestAssistant, stopCount, bodyTail: (document.body.innerText || '').slice(-1000) };
  }, label);
}

(async () => {
  const baseUrl = env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz');
  const model = env('EARLY_MODEL', env('REAL_CHAT_MODEL', 'gpt-5.5'));
  const prompt = env('EARLY_PROMPT', '请联网搜索今天美国经济、就业、通胀和美联储最新信息，用中文简要回答。');
  const switchAwayMs = Number(env('EARLY_SWITCH_AWAY_MS', '150'));
  const returnDelayMs = Number(env('EARLY_RETURN_MS', '350'));
  const auth = await login({ baseUrl });
  const stamp = Date.now();
  const convA = await createConversation(baseUrl, auth, `Early switch A ${stamp}`, model);
  const convB = await createConversation(baseUrl, auth, `Early switch B ${stamp}`, model);
  const { browser, page } = await openAuthedPage({ baseUrl, auth, user: auth.user, sessionToken: auth.sessionToken, refreshToken: auth.refreshToken });
  const events = { requests: [], responses: [], console: [], errors: [] };
  page.on('request', (req) => { const u = req.url(); if (u.includes('/api/chat') || u.includes('/api/tasks/')) events.requests.push({ method: req.method(), url: u }); });
  page.on('response', (res) => { const u = res.url(); if (u.includes('/api/chat') || u.includes('/api/tasks/')) events.responses.push({ status: res.status(), url: u }); });
  page.on('console', (msg) => events.console.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (err) => events.errors.push(String(err).slice(0, 300)));
  try {
    await page.addInitScript(({ model }) => {
      localStorage.setItem('selected-model', model);
      localStorage.setItem('recent-models', JSON.stringify([model]));
      localStorage.setItem('search-enabled', 'true');
      localStorage.setItem('reasoning-enabled', 'true');
      localStorage.setItem('reasoning-mode', 'think');
      localStorage.setItem('reasoning-effort', 'standard');
    }, { model });
    await page.goto(`${baseUrl}/chat/?id=${convA.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('textarea', { timeout: 30000 });
    await page.waitForTimeout(1200);
    const textareaCount = await page.locator('textarea').count();
    const inputIndex = textareaCount > 1 ? 1 : 0;
    await page.locator('textarea').nth(inputIndex).click({ force: true });
    await page.locator('textarea').nth(inputIndex).fill(prompt, { force: true });
    await page.locator('button[type="submit"]').nth(inputIndex).click({ force: true });
    await page.waitForTimeout(switchAwayMs);
    const afterSend = await sample(page, `after-send-${switchAwayMs}ms`);
    await clickConversation(page, convB.id);
    await page.waitForTimeout(returnDelayMs);
    await clickConversation(page, convA.id);
    const samples = [];
    for (const [label, waitMs] of [['back-150ms', 150], ['back-500ms', 350], ['back-1000ms', 500], ['back-2000ms', 1000]]) {
      await page.waitForTimeout(waitMs);
      samples.push(await sample(page, label));
    }
    const boot = await apiJson(baseUrl, `/api/chat/bootstrap?id=${convA.id}&message_tail=32&conversation_limit=30`, auth);
    const latest = [...(boot.snapshot?.messages || [])].reverse().find((m) => m.role === 'assistant');
    const anyServerBoundAssistant = samples.some((s) => s.latestAssistant && (s.latestAssistant.serverId || s.latestAssistant.taskId || /^\d+$/.test(String(s.latestAssistant.id || ''))));
    const result = {
      ok: anyServerBoundAssistant && Boolean(latest?.generation_task_id) && events.errors.length === 0,
      convA: convA.id,
      convB: convB.id,
      model,
      afterSend,
      samples,
      backendLatestAssistant: latest ? { id: latest.id, generation_task_id: latest.generation_task_id, generation_status: latest.generation_status, phase: latest.phase, contentLen: (latest.content || '').length, reasoningLen: (latest.reasoning_content || '').length } : null,
      activeTasks: boot.active_tasks?.chat || [],
      requests: events.requests.slice(-30),
      responses: events.responses.slice(-30),
      consoleErrors: summarizeConsole(events.console),
      pageErrors: events.errors,
    };
    printResult(result);
    if (!result.ok) process.exit(2);
  } finally {
    await browser.close().catch(() => {});
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
