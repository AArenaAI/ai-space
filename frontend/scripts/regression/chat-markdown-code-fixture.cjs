#!/usr/bin/env node
const { chromium } = require('playwright');

const baseUrl = process.env.CHAT_FIXTURE_BASE_URL || 'http://127.0.0.1:3000';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/test-chat-markdown-code/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('[data-testid="markdown-code-block"]', { timeout: 10_000 });
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => {
    const codeBlocks = [...document.querySelectorAll('[data-testid="markdown-code-block"]')];
    const streamingFixture = document.querySelector('[data-testid="streaming-echarts-fixture"]');
    const streamingCodeBlocks = streamingFixture ? [...streamingFixture.querySelectorAll('[data-testid="markdown-code-block"]')] : [];
    const streamingEchartsBlocks = streamingFixture ? [...streamingFixture.querySelectorAll('canvas, [_echarts_instance_], .echarts-for-react')] : [];
    const wrappedByPre = codeBlocks.filter((node) => node.parentElement?.tagName === 'PRE').length;
    const preInsideCustomBlock = codeBlocks.reduce((count, node) => count + node.querySelectorAll('pre').length, 0);
    const plainPreWrappers = [...document.querySelectorAll('pre')].filter((node) => node.querySelector('[data-testid="markdown-code-block"]')).length;
    return {
      codeBlockCount: codeBlocks.length,
      wrappedByPre,
      preInsideCustomBlock,
      plainPreWrappers,
      streamingCodeBlockCount: streamingCodeBlocks.length,
      streamingEchartsBlockCount: streamingEchartsBlocks.length,
      bodyText: document.body.innerText,
    };
  });

  if (result.codeBlockCount !== 2) throw new Error(`expected two custom code blocks, got ${result.codeBlockCount}`);
  if (result.streamingCodeBlockCount !== 1) throw new Error(`streaming echarts fence should render as code block: ${JSON.stringify(result)}`);
  if (result.streamingEchartsBlockCount !== 0) throw new Error(`streaming echarts fence initialized chart: ${JSON.stringify(result)}`);
  if (result.wrappedByPre !== 0) throw new Error(`custom code block is still wrapped by <pre>: ${JSON.stringify(result)}`);
  if (result.plainPreWrappers !== 0) throw new Error(`outer <pre> contains custom code block: ${JSON.stringify(result)}`);
  if (!result.bodyText.includes('export function hello')) throw new Error('code text missing from fixture');

  console.log(JSON.stringify({ ok: true, codeBlockCount: result.codeBlockCount, streamingCodeBlockCount: result.streamingCodeBlockCount, preInsideCustomBlock: result.preInsideCustomBlock }));
  await browser.close();
})().catch(async (error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
