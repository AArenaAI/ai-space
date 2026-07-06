#!/usr/bin/env node
const { cleanupConversations, env, login, openAuthedPage, printResult, summarizeConsole } = require('./chat-live-utils.cjs');

function passwordFromCodes() {
  const codes = env('TESTNET_PASSWORD_CODES');
  if (!codes) return '';
  return codes.split(',').map((item) => String.fromCharCode(Number(item.trim()))).join('');
}

function parseSseDataChunk(raw) {
  return raw.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
}

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${url} ${res.status}: ${text.slice(0, 500)}`);
  return data;
}

async function streamTaskToDone({ baseUrl, token, taskId }) {
  const res = await fetch(`${baseUrl}/api/tasks/${taskId}/stream?after=0`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok || !res.body) throw new Error(`stream task ${taskId} ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawDone = false;
  let reasoningLength = 0;
  let contentLength = 0;
  const startedAt = Date.now();
  while (Date.now() - startedAt < Number(env('COMPARE_ACTIVITY_STREAM_TIMEOUT_MS', '120000'))) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';
    for (const chunk of chunks) {
      const data = parseSseDataChunk(chunk);
      if (!data) continue;
      if (data === '[DONE]') {
        sawDone = true;
        break;
      }
      let json;
      try { json = JSON.parse(data); } catch { continue; }
      const delta = json.choices?.[0]?.delta || {};
      if (typeof delta.reasoning_content === 'string') reasoningLength += delta.reasoning_content.length;
      if (typeof delta.reasoning === 'string') reasoningLength += delta.reasoning.length;
      if (typeof delta.content === 'string') contentLength += delta.content.length;
      if (json.type === 'done' || json.status === 'completed') sawDone = true;
    }
    if (sawDone) break;
  }
  await reader.cancel().catch(() => {});
  return { sawDone, reasoningLength, contentLength };
}

