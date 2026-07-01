#!/usr/bin/env node
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.COMPARE_COLUMN_SCROLL_BASE_URL || 'http://127.0.0.1:3000';
const path = process.env.COMPARE_COLUMN_SCROLL_PATH || '/test-chat-performance/?count=80&longEvery=1&compare=1&hasMore=0';

async function sample(page, label) {
  return page.evaluate((label) => {
    const outer = Array.from(document.querySelectorAll('[data-testid="chat-history-scroll-container"]'))
      .find((node) => node instanceof HTMLElement && node.offsetParent !== null && node.clientHeight > 0);
    const root = outer instanceof HTMLElement ? outer : document;
    const columns = Array.from(root.querySelectorAll('[data-compare-column-scroll-container="true"]'))
      .filter((node) => node instanceof HTMLElement)
      .map((node, index) => {
        const rect = node.getBoundingClientRect();
        return {
          index,
          model: node.getAttribute('data-compare-column-model') || '',
          scrollTop: Math.round(node.scrollTop),
          scrollHeight: Math.round(node.scrollHeight),
          clientHeight: Math.round(node.clientHeight),
          canScroll: node.scrollHeight > node.clientHeight + 8,
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });
    return {
      label,
      outerScrollTop: outer instanceof HTMLElement ? Math.round(outer.scrollTop) : -1,
      outerScrollHeight: outer instanceof HTMLElement ? Math.round(outer.scrollHeight) : -1,
      outerClientHeight: outer instanceof HTMLElement ? Math.round(outer.clientHeight) : -1,
      columnCount: columns.length,
      scrollableColumns: columns.filter((column) => column.canScroll).length,
      columns,
    };
  }, label);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-testid="chat-history-scroll-container"]')).some((node) => node instanceof HTMLElement && node.offsetParent !== null && node.clientHeight > 0), null, { timeout: 30_000 });
    await page.waitForFunction(() => {
      const outer = Array.from(document.querySelectorAll('[data-testid="chat-history-scroll-container"]'))
        .find((node) => node instanceof HTMLElement && node.offsetParent !== null && node.clientHeight > 0);
      const root = outer instanceof HTMLElement ? outer : document;
      const columns = Array.from(root.querySelectorAll('[data-compare-column-scroll-container="true"]'));
      return columns.some((node) => node instanceof HTMLElement && node.scrollHeight > node.clientHeight + 80);
    }, null, { timeout: 30_000 });
    await page.evaluate(() => {
      const outer = Array.from(document.querySelectorAll('[data-testid="chat-history-scroll-container"]'))
        .find((node) => node instanceof HTMLElement && node.offsetParent !== null && node.clientHeight > 0);
      if (outer instanceof HTMLElement) outer.scrollTop = outer.scrollHeight;
    });
    await page.waitForTimeout(350);
    const before = await sample(page, 'before-column-wheel');
    const target = await page.evaluate(() => {
      const outer = Array.from(document.querySelectorAll('[data-testid="chat-history-scroll-container"]'))
        .find((node) => node instanceof HTMLElement && node.offsetParent !== null && node.clientHeight > 0);
      const root = outer instanceof HTMLElement ? outer : document;
      const columns = Array.from(root.querySelectorAll('[data-compare-column-scroll-container="true"]'))
        .filter((node) => node instanceof HTMLElement)
        .map((node, index) => {
          const rect = node.getBoundingClientRect();
          return {
            index,
            canScroll: node.scrollHeight > node.clientHeight + 8,
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        });
      return columns.find((column) => column.canScroll && column.top < 820 && column.top + column.height > 80)
        || columns.find((column) => column.canScroll)
        || null;
    });
    assert.ok(target, 'expected at least one visible scrollable compare column');
    await page.evaluate((targetIndex) => {
      const outer = Array.from(document.querySelectorAll('[data-testid="chat-history-scroll-container"]'))
        .find((node) => node instanceof HTMLElement && node.offsetParent !== null && node.clientHeight > 0);
      const root = outer instanceof HTMLElement ? outer : document;
      const columns = Array.from(root.querySelectorAll('[data-compare-column-scroll-container="true"]'));
      const column = columns[targetIndex];
      if (column instanceof HTMLElement) column.scrollTop = 0;
    }, target.index);
    await page.waitForTimeout(120);
    const reset = await sample(page, 'after-column-reset');
    const resetTarget = reset.columns[target.index];
    const x = resetTarget.left + Math.min(resetTarget.width - 20, Math.max(20, resetTarget.width / 2));
    const y = resetTarget.top + Math.min(resetTarget.height - 20, Math.max(20, resetTarget.height / 2));
    await page.mouse.move(x, y);
    const outerBeforeWheel = reset.outerScrollTop;
    const columnBeforeWheel = resetTarget.scrollTop;
    await page.mouse.wheel(0, 620);
    await page.waitForTimeout(180);
    const after = await sample(page, 'after-column-wheel');
    const afterTarget = after.columns[target.index];
    const outerDelta = Math.abs(after.outerScrollTop - outerBeforeWheel);
    const columnDelta = afterTarget.scrollTop - columnBeforeWheel;
    const edgeState = await page.evaluate((targetIndex) => {
      const outer = Array.from(document.querySelectorAll('[data-testid="chat-history-scroll-container"]'))
        .find((node) => node instanceof HTMLElement && node.offsetParent !== null && node.clientHeight > 0);
      const root = outer instanceof HTMLElement ? outer : document;
      const column = Array.from(root.querySelectorAll('[data-compare-column-scroll-container="true"]'))[targetIndex];
      const frame = column instanceof HTMLElement ? column.closest('[data-compare-column-scroll-frame="true"]') : null;
      const topShadow = frame?.querySelector('[data-compare-column-scroll-shadow="top"]');
      const bottomShadow = frame?.querySelector('[data-compare-column-scroll-shadow="bottom"]');
      if (!(column instanceof HTMLElement)) return { missing: true };
      return {
        canScroll: column.getAttribute('data-compare-column-can-scroll'),
        atTop: column.getAttribute('data-compare-column-at-top'),
        atBottom: column.getAttribute('data-compare-column-at-bottom'),
        topShadowVisible: topShadow?.className.includes('opacity-100') || false,
        bottomShadowVisible: bottomShadow?.className.includes('opacity-100') || false,
      };
    }, target.index);

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-testid="chat-history-scroll-container"]')).some((node) => node instanceof HTMLElement && node.offsetParent !== null && node.clientHeight > 0), null, { timeout: 30_000 });
    await page.waitForFunction(() => {
      const outer = Array.from(document.querySelectorAll('[data-testid="chat-history-scroll-container"]'))
        .find((node) => node instanceof HTMLElement && node.offsetParent !== null && node.clientHeight > 0);
      return !!outer && outer.querySelectorAll('[data-compare-column-scroll-container="true"]').length > 0;
    }, null, { timeout: 30_000 });
    await page.evaluate(() => {
      const outer = Array.from(document.querySelectorAll('[data-testid="chat-history-scroll-container"]'))
        .find((node) => node instanceof HTMLElement && node.offsetParent !== null && node.clientHeight > 0);
      if (outer instanceof HTMLElement) outer.scrollTop = outer.scrollHeight;
    });
    await page.waitForTimeout(500);
    const restored = await sample(page, 'after-reload-column-restore');
    const restoredTarget = restored.columns[target.index];
    const restoredDelta = Math.abs((restoredTarget?.scrollTop || 0) - afterTarget.scrollTop);
    const result = {
      ok: outerDelta <= 4
        && columnDelta > 80
        && edgeState.canScroll === 'true'
        && edgeState.atTop === 'false'
        && restoredDelta <= 8
        && consoleErrors.length === 0
        && pageErrors.length === 0,
      before,
      reset,
      after,
      restored,
      target,
      outerDelta,
      columnDelta,
      restoredDelta,
      edgeState,
      consoleErrors,
      pageErrors,
    };
    const compact = {
      ok: result.ok,
      outerDelta,
      columnDelta,
      restoredDelta,
      target,
      edgeState,
      counts: {
        beforeColumns: before.columnCount,
        scrollableColumns: before.scrollableColumns,
      },
      consoleErrors,
      pageErrors,
    };
    console.log(JSON.stringify(process.env.VERBOSE_COMPARE_COLUMN_SCROLL ? result : compact, null, 2));
    if (!result.ok) process.exit(1);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
