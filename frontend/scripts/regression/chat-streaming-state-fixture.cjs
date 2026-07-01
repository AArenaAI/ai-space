#!/usr/bin/env node
const { chromium } = require('playwright');

const baseUrl = process.env.CHAT_FIXTURE_BASE_URL || 'http://127.0.0.1:3000';
const path = '/test-chat-streaming-state/?activity_panel_open=1&duplicate_realtime_on_complete=1&deterministic_answer=1';

async function readLatestAnswerSnapshot(page, label) {
  return page.evaluate((label) => {
    const row = document.querySelector('[data-chat-message-row="true"][data-message-role="assistant"]');
    const stableLayer = row?.querySelector('[data-chat-answer-stable-layer="true"]');
    const renderer = row?.querySelector('[data-chat-answer-renderer="true"]');
    const answer = row?.querySelector('.streaming-answer-markdown') || stableLayer || renderer;
    return {
      label,
      rowId: row?.getAttribute('data-message-id') || '',
      rowHeight: row?.getBoundingClientRect().height || 0,
      hasStableLayer: Boolean(stableLayer),
      answerText: answer?.textContent || '',
      answerHtmlLength: answer?.innerHTML.length || 0,
      answerMode: answer?.querySelector('[data-streaming-markdown-mode]')?.getAttribute('data-streaming-markdown-mode') || '',
      renderState: renderer?.getAttribute('data-chat-answer-render-state') || '',
      contentSource: stableLayer?.getAttribute('data-chat-answer-content-source') || '',
      canonicalMatch: stableLayer?.getAttribute('data-chat-answer-canonical-match') || '',
      completedSpinner: Boolean(row?.querySelector('[data-chat-status-kind="completed"] [data-chat-status-icon="spinning"], [data-chat-status-icon="spinning"].animate-spin')),
    };
  }, label);
}