async function createCompareConversation({ baseUrl, token, models, prompt }) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const conversation = await jsonFetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: `Compare Activity Dual ${Date.now()}`, model: models[0] }),
  });
  await jsonFetch(`${baseUrl}/api/conversations/${conversation.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ compare: true, compare_models: JSON.stringify(models) }),
  });
  const init = await jsonFetch(`${baseUrl}/api/chat/compare/init`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      conversation_id: conversation.id,
      content: prompt,
      model: models[0],
      compare_models: models,
    }),
  });

  const tasks = [];
  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const initTask = await jsonFetch(`${baseUrl}/api/chat/init`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
        init_only: true,
        conversation_id: conversation.id,
        reasoning_effort: 'thinking',
        search: env('COMPARE_ACTIVITY_SEARCH', '0') === '1',
        template_id: 0,
        skip_save_user_msg: true,
        group_id: init.group.id,
        user_message_id: init.user_message.id,
        group_index: index,
        group_models: models,
      }),
    });
    const taskId = Number(initTask.task_id || initTask.assistant_message?.generation_task_id || 0);
    const assistantMessageId = Number(initTask.assistant_message_id || initTask.assistant_message?.id || 0);
    if (!taskId) throw new Error(`missing task_id for ${model}: ${JSON.stringify(initTask).slice(0, 500)}`);
    tasks.push({ model, taskId, assistantMessageId, stream: await streamTaskToDone({ baseUrl, token, taskId }) });
  }
  return { conversation, init, tasks };
}

async function chooseCompareModeIfNeeded(page) {
  const compareText = page.getByText(/Compare|对比|比较/).first();
  if (await compareText.count().catch(() => 0)) {
    // No-op: existing route bootstrap should open compare conversations in compare mode.
  }
}

async function clickAllReasoningEntries(page) {
  const buttons = await page.locator('button').filter({ hasText: /思考|Reasoning|Reasoned/ }).all();
  let clicked = 0;
  const seen = new Set();
  for (const button of buttons.reverse()) {
    if (clicked >= 2) break;
    const box = await button.boundingBox().catch(() => null);
    const text = (await button.innerText().catch(() => '')).trim();
    const key = `${Math.round(box?.x || 0)}:${Math.round(box?.y || 0)}:${text}`;
    if (!box || seen.has(key)) continue;
    seen.add(key);
    await button.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(350);
    clicked += 1;
  }
  return clicked;
}

async function selectActivityLayout(page, titlePattern) {
  const control = page.locator('[data-chat-compare-activity-layout="true"] button').first();
  await control.waitFor({ state: 'visible', timeout: 10000 });
  await control.click();
  const option = page.locator('button').filter({ hasText: titlePattern }).first();
  await option.waitFor({ state: 'visible', timeout: 10000 });
  await option.click();
  await page.waitForTimeout(600);
}

async function inspectActivity(page) {
  return page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll('[data-chat-activity-panel="true"]'));
    const variants = panels.map((panel) => panel.getAttribute('data-chat-activity-variant') || '');
    const owners = panels.map((panel) => panel.getAttribute('data-chat-activity-owner') || '');
    const fullTexts = panels.map((panel) => panel.textContent || '');
    const texts = fullTexts.map((text) => text.slice(0, 300));
    const sourceLinkCounts = panels.map((panel) => Array.from(panel.querySelectorAll('a[href^="http"]')).length);
    const hasProductProcessCopy = fullTexts.every((text) => text.includes('生成过程') && text.includes('模型思考'));
    const hasReferenceSources = panels.length > 0 && fullTexts.every((text) => text.includes('参考来源')) && sourceLinkCounts.every((count) => count > 0);
    const hasRepeatedReasoningHeading = texts.some((text) => text.includes('生成过程思考过程'));
    const compareColumns = Array.from(document.querySelectorAll('[data-chat-compare-column-shell="true"]'));
    const openColumnCount = compareColumns.filter((column) => column.querySelector('[data-chat-activity-panel="true"]')).length;
    const visiblePanels = panels.filter((panel) => {
      const rect = panel.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).length;
    return { panelCount: panels.length, visiblePanels, variants, owners, openColumnCount, hasProductProcessCopy, hasReferenceSources, sourceLinkCounts, hasRepeatedReasoningHeading, texts };
  });
}

(async () => {
  const baseUrl = env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz');
  const email = env('TESTNET_EMAIL');
  const password = env('TESTNET_PASSWORD') || passwordFromCodes();
  const models = (env('COMPARE_ACTIVITY_MODELS', 'deepseek-v4-pro,deepseek-v4-flash')).split(',').map((item) => item.trim()).filter(Boolean);
  const prompt = env('COMPARE_ACTIVITY_PROMPT', '请用中文简短分析 AI 产品新闻的背景、影响、风险。请保留思考过程，最后给一句总结。');
  const expectSources = env('COMPARE_ACTIVITY_SEARCH', '0') === '1';
  const auth = await login({ baseUrl, email, password });
  const created = await createCompareConversation({ baseUrl, token: auth.token, models, prompt });
  let cleanup;

  const { browser, page } = await openAuthedPage({
    baseUrl,
    token: auth.token,
    user: auth.user,
    sessionToken: auth.sessionToken,
    refreshToken: auth.refreshToken,
    viewport: { width: 1440, height: 1000 },
  });
  const consoleEvents = [];
  const pageErrors = [];
  page.on('console', (msg) => consoleEvents.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));
  let clickedInline = 0;
  let inline = {};
  let split = {};
  try {
    await page.goto(`${baseUrl}/chat/?id=${created.conversation.id}&compare_activity_dual=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await chooseCompareModeIfNeeded(page);
    await page.locator('[data-chat-compare-column-shell="true"]').first().waitFor({ state: 'visible', timeout: 20000 });

    await selectActivityLayout(page, /列内展开|inline/i);
    clickedInline = await clickAllReasoningEntries(page);
    inline = await inspectActivity(page);

    await selectActivityLayout(page, /列内侧栏|split/i);
    split = await inspectActivity(page);
  } finally {
    await browser.close().catch(() => {});
    cleanup = await cleanupConversations({ baseUrl, token: auth.token, conversationIds: [created.conversation.id] });
  }

  const result = {
    ok: clickedInline >= 2
      && inline.panelCount >= 2
      && inline.openColumnCount >= 2
      && split.panelCount >= 2
      && split.openColumnCount >= 2
      && split.variants.every((variant) => variant === 'embedded')
      && inline.owners.includes('左列')
      && inline.owners.includes('右列')
      && split.owners.includes('左列')
      && split.owners.includes('右列')
      && inline.hasProductProcessCopy
      && split.hasProductProcessCopy
      && (!expectSources || (inline.hasReferenceSources && split.hasReferenceSources))
      && !inline.hasRepeatedReasoningHeading
      && !split.hasRepeatedReasoningHeading
      && pageErrors.length === 0,
    conversationId: created.conversation.id,
    models,
    tasks: created.tasks,
    clickedInline,
    inline,
    split,
    cleanup,
    consoleErrors: summarizeConsole(consoleEvents),
    pageErrors,
  };
  printResult(result);
  if (!result.ok) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
