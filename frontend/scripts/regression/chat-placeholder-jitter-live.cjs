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
  const effectiveScenario = scenario === 'mixed_rich'
    ? ['short', 'long_markdown', 'code_table', 'math_mermaid', 'long_markdown'][(round - 1) % 5]
    : scenario;
  if (effectiveScenario === 'long_markdown') {
    return `稳定性测试第 ${round} 轮 ${suffix}：请用中文输出一段中等长度 Markdown，主题是富文本渲染稳定性。必须包含：一个二级标题、一个三级标题、3 个项目符号、3 个编号项、一个引用块、一个总结段。总字数控制在 450 字以内。`;
  }
  if (effectiveScenario === 'code_table') {
    return `稳定性测试第 ${round} 轮 ${suffix}：请用中文简短回答，主题是聊天富文本渲染架构。必须包含：一个 5 行以内 TypeScript 代码块、一个 3 行以内三列表格、一个 2 项列表。总字数控制在 260 字以内。`;
  }
  if (effectiveScenario === 'math_mermaid') {
    return `稳定性测试第 ${round} 轮 ${suffix}：请逐字输出下面 Markdown 模板，不要解释，不要改写符号：\n\n数学和脚注：$E=mc^2$，引用[^note]。\n\n$$\na^2+b^2=c^2\n$$\n\n[^note]: 脚注内容。\n\n\`\`\`mermaid\ngraph TD\n  A[输入] --> B[处理]\n  B --> C[输出]\n\`\`\``;
  }
  return `稳定性测试第 ${round} 轮：请用中文只回答两句短句，主题是界面稳定。${suffix}`;
}

