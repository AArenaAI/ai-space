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
  await page.waitForFunction(() => document.querySelector('[data-testid="fixture-phase"]')?.textContent === 'mixed-held', null, { timeout: 10_000 });
  await page.waitForFunction(() => document.body.innerText.includes('先分析搜索结果'), null, { timeout: 10_000 });
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
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.reasoning-markdown strong')).some((node) => node.textContent?.includes('最终')), null, { timeout: 10_000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.streaming-answer-markdown strong')).some((node) => node.textContent?.includes('OK')), null, { timeout: 10_000 });
  const answerStreamingSnapshot = await page.evaluate(() => ({
    phase: document.querySelector('[data-testid="fixture-phase"]')?.textContent || '',
    reasoningStrongText: Array.from(document.querySelectorAll('.reasoning-markdown strong')).map((node) => node.textContent || '').join('|'),
    answerStrongText: Array.from(document.querySelectorAll('.streaming-answer-markdown strong')).map((node) => node.textContent || '').join('|'),
  }));

  await page.waitForFunction(() => document.querySelector('[data-testid="fixture-phase"]')?.textContent === 'done', null, { timeout: 10_000 });
  await page.waitForFunction(() => document.body.innerText.includes('最终回答 OK 42'), null, { timeout: 10_000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('strong')).some((node) => node.textContent?.includes('最终')), null, { timeout: 10_000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('strong')).some((node) => node.textContent?.includes('OK')), null, { timeout: 10_000 });
  const doneSnapshot = await page.evaluate(() => ({
    body: document.body.innerText,
    reasoningStrongText: Array.from(document.querySelectorAll('.reasoning-markdown strong')).map((node) => node.textContent || '').join('|'),
    answerStrongText: Array.from(document.querySelectorAll('strong')).map((node) => node.textContent || '').join('|'),
    statusBadges: Array.from(document.querySelectorAll('span')).map((node) => node.textContent || '').filter(Boolean),
  }));
  if (!doneSnapshot.body.includes('最终回答 OK 42')) {
    issues.push('answer did not appear after done flush');
  }
  if (doneSnapshot.body.includes('正在联网搜索')) {
    issues.push('web-search running badge remained after done without completed meta');
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

  await browser.close();
  if (issues.length) {
    console.error(JSON.stringify({ ok: false, issues, mixedSnapshot, answerStreamingSnapshot, doneSnapshot }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, mixedPhase: mixedSnapshot.phase, doneHasAnswer: doneSnapshot.body.includes('最终回答 OK 42') }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
