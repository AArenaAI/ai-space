#!/usr/bin/env node
const { chromium } = require('playwright');
const { printResult, summarizeConsole } = require('./chat-live-utils.cjs');

const baseMessages = [
  {
    id: 'reasoning-sources', role: 'assistant', model: 'fixture-model', content: '带思考和来源的回答', reasoningContent: '这里是模型思考。', createdAt: Date.now() - 4000, completedAt: Date.now() - 1000,
    searchSources: [{ title: 'Example', url: 'https://example.com/a', description: 'a' }], searchSourcesCount: 1, statusTimeline: [{ id: 'reasoning:completed', kind: 'reasoning', status: 'completed', startedAt: Date.now() - 3000, endedAt: Date.now() - 2000 }, { id: 'web_search:completed', kind: 'web_search', status: 'completed', startedAt: Date.now() - 2500, endedAt: Date.now() - 2200, count: 1 }],
  },
  {
    id: 'sources-only', role: 'assistant', model: 'fixture-model', content: '只有来源没有思考的回答', createdAt: Date.now() - 4000, completedAt: Date.now() - 1000,
    searchSources: [{ title: 'Example 2', url: 'https://example.com/b', description: 'b' }], searchSourcesCount: 1, statusTimeline: [{ id: 'web_search:completed', kind: 'web_search', status: 'completed', startedAt: Date.now() - 2500, endedAt: Date.now() - 2200, count: 1 }],
  },
  {
    id: 'reasoning-only', role: 'assistant', model: 'fixture-model', content: '只有思考没有来源的回答', reasoningContent: '这里是无来源思考。', createdAt: Date.now() - 4000, completedAt: Date.now() - 1000,
    statusTimeline: [{ id: 'reasoning:completed', kind: 'reasoning', status: 'completed', startedAt: Date.now() - 3000, endedAt: Date.now() - 2000 }],
  },
  {
    id: 'plain', role: 'assistant', model: 'fixture-model', content: '普通回答，没有思考也没有来源。', createdAt: Date.now() - 4000, completedAt: Date.now() - 1000,
    statusTimeline: [],
  },
];

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADFUL !== '1' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleEvents = [];
  const pageErrors = [];
  page.on('console', (msg) => consoleEvents.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));
  await page.addInitScript((messages) => {
    window.__CHAT_ACTIVITY_ENTRY_STATES_FIXTURE__ = messages;
  }, baseMessages);
  await page.goto('http://127.0.0.1:3210/test-chat-activity-entry-states', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-fixture-ready="true"]', { timeout: 30000 });
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('[data-fixture-row]')).map((row) => {
    const buttons = Array.from(row.querySelectorAll('button')).map((button) => (button.textContent || '').trim()).filter(Boolean);
    const entryText = buttons.find((text) => /来源|已思考|思考中/.test(text)) || '';
    return { id: row.getAttribute('data-fixture-row'), entryText, hasEntry: Boolean(entryText) };
  }));
  const panels = {};
  for (const row of rows.filter((row) => row.hasEntry)) {
    await page.locator(`[data-fixture-row="${row.id}"] button`).filter({ hasText: /来源|已思考|思考中/ }).first().click();
    await page.waitForSelector('[data-chat-activity-panel="true"]', { timeout: 10000 });
    panels[row.id] = await page.evaluate(() => {
      const panel = document.querySelector('[data-chat-activity-panel="true"]');
      const title = panel?.getAttribute('data-chat-activity-title') || '';
      const text = panel?.textContent || '';
      return { title, hasSources: text.includes('参考来源'), text };
    });
    await page.locator('[data-fixture-close]').click({ timeout: 5000 });
    await page.waitForSelector('[data-chat-activity-panel="true"]', { state: 'detached', timeout: 10000 }).catch(() => {});
  }
  await browser.close();
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  const result = {
    ok: byId['reasoning-sources']?.entryText.includes('已思考')
      && byId['sources-only']?.entryText === '来源 · 1'
      && byId['reasoning-only']?.entryText.includes('已思考')
      && byId['plain']?.hasEntry === false
      && panels['reasoning-sources']?.title === '思考与来源'
      && panels['reasoning-sources']?.hasSources === true
      && panels['reasoning-only']?.title === '思考过程'
      && panels['reasoning-only']?.hasSources === false
      && panels['sources-only']?.title === '思考与来源'
      && panels['sources-only']?.hasSources === true
      && pageErrors.length === 0,
    rows,
    panels,
    consoleErrors: summarizeConsole(consoleEvents),
    pageErrors,
  };
  printResult(result);
  if (!result.ok) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
