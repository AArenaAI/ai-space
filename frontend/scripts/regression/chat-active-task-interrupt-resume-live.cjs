#!/usr/bin/env node
const { authHeaders, cleanupConversations, env, login, openAuthedPage, summarizeConsole, printResult } = require('./chat-live-utils.cjs');

function parseSseDataChunk(raw) {
  return raw.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
}

async function createConversation(baseUrl, token, model) {
  const res = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ title: `Active resume live ${Date.now()}`, model }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`conversation create ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function startAndInterruptGeneration({ baseUrl, token, conversationId, model }) {
  const prompt = env('ACTIVE_RESUME_PROMPT', '请写一篇较长的中文说明，分 12 段解释 AI Space 聊天生成任务为什么需要支持刷新后恢复。每段不少于 80 字，慢慢写，不要列表化。');
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
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
  let content = '';
  let task;
  let lastSequence = 0;
  const startedAt = Date.now();
  while (Date.now() - startedAt < Number(env('ACTIVE_RESUME_OBSERVE_MS', '12000'))) {
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
      if (json._generation_task) {
        task = json._generation_task;
        lastSequence = Number(task.last_sequence_number || task.lastSequence || lastSequence || 0);
      }
      const idLine = chunk.split('\n').find((line) => line.startsWith('id:'));
      if (idLine) lastSequence = Math.max(lastSequence, Number(idLine.slice(3).trim()) || 0);
    }
    if (task && content.length >= Number(env('ACTIVE_RESUME_MIN_CHARS', '40'))) break;
  }
  await reader.cancel().catch(() => {});
  if (!task) throw new Error('did not observe _generation_task before interrupt');
  return { task, contentLength: content.length, lastSequence };
}

(async () => {
  const baseUrl = env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz');
  const apiBaseUrl = env('ACTIVE_INTERRUPT_API_BASE_URL', baseUrl).replace(/\/+$/, '');
  const frontendBaseUrl = env('ACTIVE_INTERRUPT_FRONTEND_BASE_URL', baseUrl).replace(/\/+$/, '');
  const model = env('ACTIVE_RESUME_MODEL', env('REAL_CHAT_MODEL', 'gpt-5.5'));
  const auth = await login({ baseUrl: apiBaseUrl });
  const conversation = await createConversation(apiBaseUrl, auth, model);
  let cleanup;
  const interrupted = await startAndInterruptGeneration({ baseUrl: apiBaseUrl, auth, conversationId: conversation.id, model });
  await new Promise((resolve) => setTimeout(resolve, Number(env('ACTIVE_RESUME_REOPEN_DELAY_MS', '1500'))));
  const bootstrapRes = await fetch(`${apiBaseUrl}/api/chat/bootstrap?id=${conversation.id}&message_tail=32&conversation_limit=30`, {
    headers: { ...authHeaders(auth) },
  });
  const bootstrap = await bootstrapRes.json();
  const activeTasks = bootstrap?.active_tasks?.chat || [];
  const matchingTask = activeTasks.find((item) => Number(item.id) === Number(interrupted.task.id || interrupted.task.task_id));
  const assistantMessageId = Number(interrupted.task.assistant_message_id);
  const snapshotHasAssistant = (bootstrap?.snapshot?.messages || []).some((message) => Number(message.id) === assistantMessageId);
  if (!matchingTask) {
    const completed = bootstrap?.snapshot?.last_assistant_status?.background_task?.status;
    const result = { ok: true, skipped: true, reason: 'task completed before reload; no active task to resume', apiBaseUrl, frontendBaseUrl, conversationId: conversation.id, interrupted, activeTaskCount: activeTasks.length, lastStatus: completed, snapshotHasAssistant };
    result.cleanup = await cleanupConversations({ baseUrl: apiBaseUrl, auth, conversationIds: [conversation.id] });
    printResult(result);
    return;
  }
  const { browser, page } = await openAuthedPage({ baseUrl: frontendBaseUrl, auth, user: auth.user, sessionToken: auth.sessionToken, refreshToken: auth.refreshToken });
  const events = { requests: [], responses: [], console: [], errors: [] };
  page.on('request', (req) => { const u = req.url(); if (u.includes('/api/tasks/') || u.includes('/api/chat/bootstrap')) events.requests.push({ method: req.method(), url: u }); });
  page.on('response', (res) => { const u = res.url(); if (u.includes('/api/tasks/') || u.includes('/api/chat/bootstrap')) events.responses.push({ status: res.status(), url: u }); });
  page.on('console', (msg) => events.console.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (error) => events.errors.push(String(error).slice(0, 300)));
  await page.goto(`${frontendBaseUrl}/chat/?id=${conversation.id}&active_interrupt_resume=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(Number(env('ACTIVE_RESUME_VERIFY_MS', '9000')));
  const mainText = await page.locator('main').innerText().catch(() => '');
  await browser.close();
  const taskId = Number(matchingTask.id);
  const expectedAfter = Number(matchingTask.last_sequence_number || 0);
  const streamRequest = events.requests.find((item) => item.url.includes(`/api/tasks/${taskId}/stream`));
  const actualAfter = streamRequest ? Number(new URL(streamRequest.url).searchParams.get('after') || 0) : 0;
  const finalBootstrapRes = await fetch(`${apiBaseUrl}/api/chat/bootstrap?id=${conversation.id}&message_tail=32&conversation_limit=30`, {
    headers: { ...authHeaders(auth) },
  });
  const finalBootstrap = await finalBootstrapRes.json().catch(() => ({}));
  const finalStatus = finalBootstrap?.snapshot?.last_assistant_status;
  const finalCompleted = finalStatus?.background_task?.status === 'completed' || finalStatus?.message?.generation_status === 'completed' || finalStatus?.message?.phase === 'completed';
  const finalContentLen = (finalStatus?.message?.content || '').length;
  const result = { apiBaseUrl, frontendBaseUrl, conversationId: conversation.id, interrupted, matchingTask, snapshotHasAssistant, streamRequested: Boolean(streamRequest), expectedAfter, actualAfter, finalCompleted, finalContentLen, requests: events.requests, responsesTail: events.responses.slice(-20), errors: events.errors, consoleErrors: summarizeConsole(events.console), mainTail: mainText.slice(-1000) };
  result.ok = snapshotHasAssistant && events.errors.length === 0 && (
    (Boolean(streamRequest) && actualAfter >= expectedAfter) ||
    (!streamRequest && finalCompleted && finalContentLen > 0 && mainText.trim().length > 0)
  );
  cleanup = await cleanupConversations({ baseUrl: apiBaseUrl, auth, conversationIds: [conversation.id] });
  result.cleanup = cleanup;
  printResult(result);
  if (!result.ok) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
