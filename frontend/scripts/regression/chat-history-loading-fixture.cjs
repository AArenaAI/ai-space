#!/usr/bin/env node
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.CHAT_HISTORY_LOADING_FIXTURE_BASE_URL || "http://127.0.0.1:3000";

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
    const response = await page.goto(`${baseUrl}/test-chat-history-loading/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    assert.ok(response && response.status() < 400, `unexpected status ${response?.status()}`);
    await page.waitForSelector('[data-testid="chat-history-loading-fixture"]', { timeout: 20_000 });
    await page.waitForSelector('[data-chat-message-row="true"]', { timeout: 20_000 });

    const samples = [];
    const deadline = Date.now() + 1300;
    while (Date.now() < deadline) {
      samples.push(await page.evaluate(() => {
        const fixture = document.querySelector('[data-testid="chat-history-loading-fixture"]');
        const rows = document.querySelectorAll('[data-chat-message-row="true"]').length;
        const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
        const welcome = document.body.innerText.includes("有什么可以帮你") || document.body.innerText.includes("How can I help");
        const loadingDots = document.querySelector('[data-testid="chat-history-loading-state"]');
        const body = document.body.getBoundingClientRect();
        return {
          phase: fixture?.getAttribute("data-phase") || "unknown",
          rows,
          hasScroller: Boolean(scroller),
          hasWelcome: welcome,
          hasLoadingState: Boolean(loadingDots),
          bodyHeight: body.height,
        };
      }));
      await page.waitForTimeout(50);
    }

    const loadingSamples = samples.filter((sample) => sample.phase === "loading");
    assert.ok(loadingSamples.length >= 3, "fixture should sample the loading phase");
    assert.ok(loadingSamples.every((sample) => !sample.hasWelcome), "history loading should never show welcome empty state");
    assert.ok(loadingSamples.every((sample) => sample.hasScroller), "history loading should keep a chat body scroller instead of unmounting the chat body");
    assert.ok(loadingSamples.every((sample) => sample.rows === 0), "loading phase should not render stale previous-conversation rows");
    assert.ok(loadingSamples.every((sample) => sample.hasLoadingState), "loading phase should render stable in-chat loading state");

    await page.waitForFunction(() => document.querySelector('[data-testid="chat-history-loading-fixture"]')?.getAttribute("data-phase") === "restored", null, { timeout: 5_000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-chat-message-row="true"]').length >= 2, null, { timeout: 5_000 });
    const finalRows = await page.locator('[data-chat-message-row="true"]').count();
    assert.ok(finalRows >= 2, `restored history should render messages, got ${finalRows}`);

    if (failures.length > 0) throw new Error(failures.join("\n"));
    console.log(JSON.stringify({ ok: true, loadingSamples: loadingSamples.length, finalRows }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
