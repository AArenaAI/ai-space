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
  const { round, tick, phase } = args;
  return { round, tick, phase, ...window.__AI_SPACE_JITTER_SAMPLE__?.() };
}

function promptForScenario({ scenario, round }) {
  const suffix = `${Date.now()}-${round}`;
  if (scenario === 'long_markdown') {
    return `稳定性测试第 ${round} 轮 ${suffix}：请用中文输出一段中等长度 Markdown，主题是富文本渲染稳定性。必须包含：一个二级标题、一个三级标题、3 个项目符号、3 个编号项、一个引用块、一个总结段。总字数控制在 450 字以内。`;
  }
  if (scenario === 'code_table') {
    return `稳定性测试第 ${round} 轮 ${suffix}：请用中文简短回答，主题是聊天富文本渲染架构。必须包含：一个 5 行以内 TypeScript 代码块、一个 3 行以内三列表格、一个 2 项列表。总字数控制在 260 字以内。`;
  }
  return `稳定性测试第 ${round} 轮：请用中文只回答两句短句，主题是界面稳定。${suffix}`;
}

const installSampler = () => {
  let jitterNodeUid = 0;
  window.__AI_SPACE_JITTER_SAMPLE__ = () => {
    const rows = Array.from(document.querySelectorAll('[data-chat-message-row="true"][data-message-id]'));
    const rowInfo = rows.map((row) => {
      if (!row.getAttribute('data-jitter-node-uid')) {
        jitterNodeUid += 1;
        row.setAttribute('data-jitter-node-uid', String(jitterNodeUid));
      }
      const rect = row.getBoundingClientRect();
      const answerNode = row.querySelector('[data-chat-answer-renderer="true"]');
      const stableLayer = row.querySelector('[data-chat-answer-stable-layer="true"]');
      const tokenRenderer = row.querySelector('[data-markdown-token-renderer]');
      const streamingMarkdown = row.querySelector('[data-streaming-markdown-mode]');
      const actionsNode = row.querySelector('[data-message-actions="true"]');
      const answerRect = answerNode?.getBoundingClientRect();
      const stableRect = stableLayer?.getBoundingClientRect();
      const actionsRect = actionsNode?.getBoundingClientRect();
      const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
      return {
        nodeUid: row.getAttribute('data-jitter-node-uid') || '',
        id: row.getAttribute('data-message-id') || '',
        serverId: row.getAttribute('data-server-message-id') || '',
        taskId: row.getAttribute('data-generation-task-id') || '',
        role: row.getAttribute('data-message-role') || '',
        answerState: answerNode?.getAttribute('data-chat-answer-render-state') || '',
        stableLayerPresent: !!stableLayer,
        stableLayerHeight: Math.round(stableRect?.height || 0),
        contentSource: stableLayer?.getAttribute('data-chat-answer-content-source') || '',
        canonicalMatch: stableLayer?.getAttribute('data-chat-answer-canonical-match') || '',
        tokenRendererMode: tokenRenderer?.getAttribute('data-markdown-token-renderer') || '',
        streamingMarkdownMode: streamingMarkdown?.getAttribute('data-streaming-markdown-mode') || '',
        top: Math.round(rect.top),
        height: Math.round(rect.height),
        answerHeight: Math.round(answerRect?.height || 0),
        actionsHeight: Math.round(actionsRect?.height || 0),
        actionsClass: String(actionsNode?.className || ''),
        placeholderCount: row.querySelectorAll('[data-chat-initial-reasoning-status="true"], [data-chat-empty-streaming-placeholder="true"]').length,
        spinningCount: row.querySelectorAll('.animate-spin').length,
        completedStatusCount: (text.match(/已思考|回答完成|Completed|Reasoned/g) || []).length,
        textPrefix: text.slice(0, 100),
      };
    });
    const assistantRows = rowInfo.filter((row) => row.role === 'assistant');
    const latestAssistant = assistantRows[assistantRows.length - 1] || null;
    const oldRows = rowInfo.slice(0, Math.max(0, rowInfo.length - 2));
    const oldSignatures = oldRows.map((row) => `${row.role}:${row.id}:${row.nodeUid}:${row.height}:${row.textPrefix.slice(0, 40)}`);
    const oldRowsById = Object.fromEntries(oldRows.filter((row) => row.id).map((row) => [row.id, {
      nodeUid: row.nodeUid,
      height: row.height,
      answerHeight: row.answerHeight,
      actionsHeight: row.actionsHeight,
      answerState: row.answerState,
      actionsClass: row.actionsClass,
      textPrefix: row.textPrefix.slice(0, 80),
    }]));
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
      latestAnswerState: latestAssistant?.answerState || '',
      latestStableLayerPresent: latestAssistant?.stableLayerPresent || false,
      latestContentSource: latestAssistant?.contentSource || '',
      latestTokenRendererMode: latestAssistant?.tokenRendererMode || '',
      latestStreamingMarkdownMode: latestAssistant?.streamingMarkdownMode || '',
      dupIds,
      oldSignatures,
      oldRowsById,
      stopButtons,
      sendButtons,
    };
  };
};

