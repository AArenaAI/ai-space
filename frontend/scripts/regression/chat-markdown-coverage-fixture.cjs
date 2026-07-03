#!/usr/bin/env node
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.CHAT_MARKDOWN_COVERAGE_BASE_URL || 'http://127.0.0.1:3344';

const expectations = {
  heading: { label: '标题 h1/h2/h3', selector: 'h1,h2,h3', min: 3 },
  paragraphStrong: { label: '段落粗体', selector: 'p strong', min: 1 },
  paragraphEm: { label: '段落斜体', selector: 'p em', min: 1 },
  paragraphDel: { label: '删除线', selector: 'p del', min: 1 },
  inlineCode: { label: '行内代码', selector: 'p code', min: 1 },
  paragraphLink: { label: '段落链接', selector: 'a[href="https://example.com/paragraph"]', min: 1 },
  bulletList: { label: '无序列表', selector: 'ul li', min: 4 },
  listStrong: { label: '列表内粗体', selector: 'li strong', min: 2 },
  listLink: { label: '列表内链接', selector: 'li a[href="https://example.com/list"]', min: 1 },
  orderedList: { label: '有序列表', selector: 'ol li', min: 2 },
  taskList: { label: '任务列表', selector: 'input[type="checkbox"]', min: 2 },
  blockquote: { label: '引用块', selector: 'blockquote', min: 1 },
  blockquoteStrong: { label: '引用块内粗体', selector: 'blockquote strong', min: 1 },
  table: { label: '表格', selector: 'table', min: 1 },
  tableStrong: { label: '表格内粗体', selector: 'table strong', min: 1 },
  codeBlock: { label: '围栏代码块', selector: '[data-testid="markdown-code-block"]', min: 1 },
  codeBlockPolicy: { label: '代码块 block-local 策略', selector: '[data-md-block-type="code"][data-md-enhance-policy="block-local"]', min: 1 },
  tablePolicy: { label: '表格 block-local 策略', selector: '[data-md-block-type="table"][data-md-enhance-policy="block-local"]', min: 1 },
  hr: { label: '分割线', selector: 'hr', min: 1 },
};

const unsupportedChecks = {
  html: { label: 'HTML 块/行内 HTML', raw: '<span data-custom-html' },
  image: { label: '图片语法 ![]()', raw: '![Alt 文本]' },
  footnote: { label: '脚注', raw: '[^note]' },
  mathInline: { label: '行内数学', raw: '$E=mc^2$' },
  mathBlock: { label: '块级数学', raw: '$$' },
  mermaid: { label: 'Mermaid 图表', raw: 'graph TD' },
};

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADFUL !== '1' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
  const consoleErrors = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' && !/Failed to load resource|Minified React error #(422|425)/.test(text)) consoleErrors.push(text);
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  const response = await page.goto(`${baseUrl}/test-chat-markdown-token/?coverage=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  assert.ok(response && response.status() < 400, `unexpected status ${response?.status()}`);
  await page.waitForSelector('[data-testid="markdown-token-fixture"]', { timeout: 20_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="markdown-token-fixture"] [data-markdown-token-renderer="stable"], [data-testid="markdown-token-fixture"] [data-markdown-token-renderer="preview"]'), undefined, { timeout: 8_000 });

  const result = await page.evaluate(({ expectations, unsupportedChecks }) => {
    const root = document.querySelector('[data-testid="markdown-token-fixture"]');
    const text = root?.textContent || '';
    const checks = {};
    for (const [key, rule] of Object.entries(expectations)) {
      const count = root?.querySelectorAll(rule.selector).length || 0;
      checks[key] = { ...rule, count, ok: count >= rule.min };
    }
    const unsupported = {};
    for (const [key, rule] of Object.entries(unsupportedChecks)) {
      unsupported[key] = { ...rule, rawVisible: text.includes(rule.raw) };
    }
    return {
      renderer: root?.querySelector('[data-markdown-token-renderer]')?.getAttribute('data-markdown-token-renderer') || 'none',
      rawLeaks: {
        bold: text.includes('**list bold**') || text.includes('**paragraph bold**'),
        link: text.includes('[paragraph link](https://example.com/paragraph)') || text.includes('[list link](https://example.com/list)'),
        tableStrong: text.includes('**table bold**'),
      },
      checks,
      unsupported,
      textSample: text.slice(0, 1000),
    };
  }, { expectations, unsupportedChecks });

  await browser.close();
  const failed = Object.entries(result.checks).filter(([, value]) => !value.ok).map(([key, value]) => ({ key, ...value }));
  const rawLeakFailed = Object.entries(result.rawLeaks).filter(([, value]) => value).map(([key]) => key);
  const ok = failed.length === 0 && rawLeakFailed.length === 0 && consoleErrors.length === 0;
  console.log(JSON.stringify({ ok, failed, rawLeakFailed, consoleErrors, ...result }, null, 2));
  if (!ok) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