async function openLatestActivityPanel(page) {
  const button = page.locator('button').filter({ hasText: /思考中|已思考|Reasoning|Reasoned/ }).last();
  await button.waitFor({ state: 'visible', timeout: 10_000 });
  await button.click();
  const panel = page.locator('[data-chat-activity-panel="true"]').last();
  await panel.waitFor({ state: 'visible', timeout: 10_000 });
  return panel;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const issues = [];
  page.on('pageerror', (error) => issues.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') issues.push(`console.error: ${msg.text()}`);
  });
  page.on('response', (response) => {
    const url = response.url();
    const status = response.status();
    if (status >= 400 && !url.includes('/api/')) issues.push(`response ${status}: ${url}`);
  });

  await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('[data-testid="chat-streaming-state-fixture"]', { timeout: 30_000 });
  await page.waitForSelector('[data-chat-activity-panel="true"]', { timeout: 10_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="fixture-phase"]')?.textContent === 'mixed-held', null, { timeout: 10_000 });
  await page.waitForFunction(() => {
    const phase = document.querySelector('[data-testid="fixture-phase"]')?.textContent || '';
    const body = document.body.innerText;
    const panel = document.querySelector('[data-chat-activity-panel="true"]')?.textContent || '';
    return phase === 'mixed-held' && panel.includes('先分析搜索结果') && !body.includes('B001');
  }, null, { timeout: 10_000 });
  const mixedSnapshot = await page.evaluate(() => ({
    phase: document.querySelector('[data-testid="fixture-phase"]')?.textContent || '',
    body: document.body.innerText,
    panelText: document.querySelector('[data-chat-activity-panel="true"]')?.textContent || '',
  }));
  if (!mixedSnapshot.panelText.includes('先分析搜索结果')) {
    issues.push('reasoning text did not render in activity panel during mixed reasoning phase');
  }
  if (mixedSnapshot.phase === 'mixed-held' && mixedSnapshot.body.includes('B001')) {
    issues.push('answer appeared while mixed reasoning delta was still held');
  }
  await page.waitForFunction(() => {
    const phase = document.querySelector('[data-testid="fixture-phase"]')?.textContent || '';
    return phase === 'answer-streaming' || phase === 'done';
  }, null, { timeout: 10_000 });
  await page.waitForFunction(() => {
    const panelText = document.querySelector('[data-chat-activity-panel="true"]')?.textContent || '';
    const answerText = document.querySelector('[data-chat-answer-stable-layer="true"]')?.textContent || '';
    return panelText.includes('正在生成回答') || answerText.includes('B001') || document.querySelector('[data-testid="fixture-phase"]')?.textContent === 'done';
  }, null, { timeout: 10_000 });
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-chat-answer-stable-layer="true"]')?.textContent || '';
    return text.includes('B001') || document.querySelector('[data-testid="fixture-phase"]')?.textContent === 'done';
  }, null, { timeout: 10_000 });
  const answerStreamingSnapshot = await page.evaluate(() => ({
    phase: document.querySelector('[data-testid="fixture-phase"]')?.textContent || '',
    panelText: document.querySelector('[data-chat-activity-panel="true"]')?.textContent || '',
    answerStrongText: Array.from(document.querySelectorAll('.streaming-answer-markdown strong')).map((node) => node.textContent || '').join('|'),
  }));
  const streamingAnswerSnapshot = await readLatestAnswerSnapshot(page, 'streaming');

  await page.waitForFunction(() => document.querySelector('[data-testid="fixture-phase"]')?.textContent === 'done', null, { timeout: 10_000 });
  await page.waitForFunction(() => document.body.innerText.includes('B001') && document.body.innerText.includes('B120'), null, { timeout: 10_000 });
  const doneInstantAnswerSnapshot = await readLatestAnswerSnapshot(page, 'done-instant');
  await page.waitForTimeout(300);
  const done300AnswerSnapshot = await readLatestAnswerSnapshot(page, 'done+300ms');
  await page.waitForTimeout(900);
  const done1200AnswerSnapshot = await readLatestAnswerSnapshot(page, 'done+1200ms');
  await page.waitForTimeout(1800);
  const done3000AnswerSnapshot = await readLatestAnswerSnapshot(page, 'done+3000ms');
  const doneImmediateSnapshot = await page.evaluate(() => ({
    rowHeight: document.querySelector('[data-chat-message-row="true"][data-message-role="assistant"]')?.getBoundingClientRect().height || 0,
    activityPanelVisible: Boolean(document.querySelector('[data-chat-activity-panel="true"]')),
  }));
  await page.waitForFunction(() => document.querySelector('[data-testid="complex-streaming-markdown-active"] [data-streaming-markdown-mode="plain"]'), null, { timeout: 10_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="complex-streaming-markdown-done"] [data-streaming-markdown-mode="rich"]'), null, { timeout: 10_000 });
  await page.waitForFunction(() => document.body.innerText.includes('B120'), null, { timeout: 10_000 });
  const doneSnapshot = await page.evaluate(() => ({
    body: document.body.innerText,
    panelText: document.querySelector('[data-chat-activity-panel="true"]')?.textContent || '',
    answerStrongText: Array.from(document.querySelectorAll('strong')).map((node) => node.textContent || '').join('|'),
    rowHeight: document.querySelector('[data-chat-message-row="true"][data-message-role="assistant"]')?.getBoundingClientRect().height || 0,
    complexStreamingMode: document.querySelector('[data-testid="complex-streaming-markdown-active"] [data-streaming-markdown-mode]')?.getAttribute('data-streaming-markdown-mode') || '',
    complexDoneMode: document.querySelector('[data-testid="complex-streaming-markdown-done"] [data-streaming-markdown-mode]')?.getAttribute('data-streaming-markdown-mode') || '',
    statusBadges: Array.from(document.querySelectorAll('span')).map((node) => node.textContent || '').filter(Boolean),
  }));
  if (!doneSnapshot.body.includes('B001') || !doneSnapshot.body.includes('B120')) {
    issues.push('answer did not appear after done flush');
  }
  if (doneSnapshot.body.includes('正在联网搜索')) {
    issues.push('web-search running badge remained after done without completed meta');
  }
  if (!doneImmediateSnapshot.activityPanelVisible) {
    issues.push('activity panel should remain visible after completion');
  }
  const activityPanel = page.locator('[data-chat-activity-panel="true"]').last();
  await page.waitForFunction(() => {
    const panel = document.querySelector('[data-chat-activity-panel="true"]');
    const text = panel?.textContent || '';
    return text.includes('思考与来源') && text.includes('先分析搜索结果');
  }, null, { timeout: 10_000 });
  const timelineSnapshot = await activityPanel.evaluate((panel) => ({
    text: panel.textContent || '',
    stepCount: panel.querySelectorAll('[data-chat-activity-step="true"]').length,
  }));
  if (!timelineSnapshot.text.includes('先分析搜索结果')) {
    issues.push('activity panel did not expose reasoning content');
  }
  if (timelineSnapshot.text.includes('收尾中') || timelineSnapshot.text.includes('Finalizing') || timelineSnapshot.text.includes('0秒') || timelineSnapshot.text.includes('0s')) {
    issues.push(`activity panel showed low-value/stale timeline text: ${timelineSnapshot.text.slice(0, 300)}`);
  }
  const finalRenderSnapshots = [streamingAnswerSnapshot, doneInstantAnswerSnapshot, done300AnswerSnapshot, done1200AnswerSnapshot, done3000AnswerSnapshot];
  const completionSettleSnapshots = [doneInstantAnswerSnapshot, done300AnswerSnapshot, done1200AnswerSnapshot];
  const rowIds = new Set(finalRenderSnapshots.map((snapshot) => snapshot.rowId));
  if (rowIds.size !== 1) {
    issues.push(`latest assistant row id changed across completion: ${JSON.stringify(finalRenderSnapshots)}`);
  }
  const missingStableLayer = completionSettleSnapshots.filter((snapshot) => !snapshot.hasStableLayer);
  if (missingStableLayer.length > 0) {
    issues.push(`answer stable layer should stay mounted through completion settling: ${JSON.stringify(missingStableLayer)}`);
  }
  const duplicateAnswer = finalRenderSnapshots.find((snapshot) => (snapshot.answerText.match(/B001/g) || []).length !== 1 || (snapshot.answerText.match(/B120/g) || []).length !== 1);
  if (duplicateAnswer) {
    issues.push(`answer text should appear exactly once through completion and hydration: ${JSON.stringify(duplicateAnswer)}`);
  }
  const maxHeight = Math.max(...completionSettleSnapshots.map((snapshot) => snapshot.rowHeight));
  const minHeight = Math.min(...completionSettleSnapshots.map((snapshot) => snapshot.rowHeight).filter(Boolean));
  if (minHeight > 0 && maxHeight - minHeight > 48) {
    issues.push(`assistant row height shifted too much during completion settling: ${JSON.stringify(finalRenderSnapshots.map((snapshot) => ({ label: snapshot.label, rowHeight: snapshot.rowHeight, mode: snapshot.answerMode })) )}`);
  }
  const unexpectedSettleState = completionSettleSnapshots.find((snapshot) => snapshot.renderState !== 'settling');
  if (unexpectedSettleState) {
    issues.push(`completion settling snapshots should stay in settling render state: ${JSON.stringify(completionSettleSnapshots)}`);
  }
  const nonCanonicalCompletionSnapshot = completionSettleSnapshots.find((snapshot) => snapshot.contentSource !== 'canonical');
  if (nonCanonicalCompletionSnapshot) {
    issues.push(`completion should render canonical content during settling: ${JSON.stringify(completionSettleSnapshots)}`);
  }
  if (done3000AnswerSnapshot.renderState !== 'hydrated') {
    issues.push(`done+3000ms should transition to hydrated render state: ${JSON.stringify(done3000AnswerSnapshot)}`);
  }
  const completedSpinnerSnapshot = finalRenderSnapshots.find((snapshot) => snapshot.completedSpinner);
  if (completedSpinnerSnapshot) {
    issues.push(`completed answer should not keep spinner: ${JSON.stringify(completedSpinnerSnapshot)}`);
  }
  if (doneImmediateSnapshot.rowHeight > 0 && Math.abs(doneSnapshot.rowHeight - doneImmediateSnapshot.rowHeight) > 4) {
    issues.push(`assistant row height shifted after completion settle: ${doneImmediateSnapshot.rowHeight} -> ${doneSnapshot.rowHeight}`);
  }
  if (doneSnapshot.complexStreamingMode !== 'plain') {
    issues.push(`complex streaming markdown did not use plain fallback: ${doneSnapshot.complexStreamingMode}`);
  }
  if (doneSnapshot.complexDoneMode !== 'rich') {
    issues.push(`completed complex markdown did not return to rich renderer: ${doneSnapshot.complexDoneMode}`);
  }

  await browser.close();
  if (issues.length) {
    console.error(JSON.stringify({ ok: false, issues, mixedSnapshot, answerStreamingSnapshot, finalRenderSnapshots, doneImmediateSnapshot, doneSnapshot }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, mixedPhase: mixedSnapshot.phase, doneHasAnswer: doneSnapshot.body.includes('B001') && doneSnapshot.body.includes('B120') }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
