#!/usr/bin/env node
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.CHAT_ROW_MEMO_FIXTURE_BASE_URL || "http://127.0.0.1:3000";

async function readCounts(page) {
  return page.evaluate(() => {
    const fixture = document.querySelector('[data-testid="chat-row-memo-fixture"]');
    return {
      tick: Number(fixture?.getAttribute("data-unrelated-tick") || 0),
      longRowCommits: Number(fixture?.getAttribute("data-long-row-commits") || 0),
      rowCommits: Number(fixture?.getAttribute("data-row-commits") || 0),
      listCommits: Number(fixture?.getAttribute("data-list-commits") || 0),
      longRowPresent: Boolean(document.querySelector('[data-message-id="row-memo-long-assistant"]')),
      shortRowPresent: Boolean(document.querySelector('[data-message-id="row-memo-short-assistant"]')),
    };
  });
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
    const response = await page.goto(`${baseUrl}/test-chat-row-memo/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    assert.ok(response && response.status() < 400, `unexpected status ${response?.status()}`);
    await page.waitForSelector('[data-testid="chat-row-memo-fixture"]', { state: "attached", timeout: 20_000 });
    await page.waitForSelector('[data-message-id="row-memo-long-assistant"]', { state: "attached", timeout: 20_000 });
    await page.waitForSelector('[data-message-id="row-memo-short-assistant"]', { state: "attached", timeout: 20_000 });
    await page.waitForTimeout(700);

    await page.locator('[data-testid="row-memo-reset-events"]').evaluate((button) => button.click());
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="chat-row-memo-fixture"]')?.getAttribute("data-row-commits") || 0) === 0, null, { timeout: 10_000 });
    const baseline = await readCounts(page);
    assert.equal(baseline.longRowCommits, 0, "reset should clear long-row commit events");

    await page.locator('[data-testid="row-memo-unrelated-rerender"]').click();
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="chat-row-memo-fixture"]')?.getAttribute("data-unrelated-tick") || 0) === 1, null, { timeout: 10_000 });
    await page.waitForTimeout(250);
    const afterOne = await readCounts(page);
    assert.equal(afterOne.longRowCommits, 0, `unrelated parent rerender should not re-render long assistant row once: ${JSON.stringify(afterOne)}`);

    for (let i = 0; i < 5; i += 1) {
      await page.locator('[data-testid="row-memo-unrelated-rerender"]').click();
    }
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="chat-row-memo-fixture"]')?.getAttribute("data-unrelated-tick") || 0) === 6, null, { timeout: 10_000 });
    await page.waitForTimeout(350);
    const afterMany = await readCounts(page);
    assert.equal(afterMany.longRowCommits, 0, `unrelated repeated parent rerenders should not re-render long assistant row: ${JSON.stringify(afterMany)}`);
    assert.ok(afterMany.longRowPresent, "long row should remain rendered");
    assert.ok(afterMany.shortRowPresent, "short row should remain rendered");

    if (failures.length > 0) throw new Error(failures.join("\n"));
    console.log(JSON.stringify({ ok: true, baseline, afterOne, afterMany }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
