#!/usr/bin/env node
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const BASE_URL = process.env.CHAT_FIXTURE_BASE_URL || 'http://127.0.0.1:3000';
const URL = `${BASE_URL}/test-chat-local-send-switch-restore`;

async function rows(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-chat-message-row="true"]')].map((row) => ({
    role: row.getAttribute('data-message-role'),
    id: row.getAttribute('data-message-id'),
    renderKey: row.getAttribute('data-message-render-key'),
    server: row.getAttribute('data-server-message-id'),
    task: row.getAttribute('data-generation-task-id'),
    text: row.textContent || '',
  })));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(URL, { waitUntil: 'commit', timeout: 60000 });
    await page.waitForSelector('[data-testid="chat-local-send-switch-restore-fixture"]', { timeout: 60000 });
    await page.locator('[data-testid="start-send-a"]').click();
    let snapshot = await rows(page);
    assert.equal(snapshot.length, 2);
    const userKey = snapshot[0].renderKey;
    const assistantKey = snapshot[1].renderKey;
    assert.equal(snapshot[0].server, null);
    assert.equal(snapshot[1].server, null);

    await page.locator('[data-testid="switch-b"]').click();
    snapshot = await rows(page);
    assert.equal(snapshot.length, 1);
    assert.ok(snapshot[0].text.includes('conversation b'));

    await page.locator('[data-testid="bind-server-a"]').click();
    await page.locator('[data-testid="apply-stale-restore-a"]').click();
    await page.locator('[data-testid="switch-a"]').click();
    snapshot = await rows(page);
    assert.equal(snapshot.length, 2, 'switch back must not show local+server duplicates');
    assert.equal(snapshot[0].renderKey, userKey, 'user render key survives switch/server bind');
    assert.equal(snapshot[1].renderKey, assistantKey, 'assistant render key survives switch/server bind');
    assert.equal(snapshot[0].server, '7001');
    assert.equal(snapshot[1].server, '7002');
    assert.equal(snapshot[1].task, '9901');
    assert.ok(!snapshot.some((row) => row.text.includes('old restore')), 'stale restore must not overwrite fresh local run');
    const eventText = await page.locator('[data-testid="switch-events"]').textContent();
    assert.ok(eventText.includes('stale-restore-rejected:local_run_newer_than_restore'));
    console.log(JSON.stringify({ ok: true, fixture: 'chat-local-send-switch-restore' }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
