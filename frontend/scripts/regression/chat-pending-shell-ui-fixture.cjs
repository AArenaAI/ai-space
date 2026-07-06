#!/usr/bin/env node
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.CHAT_PENDING_SHELL_BASE_URL || 'http://127.0.0.1:3210';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await page.goto(`${baseUrl}/test-chat-pending-shell`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('[data-testid="chat-pending-shell-fixture"]', { timeout: 30_000 });
    await page.waitForSelector('[data-chat-pending-shell="true"]', { timeout: 10_000 });

    const sample = await page.evaluate(() => {
      function pendingInfo(sectionSelector) {
        const section = document.querySelector(sectionSelector);
        const shells = Array.from(section?.querySelectorAll('[data-chat-pending-shell="true"]') || []);
        return shells.map((shell) => {
          const rect = shell.getBoundingClientRect();
          const text = (shell.textContent || '').trim();
          const core = shell.querySelector('[data-chat-pending-dot-core="true"]');
          const spinner = shell.querySelector('.animate-spin');
          return {
            text,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            hasPulse: Boolean(core?.classList.contains('animate-pulse')),
            hasCore: Boolean(core),
            hasSpinner: Boolean(spinner),
            className: shell.getAttribute('class') || '',
            ariaLabel: shell.getAttribute('aria-label') || '',
          };
        });
      }
      const activitySectionText = document.querySelector('[data-testid="activity-section"]')?.textContent || '';
      return {
        ordinary: pendingInfo('[data-testid="ordinary-pending-section"]'),
        compare: pendingInfo('[data-testid="compare-pending-section"]'),
        activityHasEntry: /已思考|来源/.test(activitySectionText),
        activitySectionText,
      };
    });

    assert.equal(sample.ordinary.length, 1, 'ordinary chat should render one pending breathing dot');
    assert.ok(sample.compare.length >= 1, 'compare should render pending breathing dot(s)');
    for (const entry of [...sample.ordinary, ...sample.compare]) {
      assert.equal(entry.text, '', 'pending shell should not show visible label text by default');
      assert.equal(entry.hasSpinner, false, 'pending shell should not use spinner');
      assert.equal(entry.hasPulse, true, 'pending shell should use breathing pulse');
      assert.equal(entry.hasCore, true, 'pending shell core should use neutral grey color');
      assert.ok(entry.height >= 18, 'pending shell should be visually noticeable');
      assert.ok(!entry.className.includes('bg-surface-card/35'), 'pending shell should not use card background');
      assert.ok(!entry.className.includes('border'), 'pending shell should not use border/card treatment');
    }
    assert.equal(sample.activityHasEntry, true, 'activity/thinking section should still expose its status entry');
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ ok: true, sample }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
