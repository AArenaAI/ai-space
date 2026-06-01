#!/usr/bin/env node
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.CHAT_MESSAGE_OVERVIEW_FIXTURE_BASE_URL || "http://127.0.0.1:3000";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console error: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));

  try {
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    const response = await page.goto(`${baseUrl}/test-chat-message-overview/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    assert.ok(response && response.status() < 400, `unexpected status ${response?.status()}`);
    await page.waitForSelector('[data-testid="chat-message-overview-fixture"]', { timeout: 20_000 });
    await page.waitForSelector('[data-testid="virtuoso-scroller"]', { state: "attached", timeout: 20_000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-chat-message-row="true"]').length > 0, null, { timeout: 20_000 });
    await page.waitForSelector('[data-testid="chat-message-overview"]', { timeout: 20_000 });

    const compact = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="chat-message-overview-panel"]');
      const labels = [...document.querySelectorAll('[data-testid="chat-message-overview-item"] span:first-child')];
      const rect = panel?.getBoundingClientRect();
      return {
        width: rect?.width ?? 0,
        labelVisibleCount: labels.filter((el) => getComputedStyle(el).display !== "none").length,
        itemCount: document.querySelectorAll('[data-testid="chat-message-overview-item"]').length,
      };
    });
    assert.ok(compact.itemCount >= 4, `overview should include user message markers, got ${compact.itemCount}`);
    assert.ok(compact.width <= 72, `compact overview should be narrow, got ${compact.width}`);
    assert.equal(compact.labelVisibleCount, 0, "compact overview should hide labels before hover");

    await page.hover('[data-testid="chat-message-overview-panel"]');
    await page.waitForTimeout(260);
    const expanded = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="chat-message-overview-panel"]');
      const labels = [...document.querySelectorAll('[data-testid="chat-message-overview-item"] span:first-child')];
      const rect = panel?.getBoundingClientRect();
      return {
        width: rect?.width ?? 0,
        labelVisibleCount: labels.filter((el) => getComputedStyle(el).display !== "none").length,
        text: document.querySelector('[data-testid="chat-message-overview-panel"]')?.textContent || "",
      };
    });
    assert.ok(expanded.width >= 220, `hover overview should expand, got ${expanded.width}`);
    assert.ok(expanded.labelVisibleCount >= 4, `hover overview should show labels, got ${expanded.labelVisibleCount}`);
    assert.ok(expanded.text.includes("dydx chain") || expanded.text.includes("dydx"), "hover overview should show user message summaries");

    const targetId = "overview-user-2";
    await page.click(`[data-testid="chat-message-overview-item"][data-message-id="${targetId}"]`);
    await page.waitForTimeout(450);
    const jumped = await page.evaluate((id) => {
      const row = document.querySelector(`[data-message-id="${id}"]`);
      const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
      const rect = row?.getBoundingClientRect();
      const scrollerRect = scroller?.getBoundingClientRect();
      return {
        found: Boolean(row),
        top: rect?.top ?? -1,
        bottom: rect?.bottom ?? -1,
        scrollerTop: scrollerRect?.top ?? 0,
        scrollerBottom: scrollerRect?.bottom ?? 0,
        highlighted: row?.className.includes("bg-brand/10") ?? false,
      };
    }, targetId);
    assert.ok(jumped.found, "clicked overview target should be rendered");
    assert.ok(jumped.top >= jumped.scrollerTop && jumped.bottom <= jumped.scrollerBottom, `clicked target should be in viewport: ${JSON.stringify(jumped)}`);
    assert.ok(jumped.highlighted, "clicked target should be highlighted");

    if (failures.length > 0) throw new Error(failures.join("\n"));
    console.log(JSON.stringify({ ok: true, compact, expandedWidth: expanded.width, jumped }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
