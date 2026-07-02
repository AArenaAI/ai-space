#!/usr/bin/env node
const { env, login, printResult, summarizeConsole } = require('./chat-live-utils.cjs');
const { chromium } = require('playwright');

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${url} ${res.status}: ${text.slice(0, 500)}`);
  return data;
}

async function createConversation(baseUrl, token, model) {
  return jsonFetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: `Placeholder jitter probe ${Date.now()}`, model }),
  });
}

function makeDomSample(args) {
  const { round, tick } = args;
  return { round, tick, ...window.__AI_SPACE_JITTER_SAMPLE__?.() };
}

const installSampler = () => {
  window.__AI_SPACE_JITTER_SAMPLE__ = () => {
    const rows = Array.from(document.querySelectorAll('[data-chat-message-row="true"][data-message-id]'));
    const rowInfo = rows.map((row) => {
      const rect = row.getBoundingClientRect();
      const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
      return {
        id: row.getAttribute('data-message-id') || '',
        serverId: row.getAttribute('data-server-message-id') || '',
        taskId: row.getAttribute('data-generation-task-id') || '',
        role: row.getAttribute('data-message-role') || '',
        top: Math.round(rect.top),
        height: Math.round(rect.height),
        placeholderCount: row.querySelectorAll('[data-chat-initial-reasoning-status="true"], [data-chat-empty-streaming-placeholder="true"]').length,
        spinningCount: row.querySelectorAll('.animate-spin').length,
        completedStatusCount: (text.match(/已思考|回答完成|Completed|Reasoned/g) || []).length,
        textPrefix: text.slice(0, 100),
      };
    });
    const assistantRows = rowInfo.filter((row) => row.role === 'assistant');
    const latestAssistant = assistantRows[assistantRows.length - 1] || null;
    const oldSignatures = rowInfo.slice(0, Math.max(0, rowInfo.length - 2)).map((row) => `${row.role}:${row.id}:${row.height}:${row.textPrefix.slice(0, 40)}`);
    const ids = rowInfo.map((row) => row.id).filter(Boolean);
    const dupIds = Array.from(new Set(ids.filter((id, index) => ids.indexOf(id) !== index)));
    const stopButtons = Array.from(document.querySelectorAll('button')).filter((button) => /停止|Stop/i.test(button.textContent || '')).length;
    const sendButtons = Array.from(document.querySelectorAll('button')).filter((button) => /发送|Send/i.test(button.getAttribute('aria-label') || button.textContent || '')).length;
    return {
      ts: Date.now(),
      rowCount: rowInfo.length,
      latestAssistant,
      latestAssistantId: latestAssistant?.id || '',
      latestAssistantHeight: latestAssistant?.height || 0,
      latestAssistantTop: latestAssistant?.top || 0,
      latestPlaceholderCount: latestAssistant?.placeholderCount || 0,
      latestTextPrefix: latestAssistant?.textPrefix || '',
      dupIds,
      oldSignatures,
      stopButtons,
      sendButtons,
    };
  };
};

async function sampleFor(page, round, durationMs, intervalMs) {
  const samples = [];
  const started = Date.now();
  let tick = 0;
  while (Date.now() - started < durationMs) {
    samples.push(await page.evaluate(makeDomSample, { round, tick }));
    tick += 1;
    await page.waitForTimeout(intervalMs);
  }
  return samples;
}

function analyzeRound(samples) {
  const firstPlaceholderIndex = samples.findIndex((s) => s.latestPlaceholderCount > 0);
  const activeSamples = firstPlaceholderIndex >= 0 ? samples.slice(firstPlaceholderIndex) : samples;
  const ids = activeSamples.map((s) => s.latestAssistantId).filter(Boolean);
  const distinctIds = Array.from(new Set(ids));
  const heights = activeSamples.map((s) => s.latestAssistantHeight).filter((value) => value > 0);
  const heightDeltas = heights.slice(1).map((value, index) => value - heights[index]);
  const maxHeightJump = heightDeltas.length ? Math.max(...heightDeltas.map(Math.abs)) : 0;
  const placeholderHeights = activeSamples.filter((s) => s.latestPlaceholderCount > 0).map((s) => s.latestAssistantHeight).filter(Boolean);
  const firstContent = activeSamples.find((s) => s.latestTextPrefix && s.latestPlaceholderCount === 0 && s.latestAssistantHeight > 0);
  const last = activeSamples[activeSamples.length - 1] || samples[samples.length - 1] || {};
  let oldSignatureChanges = 0;
  for (let i = 1; i < activeSamples.length; i += 1) {
    if (JSON.stringify(activeSamples[i].oldSignatures) !== JSON.stringify(activeSamples[i - 1].oldSignatures)) oldSignatureChanges += 1;
  }
  const dupIds = Array.from(new Set(activeSamples.flatMap((s) => s.dupIds || [])));
  return {
    distinctIds,
    latestIdChanged: distinctIds.length > 1,
    ignoredWarmupSamples: Math.max(0, firstPlaceholderIndex),
    heights,
    heightDeltas,
    maxHeightJump,
    placeholderHeights,
    firstContentHeight: firstContent?.latestAssistantHeight || 0,
    placeholderToContentJump: placeholderHeights.length && firstContent ? Math.abs(firstContent.latestAssistantHeight - placeholderHeights[placeholderHeights.length - 1]) : 0,
    oldSignatureChanges,
    dupIds,
    finalTextPrefix: last.latestTextPrefix || '',
  };
}

(async () => {
  const baseUrl = env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz');
  const model = env('JITTER_MODEL', env('REAL_CHAT_MODEL', 'deepseek-v4-flash'));
  const rounds = Math.max(1, Number(env('JITTER_ROUNDS', '3')));
  const durationMs = Math.max(800, Number(env('JITTER_SAMPLE_MS', '4200')));
  const intervalMs = Math.max(30, Number(env('JITTER_INTERVAL_MS', '50')));
  const auth = await login({ baseUrl });
  const conversation = await createConversation(baseUrl, auth.token, model);
  const browser = await chromium.launch({ headless: env('HEADFUL') !== '1' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleEvents = [];
  const pageErrors = [];
  page.on('console', (msg) => consoleEvents.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));
  await page.addInitScript(({ token, user, model }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('selected-model', model);
    localStorage.setItem('reasoning-mode', 'fast');
    localStorage.setItem('reasoning-enabled', 'false');
    localStorage.setItem('search-enabled', 'false');
    localStorage.setItem('theme', 'dark');
  }, { token: auth.token, user: auth.user, model });
  await page.addInitScript(installSampler);
  await page.goto(`${baseUrl}/chat/?id=${conversation.id}&jitter_probe=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('textarea', { state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1200);

  const roundsResult = [];
  for (let round = 1; round <= rounds; round += 1) {
    await page.locator('textarea').last().fill(`稳定性测试第 ${round} 轮：请用中文只回答两句短句，主题是界面稳定。${Date.now()}`);
    await page.locator('textarea').last().press('Enter');
    const samples = await sampleFor(page, round, durationMs, intervalMs);
    roundsResult.push({ round, analysis: analyzeRound(samples), samples });
    await page.waitForTimeout(1200);
  }
  await browser.close();

  const failures = [];
  for (const round of roundsResult) {
    const a = round.analysis;
    if (a.latestIdChanged) failures.push(`round ${round.round}: latest assistant id changed ${a.distinctIds.join(' -> ')}`);
    if (a.dupIds.length) failures.push(`round ${round.round}: duplicate ids ${a.dupIds.join(',')}`);
    if (a.placeholderToContentJump > Number(env('JITTER_MAX_PLACEHOLDER_JUMP', '32'))) failures.push(`round ${round.round}: placeholder/content jump ${a.placeholderToContentJump}`);
    if (a.maxHeightJump > Number(env('JITTER_MAX_HEIGHT_JUMP', '96'))) failures.push(`round ${round.round}: max height jump ${a.maxHeightJump}`);
    if (a.oldSignatureChanges > Number(env('JITTER_MAX_OLD_SIGNATURE_CHANGES', '2'))) failures.push(`round ${round.round}: old signature changes ${a.oldSignatureChanges}`);
  }
  if (pageErrors.length) failures.push(`page errors: ${pageErrors.join('; ')}`);

  const result = {
    ok: failures.length === 0,
    baseUrl,
    conversationId: conversation.id,
    model,
    rounds,
    durationMs,
    intervalMs,
    failures,
    summary: roundsResult.map((round) => ({ round: round.round, ...round.analysis, samples: undefined })),
    consoleErrors: summarizeConsole(consoleEvents),
    pageErrors,
  };
  printResult(result);
  if (!result.ok) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
