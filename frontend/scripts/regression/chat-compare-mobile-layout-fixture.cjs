#!/usr/bin/env node
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.COMPARE_MOBILE_BASE_URL || 'http://127.0.0.1:3000';
const path = process.env.COMPARE_MOBILE_PATH || '/test-chat-performance/?count=12&longEvery=1&compare=1&hasMore=0';

async function sample(page) {
  return page.evaluate(() => {
    const outer = Array.from(document.querySelectorAll('[data-testid="chat-history-scroll-container"]'))
      .find((node) => node instanceof HTMLElement && node.offsetParent !== null && node.clientHeight > 0);
    const root = outer instanceof HTMLElement ? outer : document;
    const groups = Array.from(root.querySelectorAll('[data-chat-compare-columns="true"]'))
      .filter((node) => node instanceof HTMLElement)
      .map((node, index) => {
        const rect = node.getBoundingClientRect();
        const shells = Array.from(node.querySelectorAll('[data-chat-compare-column-shell="true"]'))
          .filter((shell) => shell instanceof HTMLElement)
          .map((shell) => {
            const shellRect = shell.getBoundingClientRect();
            return {
              left: Math.round(shellRect.left),
              top: Math.round(shellRect.top),
              width: Math.round(shellRect.width),
              height: Math.round(shellRect.height),
            };
          });
        return {
          index,
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          shellCount: shells.length,
          shells,
        };
      });
    const firstTwoShellGroup = groups.find((group) => group.shellCount >= 2) || null;
    const stacked = firstTwoShellGroup
      ? firstTwoShellGroup.shells[1].top > firstTwoShellGroup.shells[0].top + Math.min(48, firstTwoShellGroup.shells[0].height / 4)
        && Math.abs(firstTwoShellGroup.shells[1].left - firstTwoShellGroup.shells[0].left) <= 8
      : false;
    return { groupCount: groups.length, firstTwoShellGroup, stacked };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-chat-compare-columns="true"]').length > 0, null, { timeout: 30_000 });
    await page.waitForTimeout(300);
    const result = await sample(page);
    result.consoleErrors = consoleErrors;
    result.pageErrors = pageErrors;
    result.ok = Boolean(result.firstTwoShellGroup) && result.stacked && consoleErrors.length === 0 && pageErrors.length === 0;
    console.log(JSON.stringify(result, null, 2));
    assert.ok(result.ok, 'expected compare columns to stack on mobile viewport');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
