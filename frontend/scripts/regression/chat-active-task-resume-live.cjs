#!/usr/bin/env node
const { env, login, openAuthedPage, summarizeConsole, printResult } = require('./chat-live-utils.cjs');

(async () => {
  const baseUrl = env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz');
  const requestedConversationId = Number(env('TESTNET_ACTIVE_CONVERSATION_ID') || env('TESTNET_CONVERSATION_ID') || 0) || undefined;
  const requireActive = env('REQUIRE_ACTIVE_TASK') === '1';
  const auth = await login({ baseUrl });
  const bootstrapUrl = new URL(`${baseUrl}/api/chat/bootstrap`);
  if (requestedConversationId) bootstrapUrl.searchParams.set('id', String(requestedConversationId));
  bootstrapUrl.searchParams.set('message_tail', '32');
  bootstrapUrl.searchParams.set('conversation_limit', '30');
  const bootstrapRes = await fetch(bootstrapUrl, { headers: { Authorization: `Bearer ${auth.token}` } });
  if (!bootstrapRes.ok) throw new Error(`bootstrap ${bootstrapRes.status}: ${await bootstrapRes.text()}`);
  const bootstrap = await bootstrapRes.json();
  const activeTasks = bootstrap?.active_tasks?.chat || [];
  const targetTask = activeTasks.find((task) => task.conversation_id && task.assistant_message_id);
  if (!targetTask) {
    const result = { ok: !requireActive, skipped: true, reason: 'no active chat tasks in bootstrap', activeTaskCount: activeTasks.length };
    printResult(result);
    if (!result.ok) process.exit(2);
    return;
  }
  const conversationId = targetTask.conversation_id;
  const { browser, page } = await openAuthedPage({ baseUrl, token: auth.token, user: auth.user });
  const events = { requests: [], responses: [], console: [], errors: [] };
  page.on('request', (req) => { const u = req.url(); if (u.includes('/api/tasks/') || u.includes('/api/chat/bootstrap')) events.requests.push({ method: req.method(), url: u }); });
  page.on('response', (res) => { const u = res.url(); if (u.includes('/api/tasks/') || u.includes('/api/chat/bootstrap')) events.responses.push({ status: res.status(), url: u }); });
  page.on('console', (msg) => events.console.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (error) => events.errors.push(String(error).slice(0, 300)));
  await page.goto(`${baseUrl}/chat/?id=${conversationId}&active_resume=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(8000);
  const mainText = await page.locator('main').innerText().catch(() => '');
  await browser.close();
  const taskStreamRequest = events.requests.find((item) => item.url.includes(`/api/tasks/${targetTask.id}/stream`) && item.url.includes(`after=${targetTask.last_sequence_number || 0}`));
  const taskStreamResponse = events.responses.find((item) => item.url.includes(`/api/tasks/${targetTask.id}/stream`));
  const result = {
    conversationId,
    activeTaskCount: activeTasks.length,
    targetTask,
    taskStreamRequested: Boolean(taskStreamRequest),
    taskStreamStatus: taskStreamResponse?.status,
    requests: events.requests,
    responsesTail: events.responses.slice(-20),
    errors: events.errors,
    consoleErrors: summarizeConsole(events.console),
    mainTail: mainText.slice(-1000),
  };
  result.ok = Boolean(taskStreamRequest) && (!taskStreamResponse || taskStreamResponse.status < 500) && events.errors.length === 0;
  printResult(result);
  if (!result.ok) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
