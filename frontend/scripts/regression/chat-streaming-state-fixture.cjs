#!/usr/bin/env node
const { chromium } = require('playwright');

const baseUrl = process.env.CHAT_FIXTURE_BASE_URL || 'http://127.0.0.1:3000';
const path = '/test-chat-streaming-state/';

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
  await page.waitForFunction(() => document.body.innerText.includes('正在联网搜索'), null, { timeout: 10_000 });
  await page.waitForFunction(() => {
    const status = document.querySelector('[data-chat-generation-phase="searching"]')?.textContent || '';
    const statusInBody = document.querySelector('.streaming-answer-markdown [data-chat-generation-phase], .reasoning-markdown [data-chat-generation-phase]');
    return status.includes('正在联网搜索') && /已用时\s+\d+秒/.test(status) && !statusInBody;
  }, null, { timeout: 10_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="fixture-phase"]')?.textContent === 'mixed-held', null, { timeout: 10_000 });
  await page.waitForFunction(() => {
    const phase = document.querySelector('[data-testid="fixture-phase"]')?.textContent || '';
    const body = document.body.innerText;
    const status = document.querySelector('[data-chat-generation-phase="reasoning"]')?.textContent || '';
    return phase === 'mixed-held' && body.includes('先分析搜索结果') && !body.includes('最终回答 OK 42') && status.includes('正在思考推理');
  }, null, { timeout: 10_000 });
  const mixedSnapshot = await page.evaluate(() => ({
    phase: document.querySelector('[data-testid="fixture-phase"]')?.textContent || '',
    body: document.body.innerText,
    reasoningStrongText: Array.from(document.querySelectorAll('.reasoning-markdown strong')).map((node) => node.textContent || '').join('|'),
  }));
  if (!mixedSnapshot.body.includes('先分析搜索结果')) {
    issues.push('reasoning text did not render during mixed reasoning phase');
  }
  if (mixedSnapshot.phase === 'mixed-held' && mixedSnapshot.body.includes('最终回答 OK 42')) {
    issues.push('answer appeared while mixed reasoning delta was still held');
  }
  await page.waitForFunction(() => document.querySelector('[data-testid="fixture-phase"]')?.textContent === 'answer-streaming', null, { timeout: 10_000 });
  await page.waitForFunction(() => document.body.innerText.includes('最终回答 OK 42'), null, { timeout: 10_000 });
  await page.waitForFunction(() => (document.querySelector('[data-chat-generation-phase="streaming_answer"]')?.textContent || '').includes('正在生成回答'), null, { timeout: 10_000 });
  await page.waitForFunction(() => document.querySelector('[data-chat-generation-phase="streaming_answer"] [data-chat-status-icon="spinning"]')?.classList.contains('animate-spin'), null, { timeout: 10_000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.reasoning-markdown strong')).some((node) => node.textContent?.includes('最终')), null, { timeout: 10_000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.streaming-answer-markdown strong')).some((node) => node.textContent?.includes('OK')), null, { timeout: 10_000 });
  const answerStreamingSnapshot = await page.evaluate(() => ({
    phase: document.querySelector('[data-testid="fixture-phase"]')?.textContent || '',
    reasoningStrongText: Array.from(document.querySelectorAll('.reasoning-markdown strong')).map((node) => node.textContent || '').join('|'),
    answerStrongText: Array.from(document.querySelectorAll('.streaming-answer-markdown strong')).map((node) => node.textContent || '').join('|'),
  }));

  await page.waitForFunction(() => document.querySelector('[data-testid="fixture-phase"]')?.textContent === 'done', null, { timeout: 10_000 });
  await page.waitForFunction(() => document.body.innerText.includes('最终回答 OK 42'), null, { timeout: 10_000 });
  await page.waitForFunction(() => (document.querySelector('[data-chat-status-kind="completed"]')?.textContent || '').includes('生成完成'), null, { timeout: 10_000 });
  await page.waitForFunction(() => document.querySelector('.streaming-answer-markdown [data-streaming-markdown-mode="rich"]'), null, { timeout: 10_000 });
  const doneImmediateSnapshot = await page.evaluate(() => ({
    answerMode: document.querySelector('.streaming-answer-markdown [data-streaming-markdown-mode]')?.getAttribute('data-streaming-markdown-mode') || '',
    rowHeight: document.querySelector('[data-chat-message-row="true"][data-message-role="assistant"]')?.getBoundingClientRect().height || 0,
  }));
  await page.waitForFunction(() => document.querySelector('[data-testid="complex-streaming-markdown-active"] [data-streaming-markdown-mode="plain"]'), null, { timeout: 10_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="complex-streaming-markdown-done"] [data-streaming-markdown-mode="rich"]'), null, { timeout: 10_000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('strong')).some((node) => node.textContent?.includes('最终')), null, { timeout: 10_000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('strong')).some((node) => node.textContent?.includes('OK')), null, { timeout: 10_000 });
  const doneSnapshot = await page.evaluate(() => ({
    body: document.body.innerText,
    reasoningStrongText: Array.from(document.querySelectorAll('.reasoning-markdown strong')).map((node) => node.textContent || '').join('|'),
    answerStrongText: Array.from(document.querySelectorAll('strong')).map((node) => node.textContent || '').join('|'),
    answerMode: document.querySelector('.streaming-answer-markdown [data-streaming-markdown-mode]')?.getAttribute('data-streaming-markdown-mode') || '',
    rowHeight: document.querySelector('[data-chat-message-row="true"][data-message-role="assistant"]')?.getBoundingClientRect().height || 0,
    complexStreamingMode: document.querySelector('[data-testid="complex-streaming-markdown-active"] [data-streaming-markdown-mode]')?.getAttribute('data-streaming-markdown-mode') || '',
    complexDoneMode: document.querySelector('[data-testid="complex-streaming-markdown-done"] [data-streaming-markdown-mode]')?.getAttribute('data-streaming-markdown-mode') || '',
    completedIconKind: document.querySelector('[data-chat-status-kind="completed"] [data-chat-status-icon]')?.getAttribute('data-chat-status-icon') || '',
    completedIconSpinning: document.querySelector('[data-chat-status-kind="completed"] [data-chat-status-icon]')?.classList.contains('animate-spin') || false,
    statusBadges: Array.from(document.querySelectorAll('span')).map((node) => node.textContent || '').filter(Boolean),
  }));
  if (!doneSnapshot.body.includes('最终回答 OK 42')) {
    issues.push('answer did not appear after done flush');
  }
  if (doneSnapshot.body.includes('正在联网搜索')) {
    issues.push('web-search running badge remained after done without completed meta');
  }
  if (doneSnapshot.completedIconKind !== 'completed' || doneSnapshot.completedIconSpinning) {
    issues.push(`completed status should use a non-spinning completed icon: ${doneSnapshot.completedIconKind}, spinning=${doneSnapshot.completedIconSpinning}`);
  }
  await page.click('[data-chat-status-kind="completed"]');
  await page.waitForFunction(() => {
    const timeline = document.querySelector('[data-chat-status-timeline="true"]')?.textContent || '';
    return timeline.includes('模型响应成功')
      && timeline.includes('联网搜索完成 · 引用8个来源')
      && timeline.includes('思考推理完成')
      && timeline.includes('回答生成完成')
      && !timeline.includes('正在')
      && !timeline.includes('已用时');
  }, null, { timeout: 10_000 });
  const timelineSnapshot = await page.evaluate(() => {
    const panel = document.querySelector('[data-chat-status-timeline="true"]');
    const steps = Array.from(panel?.querySelectorAll('[data-chat-status-timeline-step]') || []).map((node) => ({
      id: node.getAttribute('data-chat-status-timeline-step') || '',
      text: node.textContent || '',
      icon: node.querySelector('[data-chat-status-timeline-icon]')?.textContent || '',
      iconKind: node.querySelector('[data-chat-status-timeline-icon]')?.getAttribute('data-chat-status-timeline-icon') || '',
    }));
    return { steps };
  });
  const stepIds = timelineSnapshot.steps.map((step) => step.id);
  const expectedOrder = ['waiting_provider:completed', 'web_search:completed', 'reasoning:completed', 'streaming_answer:completed'];
  if (JSON.stringify(stepIds) !== JSON.stringify(expectedOrder)) {
    issues.push(`timeline order mismatch: ${JSON.stringify(stepIds)}`);
  }
  const nonCompletedStep = timelineSnapshot.steps.find((step) => step.icon !== '✅' || step.iconKind !== 'completed');
  if (nonCompletedStep) {
    issues.push(`completed timeline should use ✅ icon for every step: ${JSON.stringify(nonCompletedStep)}`);
  }
  const runningTextStep = timelineSnapshot.steps.find((step) => step.text.includes('正在') || step.text.includes('已用时'));
  if (runningTextStep) {
    issues.push(`completed timeline should not show running text or per-step elapsed time: ${JSON.stringify(runningTextStep)}`);
  }
  if (!doneSnapshot.reasoningStrongText.includes('最终')) {
    issues.push('reasoning markdown bold did not render as strong element after completion');
  }
  if (!answerStreamingSnapshot.reasoningStrongText.includes('最终')) {
    issues.push('reasoning markdown bold did not render as strong element while loading');
  }
  if (!answerStreamingSnapshot.answerStrongText.includes('OK')) {
    issues.push('streaming answer markdown bold did not render as strong element while loading');
  }
  if (!doneSnapshot.answerStrongText.includes('OK')) {
    issues.push('answer markdown bold did not remain a strong element after completion');
  }
  if (doneImmediateSnapshot.answerMode !== 'rich' || doneSnapshot.answerMode !== 'rich') {
    issues.push(`completed simple markdown answer mode changed unexpectedly: ${doneImmediateSnapshot.answerMode} -> ${doneSnapshot.answerMode}`);
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
    console.error(JSON.stringify({ ok: false, issues, mixedSnapshot, answerStreamingSnapshot, doneImmediateSnapshot, doneSnapshot }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, mixedPhase: mixedSnapshot.phase, doneHasAnswer: doneSnapshot.body.includes('最终回答 OK 42') }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