const installSampler = () => {
  let jitterNodeUid = 0;
  const sampleHashText = (text = '') => {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  };
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
      const stableMarkdown = row.querySelector('[data-stable-markdown-renderer="true"]');
      const tokenRenderer = row.querySelector('[data-markdown-token-renderer]');
      const streamingMarkdown = row.querySelector('[data-streaming-markdown-mode]');
      const localEnhancementBlocks = Array.from(row.querySelectorAll('[data-md-enhance-policy="block-local"]'));
      const codeBlocks = Array.from(row.querySelectorAll('[data-md-block-type="code"]'));
      const tableBlocks = Array.from(row.querySelectorAll('[data-md-block-type="table"]'));
      const mathBlocks = Array.from(row.querySelectorAll('[data-md-block-type="math"]'));
      const mermaidBlocks = Array.from(row.querySelectorAll('[data-md-mermaid="true"]'));
      const footnotes = Array.from(row.querySelectorAll('[data-md-footnote-ref]'));
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
        stableMarkdownPhase: stableMarkdown?.getAttribute('data-stable-markdown-phase') || '',
        stableMarkdownPolicy: stableMarkdown?.getAttribute('data-stable-markdown-policy') || '',
        streamingMarkdownMode: streamingMarkdown?.getAttribute('data-streaming-markdown-mode') || '',
        blockLocalEnhancementCount: localEnhancementBlocks.length,
        codeBlockCount: codeBlocks.length,
        tableBlockCount: tableBlocks.length,
        mathBlockCount: mathBlocks.length,
        mermaidBlockCount: mermaidBlocks.length,
        footnoteRefCount: footnotes.length,
        top: Math.round(rect.top),
        height: Math.round(rect.height),
        answerHeight: Math.round(answerRect?.height || 0),
        actionsHeight: Math.round(actionsRect?.height || 0),
        actionsClass: String(actionsNode?.className || ''),
        placeholderCount: row.querySelectorAll('[data-chat-initial-reasoning-status="true"], [data-chat-empty-streaming-placeholder="true"]').length,
        spinningCount: row.querySelectorAll('.animate-spin').length,
        completedStatusCount: (text.match(/已思考|回答完成|Completed|Reasoned/g) || []).length,
        textHash: sampleHashText(text),
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
      latestStableMarkdownPhase: latestAssistant?.stableMarkdownPhase || '',
      latestStableMarkdownPolicy: latestAssistant?.stableMarkdownPolicy || '',
      latestStreamingMarkdownMode: latestAssistant?.streamingMarkdownMode || '',
      latestBlockLocalEnhancementCount: latestAssistant?.blockLocalEnhancementCount || 0,
      latestCodeBlockCount: latestAssistant?.codeBlockCount || 0,
      latestTableBlockCount: latestAssistant?.tableBlockCount || 0,
      latestMathBlockCount: latestAssistant?.mathBlockCount || 0,
      latestMermaidBlockCount: latestAssistant?.mermaidBlockCount || 0,
      latestFootnoteRefCount: latestAssistant?.footnoteRefCount || 0,
      latestTextHash: latestAssistant?.textHash || '',
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

async function waitForChatIdle(page, timeoutMs = 45000) {
  await page.waitForFunction(() => {
    const stopButtons = Array.from(document.querySelectorAll('button')).filter((button) => /停止|Stop/i.test(button.textContent || '')).length;
    const rows = Array.from(document.querySelectorAll('[data-chat-message-row="true"][data-message-id]'));
    const assistantRows = rows.filter((row) => row.getAttribute('data-message-role') === 'assistant');
    const latest = assistantRows[assistantRows.length - 1];
    const text = (latest?.textContent || '').replace(/\s+/g, ' ').trim();
    return stopButtons === 0 && text.length > 20;
  }, undefined, { timeout: timeoutMs });
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
  const stableMarkdownPhases = Array.from(new Set(activeSamples.map((s) => s.latestStableMarkdownPhase).filter(Boolean)));
  const streamingMarkdownModes = Array.from(new Set(activeSamples.map((s) => s.latestStreamingMarkdownMode).filter(Boolean)));
  const stableLayerMissingAfterContent = activeSamples.some((s) => s.latestTextPrefix && s.latestPlaceholderCount === 0 && !s.latestStableLayerPresent && (s.latestAnswerState === 'settling' || s.latestAnswerState === 'streaming'));
  const blockLocalEnhancementSamples = activeSamples.map((s) => Number(s.latestBlockLocalEnhancementCount || 0));
  const maxBlockLocalEnhancementCount = blockLocalEnhancementSamples.length ? Math.max(...blockLocalEnhancementSamples) : 0;
  const maxCodeBlockCount = activeSamples.length ? Math.max(...activeSamples.map((s) => Number(s.latestCodeBlockCount || 0))) : 0;
  const maxTableBlockCount = activeSamples.length ? Math.max(...activeSamples.map((s) => Number(s.latestTableBlockCount || 0))) : 0;
  const maxMathBlockCount = activeSamples.length ? Math.max(...activeSamples.map((s) => Number(s.latestMathBlockCount || 0))) : 0;
  const maxMermaidBlockCount = activeSamples.length ? Math.max(...activeSamples.map((s) => Number(s.latestMermaidBlockCount || 0))) : 0;
  const maxFootnoteRefCount = activeSamples.length ? Math.max(...activeSamples.map((s) => Number(s.latestFootnoteRefCount || 0))) : 0;
  const completedStableSamples = activeSamples.filter((s) => s.latestTextPrefix
    && s.latestPlaceholderCount === 0
    && s.stopButtons === 0
    && s.latestStableMarkdownPhase === 'completed-visible'
    && s.latestTokenRendererMode === 'stable'
    && ['settling', 'completed-stable', 'hydrated'].includes(s.latestAnswerState));
  const completedStableChanges = [];
  for (let i = 1; i < completedStableSamples.length; i += 1) {
    const prev = completedStableSamples[i - 1];
    const next = completedStableSamples[i];
    const changed = prev.latestAssistantId !== next.latestAssistantId
      || prev.latestAssistantHeight !== next.latestAssistantHeight
      || prev.latestTextHash !== next.latestTextHash
      || prev.latestTokenRendererMode !== next.latestTokenRendererMode
      || prev.latestStableMarkdownPhase !== next.latestStableMarkdownPhase;
    if (changed) {
      completedStableChanges.push({
        sampleIndex: i,
        from: {
          id: prev.latestAssistantId,
          height: prev.latestAssistantHeight,
          textHash: prev.latestTextHash,
          tokenMode: prev.latestTokenRendererMode,
          stablePhase: prev.latestStableMarkdownPhase,
          answerState: prev.latestAnswerState,
        },
        to: {
          id: next.latestAssistantId,
          height: next.latestAssistantHeight,
          textHash: next.latestTextHash,
          tokenMode: next.latestTokenRendererMode,
          stablePhase: next.latestStableMarkdownPhase,
          answerState: next.latestAnswerState,
        },
      });
    }
  }
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
    stableMarkdownPhases,
    streamingMarkdownModes,
    maxBlockLocalEnhancementCount,
    maxCodeBlockCount,
    maxTableBlockCount,
    maxMathBlockCount,
    maxMermaidBlockCount,
    maxFootnoteRefCount,
    completedStableChangeCount: completedStableChanges.length,
    completedStableChanges: completedStableChanges.slice(0, 12),
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
    await waitForChatIdle(page);
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
    if (env('JITTER_REQUIRE_STABLE_LAYER', '0') === '1' && a.stableLayerMissingAfterContent) failures.push(`round ${round.round}: stable answer layer missing after content appeared`);
    if (a.completedStableChangeCount > Number(env('JITTER_MAX_COMPLETED_STABLE_CHANGES', '0'))) failures.push(`round ${round.round}: completed stable changes ${a.completedStableChangeCount}`);
    if (scenario === 'code_table' && a.maxCodeBlockCount > 0 && a.maxBlockLocalEnhancementCount < a.maxCodeBlockCount) failures.push(`round ${round.round}: code blocks missing block-local enhancement policy`);
    if (scenario === 'code_table' && a.maxTableBlockCount > 0 && a.maxBlockLocalEnhancementCount < a.maxCodeBlockCount + a.maxTableBlockCount) failures.push(`round ${round.round}: code/table blocks missing block-local enhancement policy`);
    if (scenario === 'mixed_rich' && round.round === 3 && (a.maxCodeBlockCount < 1 || a.maxTableBlockCount < 1)) failures.push(`round ${round.round}: mixed code/table markdown did not render expected blocks`);
    if (scenario === 'mixed_rich' && round.round === 4 && (a.maxMathBlockCount < 1 || a.maxMermaidBlockCount < 1)) failures.push(`round ${round.round}: mixed math/mermaid markdown did not render expected blocks`);
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
