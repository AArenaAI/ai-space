#!/usr/bin/env node
const { chromium } = require('playwright');
const { authHeaders, DEFAULT_BASE, env, login, apiGet, summarizeConsole, printResult } = require('./chat-live-utils.cjs');

function parseInjectedPayload(html) {
  const marker = 'id="__AI_SPACE_BOOTSTRAP__" type="application/json">';
  const start = html.indexOf(marker);
  const end = start >= 0 ? html.indexOf('</script>', start) : -1;
  if (start < 0 || end < 0) return null;
  return JSON.parse(html.slice(start + marker.length, end));
}

function textNeedleFromPayload(payload) {
  const messages = payload?.snapshot?.messages || [];
  const userMessage = messages.find((message) => message.role === 'user' && typeof message.content === 'string' && message.content.trim());
  const assistantMessage = messages.find((message) => message.role === 'assistant' && typeof message.content === 'string' && message.content.trim());
  const source = userMessage?.content || assistantMessage?.content || '';
  return source.replace(/\s+/g, ' ').trim().slice(0, Number(env('DYNAMIC_SHELL_NEEDLE_LENGTH', '16')));
}

(async () => {
  const baseUrl = env('TESTNET_BASE_URL', DEFAULT_BASE).replace(/\/+$/, '');
  const auth = await login({ baseUrl });
  const initial = await apiGet('/api/chat/bootstrap?message_tail=32&conversation_limit=30', auth, { baseUrl });
  const configuredId = Number(env('DYNAMIC_SHELL_CONVERSATION_ID', '0')) || undefined;
  const conversationId = configuredId || initial?.sidebar?.conversations?.find((item) => item?.id)?.id;
  if (!conversationId) throw new Error('No conversation available for dynamic shell live test');

  const browser = await chromium.launch({ headless: env('HEADFUL') !== '1' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const loginResponse = await context.request.post(`${baseUrl}/api/auth/login`, {
    data: { email: env('TESTNET_EMAIL'), password: env('TESTNET_PASSWORD') },
  });
  if (!loginResponse.ok()) throw new Error(`browser login ${loginResponse.status()}: ${await loginResponse.text()}`);

  const shellResponse = await context.request.get(`${baseUrl}/chat/?id=${conversationId}&dynamic_shell_html_probe=${Date.now()}`);
  const shellHtml = await shellResponse.text();
  const payload = parseInjectedPayload(shellHtml);
  if (!payload) throw new Error('dynamic shell HTML missing __AI_SPACE_BOOTSTRAP__ payload');
  const needle = textNeedleFromPayload(payload);

  const page = await context.newPage();
  const requests = [];
  const responses = [];
  const consoleEvents = [];
  const pageErrors = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/chat/bootstrap') || url.includes('/chat/?') || url.includes('/chat?')) requests.push({ method: req.method(), url });
  });
  page.on('response', (res) => {
    const url = res.url();
    if (url.includes('/api/chat/bootstrap') || url.includes('/chat/?') || url.includes('/chat?')) {
      responses.push({ status: res.status(), url, dynamic: res.headers()['x-ai-space-dynamic-shell'] || '' });
    }
  });
  page.on('console', (msg) => consoleEvents.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));

  await page.goto(`${baseUrl}/chat/?id=${conversationId}&dynamic_shell_browser_probe=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(Number(env('DYNAMIC_SHELL_WAIT_MS', '3500')));
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const rowCount = await page.locator('[data-chat-message-row="true"]').count().catch(() => 0);
  await browser.close();

  const bootstrapFetches = requests.filter((item) => item.url.includes('/api/chat/bootstrap'));
  const welcomePattern = /What can we do for you\?|Hello\s*\n\s*What can we do for you\?/i;
  const result = {
    conversationId,
    shellStatus: shellResponse.status(),
    shellDynamicHeader: shellResponse.headers()['x-ai-space-dynamic-shell'] || '',
    injected: {
      authStatus: payload.auth_status,
      httpStatus: payload.http_status,
      conversationId: payload.conversation?.id,
      requestedConversationId: payload.requested_conversation_id,
      messageCount: payload.snapshot?.messages?.length || 0,
      hasBilling: Boolean(payload.billing),
      hasPinned: Array.isArray(payload.sidebar?.pinned),
      hasRecentNotebooks: Array.isArray(payload.sidebar?.recent_notebooks),
    },
    browser: {
      bootstrapFetchCount: bootstrapFetches.length,
      dynamicShellResponse: responses.some((item) => item.dynamic === 'chat-bootstrap'),
      rowCount,
      needle,
      hasNeedle: needle ? bodyText.includes(needle) : true,
      hasWelcomeText: welcomePattern.test(bodyText),
      requests,
      responses,
      consoleErrors: summarizeConsole(consoleEvents),
      pageErrors,
      bodyTail: bodyText.slice(-1000),
    },
  };
  result.ok = shellResponse.status() === 200
    && result.shellDynamicHeader === 'chat-bootstrap'
    && payload.auth_status === 'authenticated'
    && Number(payload.conversation?.id) === Number(conversationId)
    && (payload.snapshot?.messages?.length || 0) > 0
    && result.browser.dynamicShellResponse
    && result.browser.bootstrapFetchCount === 0
    && result.browser.rowCount > 0
    && result.browser.hasNeedle
    && !result.browser.hasWelcomeText
    && result.browser.pageErrors.length === 0;

  printResult(result);
  if (!result.ok) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
