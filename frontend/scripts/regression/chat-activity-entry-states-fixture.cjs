#!/usr/bin/env node
const { chromium } = require('playwright');
const { authHeaders, DEFAULT_BASE, env, printResult, summarizeConsole } = require('./chat-live-utils.cjs');

const baseUrl = (env('CHAT_ACTIVITY_ENTRY_BASE_URL', env('BASE_URL', 'http://127.0.0.1:3210')) || DEFAULT_BASE).replace(/\/+$/, '');

const baseMessages = [
  {
    id: 'reasoning-sources', role: 'assistant', model: 'fixture-model', content: '带思考和来源的回答', reasoningContent: '这里是模型思考。', createdAt: Date.now() - 4000, completedAt: Date.now() - 1000,
    searchSources: [{ title: 'Example', url: 'https://example.com/a', description: 'a' }], searchSourcesCount: 1, statusTimeline: [{ id: 'reasoning:completed', kind: 'reasoning', status: 'completed', startedAt: Date.now() - 3000, endedAt: Date.now() - 2000 }, { id: 'web_search:completed', kind: 'web_search', status: 'completed', startedAt: Date.now() - 2500, endedAt: Date.now() - 2200, count: 1 }],
  },
  {
    id: 'sources-only', role: 'assistant', model: 'fixture-model', content: '只有来源没有思考的回答', createdAt: Date.now() - 4000, completedAt: Date.now() - 1000,
    searchSources: [
      { title: 'Example 2', url: 'https://example.com/b', description: 'b' },
      { title: 'Example 3', url: 'https://example.com/c', description: 'c' },
      { title: 'Docs', url: 'https://docs.example.org/a', description: 'docs' },
    ], searchSourcesCount: 3, statusTimeline: [{ id: 'web_search:completed', kind: 'web_search', status: 'completed', startedAt: Date.now() - 2500, endedAt: Date.now() - 2200, count: 3 }],
  },
  {
    id: 'reasoning-only', role: 'assistant', model: 'fixture-model', content: '只有思考没有来源的回答', reasoningContent: '这里是无来源思考。', createdAt: Date.now() - 4000, completedAt: Date.now() - 1000,
    statusTimeline: [{ id: 'reasoning:completed', kind: 'reasoning', status: 'completed', startedAt: Date.now() - 3000, endedAt: Date.now() - 2000 }],
  },
  {
    id: 'plain', role: 'assistant', model: 'fixture-model', content: '普通回答，没有思考也没有来源。', createdAt: Date.now() - 4000, completedAt: Date.now() - 1000,
    statusTimeline: [],
  },
  {
    id: 'failed-sources', role: 'assistant', model: 'fixture-model', content: '上游模型请求失败，但搜索已经完成。', createdAt: Date.now() - 4000, completedAt: Date.now() - 1000, phase: 'failed', serverGenerationStatus: 'failed',
    searchSources: [{ title: 'Failure Source', url: 'https://example.com/failure', description: 'failure' }], searchSourcesCount: 1, statusTimeline: [{ id: 'web_search:completed', kind: 'web_search', status: 'completed', startedAt: Date.now() - 2500, endedAt: Date.now() - 2200, count: 1 }, { id: 'waiting_provider:failed', kind: 'waiting_provider', status: 'failed', startedAt: Date.now() - 2000, endedAt: Date.now() - 1000 }],
  },
  {
    id: 'dense-sources-files', role: 'assistant', model: 'fixture-model', content: '多来源和文件的回答', reasoningContent: '这里是多来源回答的简短思考。', createdAt: Date.now() - 5000, completedAt: Date.now() - 1000,
    files: [{ public_id: 'file-1', filename: 'report.pdf', type: 'pdf' }, { public_id: 'file-2', filename: 'notes.md', type: 'text' }],
    searchSources: Array.from({ length: 11 }, (_, index) => ({ title: `Dense Source ${index + 1}`, url: `https://domain-${index + 1}.example.com/path`, description: `dense-${index + 1}` })),
    searchSourcesCount: 11,
    statusTimeline: [{ id: 'file_search:completed', kind: 'file_search', status: 'completed', startedAt: Date.now() - 3500, endedAt: Date.now() - 3300 }, { id: 'web_search:completed', kind: 'web_search', status: 'completed', startedAt: Date.now() - 3000, endedAt: Date.now() - 2200, count: 11 }, { id: 'reasoning:completed', kind: 'reasoning', status: 'completed', startedAt: Date.now() - 2000, endedAt: Date.now() - 1600 }],
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
  await page.goto(`${baseUrl}/test-chat-activity-entry-states`, { waitUntil: 'domcontentloaded', timeout: 60000 });
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
      const summaryChips = Array.from(panel?.querySelectorAll('[data-chat-activity-summary-chip]') || []).map((chip) => ({
        kind: chip.getAttribute('data-chat-activity-summary-chip') || '',
        text: chip.textContent || '',
      }));
      const visibleGroups = Array.from(panel?.querySelectorAll('[data-chat-source-group]') || []).map((group) => ({
        host: group.getAttribute('data-chat-source-group') || '',
        open: group.getAttribute('data-source-group-open') || '',
      }));
      return { title, hasSources: text.includes('参考来源'), text, summaryChips, visibleGroups };
    });
    if (row.id === 'dense-sources-files') {
      await page.locator('[data-chat-source-group="domain-1.example.com"]').first().click();
      await page.waitForTimeout(120);
      panels[row.id].afterFirstToggle = await page.evaluate(() => document.querySelector('[data-chat-source-group="domain-1.example.com"]')?.getAttribute('data-source-group-open') || '');
      await page.locator('button').filter({ hasText: /显示全部来源域名/ }).first().click();
      await page.waitForTimeout(120);
      panels[row.id].afterShowAllCount = await page.locator('[data-chat-source-group]').count();
    }
    await page.locator('[data-fixture-close]').click({ timeout: 5000 });
    await page.waitForSelector('[data-chat-activity-panel="true"]', { state: 'detached', timeout: 10000 }).catch(() => {});
  }
  await browser.close();
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  const result = {
    ok: byId['reasoning-sources']?.entryText.includes('已思考')
      && byId['sources-only']?.entryText === '来源 · 3'
      && byId['reasoning-only']?.entryText.includes('已思考')
      && byId['plain']?.hasEntry === false
      && byId['failed-sources']?.entryText === '来源 · 1'
      && panels['reasoning-sources']?.title === '思考与来源'
      && panels['reasoning-sources']?.hasSources === true
      && panels['reasoning-only']?.title === '思考过程'
      && panels['reasoning-only']?.hasSources === false
      && panels['sources-only']?.title === '思考与来源'
      && panels['sources-only']?.hasSources === true
      && panels['sources-only']?.text.includes('example.com · 2')
      && panels['sources-only']?.text.includes('展开')
      && panels['sources-only']?.text.includes('docs.example.org')
      && panels['failed-sources']?.title === '思考与来源'
      && panels['failed-sources']?.hasSources === true
      && panels['failed-sources']?.text.includes('搜索完成')
      && panels['failed-sources']?.text.includes('模型生成失败')
      && panels['dense-sources-files']?.summaryChips?.some((chip) => chip.kind === 'process' && /过程/.test(chip.text))
      && panels['dense-sources-files']?.summaryChips?.some((chip) => chip.kind === 'sources' && /11/.test(chip.text))
      && panels['dense-sources-files']?.summaryChips?.some((chip) => chip.kind === 'files' && /2/.test(chip.text))
      && panels['dense-sources-files']?.visibleGroups?.length === 8
      && panels['dense-sources-files']?.text.includes('显示全部来源域名 · 还有 3 个')
      && panels['dense-sources-files']?.afterFirstToggle === 'true'
      && panels['dense-sources-files']?.afterShowAllCount === 11
      && pageErrors.length === 0,
    rows,
    panels,
    baseUrl,
    consoleErrors: summarizeConsole(consoleEvents),
    pageErrors,
  };
  printResult(result);
  if (!result.ok) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
