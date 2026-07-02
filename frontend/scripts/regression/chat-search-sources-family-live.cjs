#!/usr/bin/env node
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { env, login, printResult, summarizeConsole } = require('./chat-live-utils.cjs');

function passwordFromCodes() {
  const codes = env('TESTNET_PASSWORD_CODES');
  if (!codes) return '';
  return codes.split(',').map((item) => String.fromCharCode(Number(item.trim()))).join('');
}

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${url} ${res.status}: ${text.slice(0, 500)}`);
  return data;
}

function parseSseDataChunk(raw) {
  return raw.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
}

async function streamTaskToDone({ baseUrl, token, taskId, timeoutMs = 180000 }) {
  const res = await fetch(`${baseUrl}/api/tasks/${taskId}/stream?after=0`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok || !res.body) throw new Error(`stream task ${taskId} ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawDone = false;
  let contentLength = 0;
  let reasoningLength = 0;
  let sourceEvents = 0;
  let sourceEventCount = 0;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
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
      if (typeof delta.content === 'string') contentLength += delta.content.length;
      if (typeof delta.reasoning_content === 'string') reasoningLength += delta.reasoning_content.length;
      if (json._activity_meta?.sources?.length || json._search_meta?.sources?.length) {
        sourceEvents += 1;
        sourceEventCount = Math.max(sourceEventCount, json._activity_meta?.sources?.length || json._search_meta?.sources?.length || 0);
      }
    }
    if (sawDone) break;
  }
  await reader.cancel().catch(() => {});
  return { sawDone, contentLength, reasoningLength, sourceEvents, sourceEventCount };
}

function parseSources(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function latestAssistant(snapshot) {
  const messages = snapshot?.snapshot?.messages || snapshot?.messages || [];
  return [...messages].reverse().find((message) => message.role === 'assistant') || null;
}

async function createAndRun({ baseUrl, token, model, prompt }) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const conversation = await jsonFetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: `Source Smoke ${model} ${Date.now()}`, model }),
  });
  const init = await jsonFetch(`${baseUrl}/api/chat/init`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      init_only: true,
      conversation_id: conversation.id,
      reasoning_effort: env('SEARCH_SOURCE_REASONING_EFFORT', 'off'),
      search: true,
      template_id: 0,
      client_timezone: 'Asia/Shanghai',
    }),
  });
  const taskId = Number(init.task_id || init.task?.id || init.assistant_message?.generation_task_id || 0);
  if (!taskId) throw new Error(`missing task id for ${model}: ${JSON.stringify(init).slice(0, 500)}`);
  const stream = await streamTaskToDone({ baseUrl, token, taskId });
  const bootstrap = await jsonFetch(`${baseUrl}/api/chat/bootstrap?id=${conversation.id}&message_tail=16&conversation_limit=20`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const assistant = latestAssistant(bootstrap);
  const sources = parseSources(assistant?.search_sources || assistant?.searchSources);
  const sourceCount = Number((assistant?.search_sources_count ?? assistant?.searchSourcesCount ?? sources.length) || 0);
  return { conversation, init, taskId, stream, assistant, sources, sourceCount };
}

async function inspectActivityPanel({ baseUrl, auth, conversationId }) {
  const browser = await chromium.launch({ headless: env('HEADFUL') !== '1' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleEvents = [];
  const pageErrors = [];
  page.on('console', (msg) => consoleEvents.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  }, { token: auth.token, user: auth.user });
  try {
    await page.goto(`${baseUrl}/chat/?id=${conversationId}&source_smoke=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.locator('[data-chat-message-row="true"][data-message-role="assistant"]').last().waitFor({ state: 'visible', timeout: 30000 });
    const entry = page.locator('button').filter({ hasText: /来源|查看来源|已思考|思考中/ }).last();
    const entryCount = await entry.count().catch(() => 0);
    if (entryCount > 0) {
      await entry.click({ timeout: 10000 });
      await page.locator('[data-chat-activity-panel="true"]').last().waitFor({ state: 'visible', timeout: 10000 });
    }
    const activity = await page.evaluate(() => {
      const panel = Array.from(document.querySelectorAll('[data-chat-activity-panel="true"]')).pop();
      const text = panel ? (panel.textContent || '') : '';
      const sourceLinks = panel ? Array.from(panel.querySelectorAll('a[href^="http"]')).map((a) => ({ href: a.href, text: (a.textContent || '').trim().slice(0, 120) })) : [];
      return {
        hasPanel: !!panel,
        title: panel?.getAttribute('data-chat-activity-title') || '',
        hasReferenceSection: /参考来源/.test(text),
        sourceLinkCount: sourceLinks.length,
        sourceLinks,
        textPrefix: text.slice(0, 300),
      };
    });
    return { ...activity, consoleErrors: summarizeConsole(consoleEvents), pageErrors };
  } finally {
    await browser.close();
  }
}

(async () => {
  const baseUrl = env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz');
  const email = env('TESTNET_EMAIL');
  const password = env('TESTNET_PASSWORD') || passwordFromCodes();
  const auth = await login({ baseUrl, email, password });
  const models = (env('SEARCH_SOURCE_MODELS', 'gpt-5.4-mini,gemini-3.5-flash,deepseek-v4-flash,kimi-k2.5'))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const prompt = env('SEARCH_SOURCE_PROMPT', '请联网搜索并用中文简短回答：OpenAI、Google Gemini、DeepSeek、Kimi 最近一次公开产品更新分别是什么？回答只要三到五点，并确保基于搜索来源。');

  const results = [];
  for (const model of models) {
    const run = await createAndRun({ baseUrl, token: auth.token, model, prompt });
    const activity = await inspectActivityPanel({ baseUrl, auth, conversationId: run.conversation.id });
    results.push({
      model,
      conversationId: run.conversation.id,
      taskId: run.taskId,
      stream: run.stream,
      sourceCount: run.sourceCount,
      sources: run.sources.slice(0, 5).map((source) => ({ title: source.title, url: source.url })),
      assistantStatus: run.assistant?.generation_status || run.assistant?.server_generation_status || '',
      contentLength: run.assistant?.content?.length || 0,
      activity,
    });
  }

  const result = {
    ok: results.every((item) =>
      item.stream.sawDone
      && item.assistantStatus === 'completed'
      && item.sourceCount > 0
      && item.sources.every((source) => source.url)
      && item.activity.hasPanel
      && item.activity.hasReferenceSection
      && item.activity.sourceLinkCount > 0
      && item.activity.consoleErrors.length === 0
      && item.activity.pageErrors.length === 0
    ),
    models,
    results,
  };
  printResult(result);
  if (!result.ok) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