async function sampleFor(page, round, durationMs, intervalMs, phase = 'active') {
  const samples = [];
  const started = Date.now();
  let tick = 0;
  while (Date.now() - started < durationMs) {
    samples.push(await page.evaluate(makeDomSample, { round, tick, phase }));
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
  const settleSamples = activeSamples.filter((s) => String(s.phase || '').includes('settle'));
  const settleHeights = settleSamples.map((s) => s.latestAssistantHeight).filter((value) => value > 0);
  const settleHeightDeltas = settleHeights.slice(1).map((value, index) => value - settleHeights[index]);
  const maxSettleHeightJump = settleHeightDeltas.length ? Math.max(...settleHeightDeltas.map(Math.abs)) : 0;
  const placeholderHeights = activeSamples.filter((s) => s.latestPlaceholderCount > 0).map((s) => s.latestAssistantHeight).filter(Boolean);
  const firstContent = activeSamples.find((s) => s.latestTextPrefix && s.latestPlaceholderCount === 0 && s.latestAssistantHeight > 0);
  const last = activeSamples[activeSamples.length - 1] || samples[samples.length - 1] || {};
  let oldSignatureChanges = 0;
  let oldNodeUidChanges = 0;
  let oldHeightChanges = 0;
  let oldTextChanges = 0;
  const oldHeightChangeDetails = [];
  for (let i = 1; i < activeSamples.length; i += 1) {
    if (JSON.stringify(activeSamples[i].oldSignatures) !== JSON.stringify(activeSamples[i - 1].oldSignatures)) oldSignatureChanges += 1;
    const prevRows = activeSamples[i - 1].oldRowsById || {};
    const nextRows = activeSamples[i].oldRowsById || {};
    for (const id of Object.keys(prevRows)) {
      if (!nextRows[id]) continue;
      if (prevRows[id].nodeUid !== nextRows[id].nodeUid) oldNodeUidChanges += 1;
      const heightDelta = Number(nextRows[id].height || 0) - Number(prevRows[id].height || 0);
      if (Math.abs(heightDelta) > 2) {
        oldHeightChanges += 1;
        oldHeightChangeDetails.push({
          sampleIndex: i,
          id,
          from: prevRows[id].height,
          to: nextRows[id].height,
          delta: heightDelta,
          answerHeightFrom: prevRows[id].answerHeight,
          answerHeightTo: nextRows[id].answerHeight,
          actionsHeightFrom: prevRows[id].actionsHeight,
          actionsHeightTo: nextRows[id].actionsHeight,
          answerStateFrom: prevRows[id].answerState,
          answerStateTo: nextRows[id].answerState,
          actionsClassFrom: prevRows[id].actionsClass,
          actionsClassTo: nextRows[id].actionsClass,
          textPrefix: nextRows[id].textPrefix,
        });
      }
      if (prevRows[id].textPrefix !== nextRows[id].textPrefix) oldTextChanges += 1;
    }
  }
  const dupIds = Array.from(new Set(activeSamples.flatMap((s) => s.dupIds || [])));
  const answerStates = Array.from(new Set(activeSamples.map((s) => s.latestAnswerState).filter(Boolean)));
  const contentSources = Array.from(new Set(activeSamples.map((s) => s.latestContentSource).filter(Boolean)));
  const tokenRendererModes = Array.from(new Set(activeSamples.map((s) => s.latestTokenRendererMode).filter(Boolean)));
  const streamingMarkdownModes = Array.from(new Set(activeSamples.map((s) => s.latestStreamingMarkdownMode).filter(Boolean)));
  const stableLayerMissingAfterContent = activeSamples.some((s) => s.latestTextPrefix && s.latestPlaceholderCount === 0 && !s.latestStableLayerPresent && (s.latestAnswerState === 'settling' || s.latestAnswerState === 'streaming'));
  return {
    distinctIds,
    latestIdChanged: distinctIds.length > 1,
    ignoredWarmupSamples: Math.max(0, firstPlaceholderIndex),
    heights,
    heightDeltas,
    maxHeightJump,
    settleHeightDeltas,
    maxSettleHeightJump,
    placeholderHeights,
    firstContentHeight: firstContent?.latestAssistantHeight || 0,
    placeholderToContentJump: placeholderHeights.length && firstContent ? Math.abs(firstContent.latestAssistantHeight - placeholderHeights[placeholderHeights.length - 1]) : 0,
    oldSignatureChanges,
    oldNodeUidChanges,
    oldHeightChanges,
    oldHeightChangeDetails: oldHeightChangeDetails.slice(0, 12),
    oldTextChanges,
    dupIds,
    answerStates,
    contentSources,
    tokenRendererModes,
    streamingMarkdownModes,
    stableLayerMissingAfterContent,
    finalTextPrefix: last.latestTextPrefix || '',
  };
}

(async () => {
  const baseUrl = env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz');
  const model = env('JITTER_MODEL', env('REAL_CHAT_MODEL', 'deepseek-v4-flash'));
  const scenario = env('JITTER_SCENARIO', 'short');
  const switchback = env('JITTER_SWITCHBACK', '0') === '1';
  const rounds = Math.max(1, Number(env('JITTER_ROUNDS', '3')));
  const durationMs = Math.max(800, Number(env('JITTER_SAMPLE_MS', scenario === 'short' ? '4200' : '9000')));
  const settleMs = Math.max(300, Number(env('JITTER_SETTLE_SAMPLE_MS', scenario === 'short' ? '1200' : '3500')));
  const intervalMs = Math.max(30, Number(env('JITTER_INTERVAL_MS', '50')));
  const auth = await login({ baseUrl });
  const conversation = await createConversation(baseUrl, auth.token, model);
  const browser = await chromium.launch({ headless: env('HEADFUL') !== '1' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  if (auth.refreshToken) {
    await context.addCookies([{ name: 'ai_space_refresh_token', value: auth.refreshToken, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
  }
  const page = await context.newPage();
  const consoleEvents = [];
  const pageErrors = [];
  page.on('console', (msg) => consoleEvents.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));
  await page.addInitScript(({ token, user, model }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    if (user?.default_workspace_id) localStorage.setItem('current-workspace', String(user.default_workspace_id));
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
    await page.locator('textarea').last().fill(promptForScenario({ scenario, round }));
    await page.locator('textarea').last().press('Enter');
    const activeSamples = await sampleFor(page, round, durationMs, intervalMs, 'active');
    if (switchback) {
      await page.goto(`${baseUrl}/chat/?jitter_switch_target=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(500);
      await page.goto(`${baseUrl}/chat/?id=${conversation.id}&jitter_probe=${Date.now()}&switchback=${round}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('textarea', { state: 'visible', timeout: 30000 });
      await page.waitForTimeout(800);
    }
    const settleSamples = await sampleFor(page, round, settleMs, intervalMs, switchback ? 'switchback-settle' : 'settle');
    const samples = [...activeSamples, ...settleSamples];
    roundsResult.push({ round, analysis: analyzeRound(samples), samples });
    await page.waitForTimeout(1200);
  }
  await browser.close();

  const failures = [];
  const strictActiveHeight = scenario === 'short';
  const maxPlaceholderJump = Number(env('JITTER_MAX_PLACEHOLDER_JUMP', strictActiveHeight ? '32' : '2000'));
  const maxActiveHeightJump = Number(env('JITTER_MAX_HEIGHT_JUMP', strictActiveHeight ? '96' : '2000'));
  const maxSettleHeightJump = Number(env('JITTER_MAX_SETTLE_HEIGHT_JUMP', strictActiveHeight ? '96' : '1200'));
  for (const round of roundsResult) {
    const a = round.analysis;
    if (a.latestIdChanged && !switchback) failures.push(`round ${round.round}: latest assistant id changed ${a.distinctIds.join(' -> ')}`);
    if (a.dupIds.length) failures.push(`round ${round.round}: duplicate ids ${a.dupIds.join(',')}`);
    if (a.placeholderToContentJump > maxPlaceholderJump) failures.push(`round ${round.round}: placeholder/content jump ${a.placeholderToContentJump}`);
    if (a.maxHeightJump > maxActiveHeightJump) failures.push(`round ${round.round}: max height jump ${a.maxHeightJump}`);
    if (a.maxSettleHeightJump > maxSettleHeightJump) failures.push(`round ${round.round}: settle height jump ${a.maxSettleHeightJump}`);
    if (a.oldSignatureChanges > Number(env('JITTER_MAX_OLD_SIGNATURE_CHANGES', '2'))) failures.push(`round ${round.round}: old signature changes ${a.oldSignatureChanges}`);
    if (a.oldNodeUidChanges > Number(env('JITTER_MAX_OLD_NODE_UID_CHANGES', '0'))) failures.push(`round ${round.round}: old row remounts ${a.oldNodeUidChanges}`);
    if (a.oldHeightChanges > Number(env('JITTER_MAX_OLD_HEIGHT_CHANGES', '0'))) failures.push(`round ${round.round}: old row height changes ${a.oldHeightChanges}`);
    if (a.oldTextChanges > Number(env('JITTER_MAX_OLD_TEXT_CHANGES', '0'))) failures.push(`round ${round.round}: old row text changes ${a.oldTextChanges}`);
    if (a.stableLayerMissingAfterContent) failures.push(`round ${round.round}: stable answer layer missing after content appeared`);
  }
  if (pageErrors.length) failures.push(`page errors: ${pageErrors.join('; ')}`);

  const result = {
    ok: failures.length === 0,
    baseUrl,
    conversationId: conversation.id,
    model,
    scenario,
    switchback,
    rounds,
    durationMs,
    settleMs,
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
