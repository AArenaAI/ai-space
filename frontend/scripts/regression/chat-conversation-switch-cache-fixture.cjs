#!/usr/bin/env node
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.CHAT_CONVERSATION_SWITCH_CACHE_FIXTURE_BASE_URL || "http://127.0.0.1:3000";

function textIncludes(text, needle) {
  return text.includes(needle);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console error: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));

  try {
    await page.addInitScript(() => localStorage.setItem("theme", "green"));
    const response = await page.goto(`${baseUrl}/test-chat-conversation-switch-cache/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    assert.ok(response && response.status() < 400, `unexpected status ${response?.status()}`);
    const fixture = page.locator('[data-testid="chat-conversation-switch-cache-fixture"]');
    await fixture.waitFor({ state: "attached", timeout: 20_000 });

    await page.locator('[data-testid="switch-cache-miss"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="chat-conversation-switch-cache-fixture"]')?.getAttribute("data-phase") === "cache-miss-loading", null, { timeout: 10_000 });
    const missLoading = await page.evaluate(() => ({
      text: document.body.innerText,
      rows: document.querySelectorAll('[data-chat-message-row="true"]').length,
      hasScroller: Boolean(document.querySelector('[data-testid="virtuoso-scroller"]')),
      hasLoadingState: Boolean(document.querySelector('[data-testid="chat-history-loading-state"]')),
      phase: document.querySelector('[data-testid="chat-conversation-switch-cache-fixture"]')?.getAttribute("data-phase"),
    }));
    assert.equal(missLoading.phase, "cache-miss-loading");
    assert.equal(missLoading.rows, 0, "cache miss loading should clear previous conversation rows");
    assert.ok(missLoading.hasScroller, "cache miss loading should keep the chat scroller mounted");
    assert.ok(missLoading.hasLoadingState, "cache miss loading should show in-chat loading state");
    assert.ok(!textIncludes(missLoading.text, "上一个会话 99"), "cache miss loading must not show previous conversation content");

    await page.waitForFunction(() => document.querySelector('[data-testid="chat-conversation-switch-cache-fixture"]')?.getAttribute("data-phase") === "cache-miss-restored", null, { timeout: 10_000 });
    await page.waitForSelector('[data-message-id="fresh-assistant-101"]', { state: "attached", timeout: 10_000 });

    await page.locator('[data-testid="switch-cache-hit"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="chat-conversation-switch-cache-fixture"]')?.getAttribute("data-phase") === "cache-hit-immediate", null, { timeout: 10_000 });
    const hitImmediate = await page.evaluate(() => ({
      text: document.body.innerText,
      rows: document.querySelectorAll('[data-chat-message-row="true"]').length,
      hasCached: Boolean(document.querySelector('[data-message-id="cached-assistant-100"]')),
      hasFresh101: Boolean(document.querySelector('[data-message-id="fresh-assistant-101"]')),
      hasLoadingState: Boolean(document.querySelector('[data-testid="chat-history-loading-state"]')),
      phase: document.querySelector('[data-testid="chat-conversation-switch-cache-fixture"]')?.getAttribute("data-phase"),
    }));
    assert.equal(hitImmediate.phase, "cache-hit-immediate");
    assert.ok(hitImmediate.hasCached, "cache hit should render cached target-conversation rows immediately");
    assert.ok(!hitImmediate.hasFresh101, "cache hit should not keep the previous conversation 101 rows");
    assert.ok(!textIncludes(hitImmediate.text, "会话 101 从服务端恢复后的回答"), "cache hit must not show the previous restored conversation content");
    assert.ok(!hitImmediate.hasLoadingState, "cache hit should not show history loading state");

    await page.waitForFunction(() => document.querySelector('[data-testid="chat-conversation-switch-cache-fixture"]')?.getAttribute("data-phase") === "cache-hit-refreshed", null, { timeout: 10_000 });
    const refreshed = await page.evaluate(() => ({
      rows: document.querySelectorAll('[data-chat-message-row="true"]').length,
      phase: document.querySelector('[data-testid="chat-conversation-switch-cache-fixture"]')?.getAttribute("data-phase"),
      model: document.querySelector('[data-testid="chat-conversation-switch-cache-fixture"]')?.getAttribute("data-model"),
      loadedPersisted: document.querySelector('[data-testid="chat-conversation-switch-cache-fixture"]')?.getAttribute("data-loaded-persisted"),
      total: document.querySelector('[data-testid="chat-conversation-switch-cache-fixture"]')?.getAttribute("data-total"),
    }));
    assert.equal(refreshed.phase, "cache-hit-refreshed");
    assert.equal(refreshed.loadedPersisted, "3", "background refresh should reconcile the restored conversation snapshot count");
    assert.equal(refreshed.total, "3", "background refresh should reconcile the restored conversation total count");
    assert.equal(refreshed.model, "fixture-model-2", "background restore should apply server-selected model metadata");

    if (failures.length > 0) throw new Error(failures.join("\n"));
    console.log(JSON.stringify({ ok: true, missLoadingRows: missLoading.rows, hitImmediateRows: hitImmediate.rows, refreshedRows: refreshed.rows }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
