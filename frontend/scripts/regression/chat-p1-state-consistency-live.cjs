#!/usr/bin/env node
const { cleanupConversations, env, login, openAuthedPage, summarizeConsole, printResult } = require('./chat-live-utils.cjs');

async function apiJson(baseUrl, path, token, init = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} ${res.status}: ${text.slice(0, 500)}`);
  return data;
}

async function createConversation(baseUrl, token, title, model) {
  return apiJson(baseUrl, '/api/conversations', token, {
    method: 'POST',
    body: JSON.stringify({ title, model }),
  });
}

async function clickConversation(page, id, delayMs = 0) {
  await page.waitForFunction((convId) => Boolean(document.querySelector(`[data-conversation-id="${convId}"]`)), id, { timeout: 30000 });
  await page.evaluate((convId) => {
    const el = document.querySelector(`[data-conversation-id="${convId}"]`);
    if (!el) throw new Error(`missing conversation ${convId}`);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }, id);
  if (delayMs) await page.waitForTimeout(delayMs);
}

async function clickStopIfPresent(page) {
  return page.evaluate(() => {
    const stop = document.querySelector('[data-testid="chat-stop-button"]');
    if (!stop) return false;
    stop.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  });
}

async function waitForIdle(page, timeoutMs = 90000) {
  await page.waitForFunction(() => {
    const stopButtons = document.querySelectorAll('[data-testid="chat-stop-button"]').length;
    const pendingShells = document.querySelectorAll('[data-chat-pending-shell="true"]').length;
    const assistantRows = Array.from(document.querySelectorAll('[data-chat-message-row="true"][data-message-role="assistant"]'));
    const latest = assistantRows[assistantRows.length - 1];
    const text = (latest?.textContent || '').replace(/\s+/g, ' ').trim();
    return stopButtons === 0 && pendingShells === 0 && text.length > 20;
  }, undefined, { timeout: timeoutMs });
}

async function sample(page, label) {
  return page.evaluate((label) => {
    const rows = Array.from(document.querySelectorAll('[data-chat-message-row="true"][data-message-id]')).map((row) => {
      const rect = row.getBoundingClientRect();
      const pendingShells = Array.from(row.querySelectorAll('[data-chat-pending-shell="true"]')).map((node) => {
        const nodeRect = node.getBoundingClientRect();
        return {
          compact: node.getAttribute('data-chat-pending-compact') || '',
          height: Math.round(nodeRect.height),
          text: (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
        };
      });
      return {
        role: row.getAttribute('data-message-role') || '',
        id: row.getAttribute('data-message-id') || '',
        serverId: row.getAttribute('data-server-message-id') || '',
        taskId: row.getAttribute('data-generation-task-id') || '',
        height: Math.round(rect.height),
        pendingShells,
        spinnerCount: row.querySelectorAll('[data-chat-status-icon="spinning"], .animate-spin').length,
        answerState: row.querySelector('[data-chat-answer-renderer="true"]')?.getAttribute('data-chat-answer-render-state') || '',
        text: (row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 260),
      };
    });
    const assistantRows = rows.filter((row) => row.role === 'assistant');
    const latestAssistant = assistantRows[assistantRows.length - 1] || null;
    const ids = rows.map((row) => row.id).filter(Boolean);
    const duplicateIds = Array.from(new Set(ids.filter((id, index) => ids.indexOf(id) !== index)));
    const allButtons = Array.from(document.querySelectorAll('button'));
    const stopButtons = document.querySelectorAll('[data-testid="chat-stop-button"]').length;
    const submitButtons = allButtons.filter((button) => (button.getAttribute('type') || '') === 'submit').length;
    const pendingShellHeights = rows.flatMap((row) => row.pendingShells.map((shell) => shell.height));
    return {
      label,
      url: location.href,
      rowCount: rows.length,
      assistantCount: assistantRows.length,
      latestAssistant,
      duplicateIds,
      stopButtons,
      submitButtons,
      pendingShellCount: pendingShellHeights.length,
      pendingShellHeights,
      bodyTail: (document.body.innerText || '').replace(/\s+/g, ' ').slice(-1000),
    };
  }, label);
}

function analyze(samples) {
  const duplicateIds = Array.from(new Set(samples.flatMap((item) => item.duplicateIds || [])));
  const pendingSamples = samples.filter((item) => item.pendingShellCount > 0);
  const pendingHeights = pendingSamples.flatMap((item) => item.pendingShellHeights || []);
  const minPendingHeight = pendingHeights.length ? Math.min(...pendingHeights) : 0;
  const maxPendingHeight = pendingHeights.length ? Math.max(...pendingHeights) : 0;
  const hasAnyAssistantBinding = samples.some((item) => {
    const latest = item.latestAssistant;
    return latest && (latest.serverId || latest.taskId || /^\d+$/.test(String(latest.id || '')));
  });
  const stoppedSamples = samples.filter((item) => /after-stop/.test(item.label));
  const hasStopAfterStopClick = stoppedSamples.some((item) => item.stopButtons > 0);
  return {
    duplicateIds,
    pendingSampleCount: pendingSamples.length,
    minPendingHeight,
    maxPendingHeight,
    hasAnyAssistantBinding,
    hasStopAfterStopClick,
  };
}

async function sendPromptFromUi(page, prompt) {
  await page.waitForSelector('textarea', { timeout: 30000 });
  const textareaCount = await page.locator('textarea').count();
  const inputIndex = textareaCount > 1 ? textareaCount - 1 : 0;
  await page.locator('textarea').nth(inputIndex).click({ force: true });
  await page.locator('textarea').nth(inputIndex).fill(prompt, { force: true });
  await page.locator('button[type="submit"]').last().click({ force: true });
}

(async () => {
  if (!env('TESTNET_EMAIL') || !env('TESTNET_PASSWORD')) {
    const result = { ok: env('P1_REQUIRE_LIVE') !== '1', skipped: true, reason: 'Missing TESTNET_EMAIL or TESTNET_PASSWORD' };
    printResult(result);
    if (!result.ok) process.exit(2);
    return;
  }

  const baseUrl = env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz');
  const apiBaseUrl = env('P1_STATE_API_BASE_URL', baseUrl).replace(/\/+$/, '');
  const frontendBaseUrl = env('P1_STATE_FRONTEND_BASE_URL', baseUrl).replace(/\/+$/, '');
  const model = env('P1_STATE_MODEL', env('REAL_CHAT_MODEL', 'gpt-5.5'));
  const stamp = Date.now();
  const auth = await login({ baseUrl: apiBaseUrl });
  const convA = await createConversation(apiBaseUrl, auth.token, `P1 state A ${stamp}`, model);
  const convB = await createConversation(apiBaseUrl, auth.token, `P1 state B ${stamp}`, model);
  let cleanup;
  const { browser, page } = await openAuthedPage({ baseUrl: frontendBaseUrl, token: auth.token, user: auth.user, sessionToken: auth.sessionToken, refreshToken: auth.refreshToken, viewport: { width: 1440, height: 980 } });
  const events = { requests: [], responses: [], console: [], errors: [], requestfailed: [] };
  page.on('request', (req) => { const u = req.url(); if (u.includes('/api/chat') || u.includes('/api/tasks/') || u.includes('/api/conversations')) events.requests.push({ method: req.method(), url: u }); });
  page.on('response', (res) => { const u = res.url(); if (u.includes('/api/chat') || u.includes('/api/tasks/') || u.includes('/api/conversations')) events.responses.push({ status: res.status(), url: u }); });
  page.on('console', (msg) => events.console.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (error) => events.errors.push(String(error).slice(0, 300)));
  page.on('requestfailed', (req) => events.requestfailed.push({ method: req.method(), url: req.url(), failure: req.failure()?.errorText || '' }));

  const samples = [];
  try {
    await page.addInitScript(({ model }) => {
      localStorage.setItem('selected-model', model);
      localStorage.setItem('recent-models', JSON.stringify([model]));
      localStorage.setItem('search-enabled', 'false');
      localStorage.setItem('reasoning-enabled', 'false');
    }, { model });
    await page.goto(`${frontendBaseUrl}/chat/?id=${convA.id}&p1_state=${stamp}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

    await sendPromptFromUi(page, env('P1_STATE_PROMPT', `P1 状态一致性 live probe ${stamp}：请写一篇中文长文，分 10 段说明聊天界面 pending、停止、恢复和切换会话时需要保持稳定。每段不少于 90 字。`));
    for (const [label, delay] of [['after-send-100ms', 100], ['after-send-500ms', 400], ['after-send-1200ms', 700]]) {
      await page.waitForTimeout(delay);
      samples.push(await sample(page, label));
    }

    await clickConversation(page, convB.id, Number(env('P1_SWITCH_AWAY_MS', '250')));
    samples.push(await sample(page, 'after-switch-away'));
    await clickConversation(page, convA.id, Number(env('P1_SWITCH_BACK_MS', '500')));
    for (const [label, delay] of [['after-switch-back-150ms', 150], ['after-switch-back-700ms', 550], ['after-switch-back-1500ms', 800]]) {
      await page.waitForTimeout(delay);
      samples.push(await sample(page, label));
    }

    const clickedStop = await clickStopIfPresent(page);
    await page.waitForTimeout(Number(env('P1_AFTER_STOP_MS', '1200')));
    samples.push(await sample(page, `after-stop-clicked-${clickedStop}`));
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(Number(env('P1_AFTER_RELOAD_MS', '1800')));
    samples.push(await sample(page, 'after-reload'));

    if (!clickedStop) {
      await waitForIdle(page, Number(env('P1_WAIT_IDLE_MS', '120000'))).catch(() => {});
      samples.push(await sample(page, 'after-idle-wait'));
    }

    const boot = await apiJson(apiBaseUrl, `/api/chat/bootstrap?id=${convA.id}&message_tail=32&conversation_limit=30`, auth.token);
    const latest = [...(boot.snapshot?.messages || [])].reverse().find((message) => message.role === 'assistant') || null;
    const analysis = analyze(samples);
    const result = {
      ok: analysis.duplicateIds.length === 0
        && analysis.hasAnyAssistantBinding
        && !analysis.hasStopAfterStopClick
        && events.errors.length === 0
        && summarizeConsole(events.console).filter((item) => item.type === 'error').length === 0,
      apiBaseUrl,
      frontendBaseUrl,
      model,
      convA: convA.id,
      convB: convB.id,
      clickedStop,
      analysis,
      backendLatestAssistant: latest ? {
        id: latest.id,
        generation_task_id: latest.generation_task_id,
        generation_status: latest.generation_status,
        phase: latest.phase,
        stopped: latest.stopped,
        contentLen: (latest.content || '').length,
      } : null,
      activeTasks: boot.active_tasks?.chat || [],
      samples,
      requestsTail: events.requests.slice(-40),
      responsesTail: events.responses.slice(-40),
      requestfailed: events.requestfailed.slice(-20),
      consoleErrors: summarizeConsole(events.console),
      pageErrors: events.errors,
    };
    cleanup = await cleanupConversations({ baseUrl: apiBaseUrl, token: auth.token, conversationIds: [convA.id, convB.id] });
    result.cleanup = cleanup;
    printResult(result);
    if (!result.ok) process.exit(2);
  } finally {
    await browser.close().catch(() => {});
    if (!cleanup) {
      await cleanupConversations({ baseUrl: apiBaseUrl, token: auth.token, conversationIds: [convA.id, convB.id] }).catch(() => {});
    }
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
