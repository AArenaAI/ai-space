#!/usr/bin/env node
const { authHeaders, env, login, openAuthedPage, summarizeConsole, printResult } = require('./chat-live-utils.cjs');

const FORBIDDEN_RUNNING_PANEL_TEXT = /(正在推理|推理中|正在处理|Reasoning\s*·|Processing|Generating)/i;

async function openLatestActivityPanel(page) {
  const reasoningButton = page.locator('button').filter({ hasText: /已思考|思考中/ }).last();
  if (await reasoningButton.count()) {
    await reasoningButton.click({ timeout: 5000 });
    return 'reasoning-button';
  }
  const statusButton = page.locator('[data-chat-status-icon="completed"], [data-chat-status-icon="thinking"], [data-chat-status-icon="spinning"]').last();
  if (await statusButton.count()) {
    await statusButton.click({ timeout: 5000 });
    return 'status-icon';
  }
  throw new Error('No activity entry button found on latest assistant message');
}

async function panelText(page) {
  const panel = page.locator('[data-chat-activity-panel="true"]');
  await panel.waitFor({ state: 'visible', timeout: 5000 });
  return panel.innerText();
}

(async () => {
  const baseUrl = env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz');
  const conversationId = Number(env('TESTNET_CONVERSATION_ID') || env('CHAT_ACTIVITY_CONVERSATION_ID') || 1168);
  const rounds = Number(env('CHAT_ACTIVITY_PANEL_ROUNDS') || 3);
  const auth = await login({ baseUrl });
  const { browser, page } = await openAuthedPage({ baseUrl, auth, user: auth.user, sessionToken: auth.sessionToken, refreshToken: auth.refreshToken });
  const events = { console: [], errors: [], responses: [] };
  page.on('console', (msg) => events.console.push({ type: msg.type(), text: msg.text().slice(0, 500) }));
  page.on('pageerror', (error) => events.errors.push(String(error).slice(0, 500)));
  page.on('response', (res) => {
    if (res.url().includes('/api/tasks/') || res.url().includes('/api/chat/bootstrap')) {
      events.responses.push({ status: res.status(), url: res.url() });
    }
  });

  await page.goto(`${baseUrl}/chat/?id=${conversationId}&activity_terminal_check=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForSelector('[data-chat-message-row="true"]', { timeout: 30000 });
  await page.locator('[data-chat-message-row="true"]').last().scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);

  const samples = [];
  for (let i = 0; i < rounds; i += 1) {
    const openedBy = await openLatestActivityPanel(page);
    const immediate = await panelText(page);
    await page.waitForTimeout(300);
    const after300 = await panelText(page);
    await page.waitForTimeout(900);
    const after1200 = await panelText(page);
    samples.push({ round: i + 1, openedBy, immediate, after300, after1200 });
    await page.locator('[data-chat-activity-panel="true"] button[aria-label="Close activity panel"]').click({ timeout: 5000 });
    await page.waitForTimeout(200);
  }

  await browser.close();
  const forbiddenHits = samples.flatMap((sample) => ['immediate', 'after300', 'after1200']
    .filter((key) => FORBIDDEN_RUNNING_PANEL_TEXT.test(sample[key]))
    .map((key) => ({ round: sample.round, key, text: sample[key].slice(0, 800) })));
  const result = {
    conversationId,
    rounds,
    ok: forbiddenHits.length === 0 && events.errors.length === 0,
    forbiddenHits,
    samples: samples.map((sample) => ({
      round: sample.round,
      openedBy: sample.openedBy,
      immediateHead: sample.immediate.slice(0, 400),
      after300Head: sample.after300.slice(0, 400),
      after1200Head: sample.after1200.slice(0, 400),
    })),
    taskResponses: events.responses.slice(-20),
    errors: events.errors,
    consoleErrors: summarizeConsole(events.console),
  };
  printResult(result);
  if (!result.ok) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
