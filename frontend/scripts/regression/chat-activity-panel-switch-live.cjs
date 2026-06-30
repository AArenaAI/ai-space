#!/usr/bin/env node
const { env, login, openAuthedPage, summarizeConsole, printResult } = require('./chat-live-utils.cjs');

function parseSseDataChunk(raw) {
  return raw.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
}

async function createConversation(baseUrl, token, title, model) {
  const res = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title, model }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`conversation create ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function startAndInterruptReasoning({ baseUrl, token, conversationId, model }) {
  const prompt = env('ACTIVITY_SWITCH_PROMPT', '请联网搜索一个最新AI产品新闻，然后先进行较长中文思考，分三段分析背景、影响和风险，最后只给一句简短总结。');
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model,
      conversation_id: conversationId,
      stream: true,
      reasoning: true,
      search: true,
      template_id: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok || !res.body) throw new Error(`chat start ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let task;
  let reasoningLength = 0;
  let contentLength = 0;
  const startedAt = Date.now();
  while (Date.now() - startedAt < Number(env('ACTIVITY_SWITCH_OBSERVE_MS', '18000'))) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';
    for (const chunk of chunks) {
      const data = parseSseDataChunk(chunk);
      if (!data || data === '[DONE]') continue;
      let json;
      try { json = JSON.parse(data); } catch { continue; }
      const delta = json.choices?.[0]?.delta || {};
      if (typeof delta.reasoning_content === 'string') reasoningLength += delta.reasoning_content.length;
      if (typeof delta.reasoning === 'string') reasoningLength += delta.reasoning.length;
      if (typeof delta.content === 'string') contentLength += delta.content.length;
      if (json._generation_task) task = json._generation_task;
    }
    if (task && (reasoningLength >= Number(env('ACTIVITY_SWITCH_MIN_REASONING_CHARS', '20')) || contentLength >= 20)) break;
  }
  await reader.cancel().catch(() => {});
  if (!task) throw new Error('did not observe _generation_task before interrupt');
  return { task, reasoningLength, contentLength };
}

async function openActivityPanel(page) {
  const button = page.locator('button').filter({ hasText: /思考中|已思考|Reasoning|Reasoned/ }).last();
  await button.waitFor({ state: 'visible', timeout: 20000 });
  await button.click({ timeout: 5000 });
  await page.locator('[data-chat-activity-panel="true"]').waitFor({ state: 'visible', timeout: 10000 });
}

function extractReasoningFromPanelText(text) {
  const after = text.split(/(?:深度推理|Reasoning|Reasoned)[^\n]*/).slice(1).join('');
  return after.split(/(?:回答完成|Generated|网页 ·|Web ·|来源 1|Source 1)/)[0] || '';
}

async function samplePanelReasoning(page, count = 20, intervalMs = 80) {
  const samples = [];
  for (let i = 0; i < count; i += 1) {
    const text = await page.locator('[data-chat-activity-panel="true"]').innerText();
    const reasoning = extractReasoningFromPanelText(text);
    samples.push({ t: i * intervalMs, len: reasoning.length, text: reasoning.slice(0, 120).replace(/\s+/g, ' ') });
    await page.waitForTimeout(intervalMs);
  }
  return samples;
}

(async () => {
  const baseUrl = env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz');
  const model = env('ACTIVITY_SWITCH_MODEL', env('REAL_CHAT_MODEL', 'deepseek-v4-pro'));
  const auth = await login({ baseUrl });
  const conversationA = await createConversation(baseUrl, auth.token, `Activity switch A ${Date.now()}`, model);
  const conversationB = await createConversation(baseUrl, auth.token, `Activity switch B ${Date.now()}`, model);
  const interrupted = await startAndInterruptReasoning({ baseUrl, token: auth.token, conversationId: conversationA.id, model });

  const { browser, page } = await openAuthedPage({ baseUrl, token: auth.token, user: auth.user });
  const events = { requests: [], responses: [], console: [], errors: [] };
  page.on('request', (req) => { const u = req.url(); if (u.includes('/api/tasks/') || u.includes('/api/chat/bootstrap')) events.requests.push({ method: req.method(), url: u }); });
  page.on('response', (res) => { const u = res.url(); if (u.includes('/api/tasks/') || u.includes('/api/chat/bootstrap')) events.responses.push({ status: res.status(), url: u }); });
  page.on('console', (msg) => events.console.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (error) => events.errors.push(String(error).slice(0, 300)));

  await page.goto(`${baseUrl}/chat/?id=${conversationA.id}&activity_switch_a=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(Number(env('ACTIVITY_SWITCH_INITIAL_WAIT_MS', '1500')));
  await openActivityPanel(page);
  const beforeSwitch = await samplePanelReasoning(page, 8, 80);

  await page.goto(`${baseUrl}/chat/?id=${conversationB.id}&activity_switch_b=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(Number(env('ACTIVITY_SWITCH_AWAY_MS', '1800')));

  await page.goto(`${baseUrl}/chat/?id=${conversationA.id}&activity_switch_back=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(Number(env('ACTIVITY_SWITCH_BACK_WAIT_MS', '1000')));
  await openActivityPanel(page);
  const afterSwitch = await samplePanelReasoning(page, 24, 80);
  const panelText = await page.locator('[data-chat-activity-panel="true"]').innerText().catch(() => '');
  await browser.close();

  const beforeLens = beforeSwitch.map((sample) => sample.len);
  const afterLens = afterSwitch.map((sample) => sample.len);
  const afterDistinct = new Set(afterLens).size;
  const afterPositive = afterLens.slice(1).map((value, index) => value - afterLens[index]).filter((delta) => delta > 0);
  const maxJump = afterPositive.length ? Math.max(...afterPositive) : 0;
  const streamRequested = events.requests.some((item) => item.url.includes(`/api/tasks/${interrupted.task.id}/stream`));
  const hasActivityPanel = panelText.includes('思考与来源') || panelText.includes('Reasoning') || panelText.includes('Reasoned');
  const result = {
    conversationA: conversationA.id,
    conversationB: conversationB.id,
    taskId: interrupted.task.id,
    interrupted,
    streamRequested,
    hasActivityPanel,
    beforeLens,
    afterLens,
    afterDistinct,
    maxJump,
    beforeSwitch,
    afterSwitch,
    requests: events.requests,
    responsesTail: events.responses.slice(-20),
    errors: events.errors,
    consoleErrors: summarizeConsole(events.console),
    panelHead: panelText.slice(0, 1000),
  };
  result.ok = Boolean(streamRequested) && hasActivityPanel && afterDistinct >= 2 && maxJump <= 30 && events.errors.length === 0;
  printResult(result);
  if (!result.ok) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
