#!/usr/bin/env node
const { authHeaders, env, login, openAuthedPage, summarizeConsole, printResult } = require('./chat-live-utils.cjs');

async function apiJson(url, token, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(token), ...(init.headers || {}) },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${url} ${res.status}: ${text.slice(0, 500)}`);
  return data;
}

async function createConversation(baseUrl, token, title, model) {
  return apiJson(`${baseUrl}/api/conversations`, token, {
    method: 'POST',
    body: JSON.stringify({ title, model }),
  });
}

function parseSseDataChunk(raw) {
  return raw.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
}

async function startGeneration({ baseUrl, token, auth, conversationId, model }) {
  const prompt = env(
    'STOP_BUTTON_PROMPT',
    '请写一篇中文长文，分 18 段解释聊天界面多次切换会话时为什么停止按钮容易出现竞态。每段不少于 90 字。'
  );
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(auth || token) },
    body: JSON.stringify({
      model,
      conversation_id: conversationId,
      stream: true,
      reasoning: false,
      search: false,
      template_id: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok || !res.body) throw new Error(`chat start ${res.status}: ${await res.text()}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let task = null;
  let content = '';
  const observeUntil = Date.now() + Number(env('STOP_BUTTON_OBSERVE_MS', '1800'));
  while (Date.now() < observeUntil) {
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
      if (typeof delta.content === 'string') content += delta.content;
      if (json._generation_task) task = json._generation_task;
    }
    if (task && content.length >= Number(env('STOP_BUTTON_MIN_CHARS', '4'))) break;
  }
  await reader.cancel().catch(() => {});
  if (!task) throw new Error('did not observe generation task');
  return { task, observedChars: content.length };
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

async function getButtonState(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('form button')).map((button) => ({
    type: button.getAttribute('type') || '',
    title: button.getAttribute('title') || '',
    aria: button.getAttribute('aria-label') || '',
    disabled: button.disabled,
    className: String(button.className || ''),
    text: (button.textContent || '').trim(),
  })).slice(-8));
}

function hasStop(buttons) {
  return buttons.some((b) => /停止|Stop|stop/i.test(`${b.title} ${b.aria}`) || /bg-red-500/.test(b.className));
}
function hasSubmit(buttons) {
  return buttons.some((b) => b.type === 'submit');
}

(async () => {
  const baseUrl = env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz');
  const apiBaseUrl = env('STOP_BUTTON_API_BASE_URL', baseUrl).replace(/\/+$/, '');
  const frontendBaseUrl = env('STOP_BUTTON_FRONTEND_BASE_URL', baseUrl).replace(/\/+$/, '');
  const model = env('STOP_BUTTON_MODEL', 'gpt-5.4-mini');
  const switchCount = Number(env('STOP_BUTTON_SWITCH_COUNT', '14'));
  const switchDelayMs = Number(env('STOP_BUTTON_SWITCH_DELAY_MS', '350'));
  const auth = await login({ baseUrl: apiBaseUrl });
  const stamp = Date.now();
  const convA = await createConversation(apiBaseUrl, auth, `Multi Switch A ${stamp}`, model);
  const convB = await createConversation(apiBaseUrl, auth, `Multi Switch B ${stamp}`, model);
  const generation = await startGeneration({ baseUrl: apiBaseUrl, auth, conversationId: convA.id, model });

  const { browser, page } = await openAuthedPage({ baseUrl: frontendBaseUrl, auth, user: auth.user, sessionToken: auth.sessionToken, refreshToken: auth.refreshToken });
  const events = { console: [], errors: [], responses: [], requestfailed: [] };
  page.on('console', (msg) => events.console.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (error) => events.errors.push(String(error).slice(0, 300)));
  page.on('requestfailed', (req) => events.requestfailed.push({ method: req.method(), url: req.url(), failure: req.failure()?.errorText || '' }));
  page.on('response', (res) => {
    const u = res.url();
    if (u.includes('/api/chat/bootstrap') || u.includes('/api/tasks/')) events.responses.push({ status: res.status(), url: u });
  });

  await page.goto(`${frontendBaseUrl}/chat/?multi_switch_probe=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-conversation-row]', { state: 'attached', timeout: 30000 });

  for (let i = 0; i < switchCount; i += 1) {
    await clickConversation(page, i % 2 === 0 ? convA.id : convB.id, switchDelayMs);
  }
  await clickConversation(page, convA.id, 1200);
  const stateAfterThrashReturn = await getButtonState(page);

  const deadline = Date.now() + Number(env('STOP_BUTTON_WAIT_DONE_MS', '160000'));
  let activeCount = -1;
  let lastStatus = null;
  while (Date.now() < deadline) {
    const boot = await apiJson(`${apiBaseUrl}/api/chat/bootstrap?id=${convA.id}&message_tail=32&conversation_limit=30`, auth);
    const active = boot?.active_tasks?.chat || [];
    activeCount = active.length;
    const matching = active.find((item) => Number(item.id) === Number(generation.task.id));
    lastStatus = boot?.snapshot?.last_assistant_status || null;
    if (!matching) break;
    await page.waitForTimeout(2500);
  }

  await page.waitForTimeout(Number(env('STOP_BUTTON_AFTER_DONE_WAIT_MS', '6000')));
  const stateAAfterDone = await getButtonState(page);
  const mainText = await page.locator('main').innerText().catch(() => '');
  const currentUrl = page.url();
  await browser.close();

  const result = {
    ok: !hasStop(stateAAfterDone) && hasSubmit(stateAAfterDone) && events.errors.length === 0,
    apiBaseUrl,
    frontendBaseUrl,
    currentUrl,
    convA: convA.id,
    convB: convB.id,
    switchCount,
    switchDelayMs,
    generation,
    activeCountAfterWait: activeCount,
    lastStatus,
    hasStopAfterThrashReturn: hasStop(stateAfterThrashReturn),
    hasStopAfterDone: hasStop(stateAAfterDone),
    hasSubmitAfterDone: hasSubmit(stateAAfterDone),
    stateAAfterDone,
    responsesTail: events.responses.slice(-50),
    requestfailed: events.requestfailed.slice(-20),
    consoleErrors: summarizeConsole(events.console),
    pageErrors: events.errors,
    mainTail: mainText.slice(-800),
  };
  printResult(result);
  if (!result.ok) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
