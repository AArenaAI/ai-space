#!/usr/bin/env node
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const BASE_URL = process.env.CHAT_FIXTURE_BASE_URL || 'http://127.0.0.1:3000';
const URL = `${BASE_URL}/test-chat-local-send-run`;

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

async function events(page) {
  return (await page.locator('[data-testid="local-send-events"]').textContent()) || '';
}

async function send(page, text) {
  await page.locator('[data-testid="chat-message-input"]').fill(text);
  await page.locator('[data-testid="chat-send-button"]').click();
}

async function testSuccess(page) {
  await page.goto(URL, { waitUntil: 'commit', timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-local-send-run-fixture"]', { timeout: 60000 });
  await page.locator('[data-testid="scenario-success"]').click();
  await send(page, 'hello local run');
  await page.waitForSelector('[data-testid="chat-stop-button"]');
  assert.equal(await page.locator('[data-testid="chat-message-input"]').inputValue(), '', 'input clears after local commit');
  let snapshot = await rows(page);
  assert.equal(snapshot.length, 2, 'local user + assistant rows appear immediately');
  const userKey = snapshot[0].renderKey;
  const assistantKey = snapshot[1].renderKey;
  assert.equal(snapshot[0].server, null, 'user is not server-bound initially');
  assert.equal(snapshot[1].server, null, 'assistant is not server-bound initially');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-chat-message-row="true"]')].some((row) => row.getAttribute('data-server-message-id') === '1002'));
  snapshot = await rows(page);
  assert.equal(snapshot[0].renderKey, userKey, 'user render key does not change on server bind');
  assert.equal(snapshot[1].renderKey, assistantKey, 'assistant render key does not change on server bind');
  assert.equal(snapshot[0].server, '1001');
  assert.equal(snapshot[1].server, '1002');
  assert.equal(snapshot[1].task, '9001');
  await page.waitForFunction(() => document.querySelector('[data-testid="local-send-events"]')?.textContent?.includes('completed'));
  assert.equal(await page.locator('[data-testid="chat-stop-button"]').count(), 0, 'Stop disappears after completion');
  assert.equal(await page.locator('[data-testid="chat-send-button"]').count(), 1, 'Send returns after completion');
}

async function testStopDuringInit(page) {
  await page.goto(URL, { waitUntil: 'commit', timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-local-send-run-fixture"]', { timeout: 60000 });
  await page.locator('[data-testid="scenario-stop"]').click();
  await send(page, 'cancel me');
  await page.waitForSelector('[data-testid="chat-stop-button"]');
  await page.locator('[data-testid="chat-stop-button"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="local-send-events"]')?.textContent?.includes('stopped'));
  const snapshot = await rows(page);
  assert.equal(snapshot.length, 2);
  assert.equal(snapshot[0].server, null, 'cancelled submit never server-binds user');
  assert.equal(snapshot[1].server, null, 'cancelled submit never server-binds assistant');
  assert.equal(await page.locator('[data-testid="chat-stop-button"]').count(), 0);
  assert.equal(await page.locator('[data-testid="chat-send-button"]').count(), 1);
  assert.ok(await page.locator('[data-testid="chat-user-message-edit-action"]').count(), 'cancelled row has edit action');
  await page.locator('[data-testid="chat-message-actions-more"]').first().click({ force: true });
  assert.equal(await page.locator('[data-testid="user-message-retry-action"]').count(), 1, 'retry is available inside actions menu');
}

async function testInitFail(page) {
  await page.goto(URL, { waitUntil: 'commit', timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-local-send-run-fixture"]', { timeout: 60000 });
  await page.locator('[data-testid="scenario-init-fail"]').click();
  await send(page, 'fail init');
  await page.waitForFunction(() => document.querySelector('[data-testid="local-send-events"]')?.textContent?.includes('init-failed'));
  const snapshot = await rows(page);
  assert.equal(snapshot[0].server, null);
  assert.equal(snapshot[1].server, null);
  assert.equal(await page.locator('[data-testid="chat-stop-button"]').count(), 0);
  await page.locator('[data-testid="chat-message-actions-more"]').first().click({ force: true });
  assert.equal(await page.locator('[data-testid="user-message-retry-action"]').count(), 1, 'failed row has retry action in menu');
  await page.locator('[data-testid="user-message-retry-action"]').first().click();
  await page.waitForFunction(() => document.querySelectorAll('[data-chat-message-row="true"]').length >= 4);
  assert.ok((await events(page)).includes('retry:fail init'), 'retry action is wired');
  let retried = await rows(page);
  assert.notEqual(retried[0].renderKey, retried[2].renderKey, 'retry creates a fresh user render key');
  assert.notEqual(retried[1].renderKey, retried[3].renderKey, 'retry creates a fresh assistant render key');
  await page.locator('[data-testid="chat-user-message-edit-action"]').first().click({ force: true });
  await page.waitForSelector('[data-testid="chat-user-message-edit-form"]');
}

async function testStreamFail(page) {
  await page.goto(URL, { waitUntil: 'commit', timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-local-send-run-fixture"]', { timeout: 60000 });
  await page.locator('[data-testid="scenario-stream-fail"]').click();
  await send(page, 'fail stream');
  await page.waitForFunction(() => document.querySelector('[data-testid="local-send-events"]')?.textContent?.includes('stream-failed'));
  const snapshot = await rows(page);
  assert.equal(snapshot[0].server, '1001', 'stream failure keeps server-bound user');
  assert.equal(snapshot[1].server, '1002', 'stream failure keeps server-bound assistant');
  assert.equal(snapshot[1].task, '9001');
  assert.ok(snapshot[1].text.includes('部分回答'), 'partial answer is retained');
  assert.equal(await page.locator('[data-testid="chat-stop-button"]').count(), 0);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('console', (msg) => console.log('[console]', msg.text()));
    page.setDefaultTimeout(30000);
    await testSuccess(page);
    await testStopDuringInit(page);
    await testInitFail(page);
    await testStreamFail(page);
    console.log(JSON.stringify({ ok: true, fixture: 'chat-local-send-run' }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
