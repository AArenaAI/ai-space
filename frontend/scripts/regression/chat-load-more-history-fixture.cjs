#!/usr/bin/env node
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.CHAT_LOAD_MORE_HISTORY_FIXTURE_BASE_URL || "http://127.0.0.1:3000";

async function readMarker(page, markerId) {
  return page.evaluate((id) => {
    const marker = document.querySelector(`[data-message-id="${id}"]`);
    const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
    const rows = document.querySelectorAll('[data-chat-message-row="true"]').length;
    if (!marker || !scroller) return { found: false, rows, scrollTop: scroller?.scrollTop ?? -1 };
    const rect = marker.getBoundingClientRect();
    return {
      found: true,
      markerId: id,
      rows,
      top: rect.top,
      bottom: rect.bottom,
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      loadedOlder: document.querySelector('[data-testid="chat-load-more-history-fixture"]')?.getAttribute("data-loaded-older") === "true",
      bodyText: document.body.innerText.slice(0, 400),
    };
  }, markerId);
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
    const response = await page.goto(`${baseUrl}/test-chat-load-more-history/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    assert.ok(response && response.status() < 400, `unexpected status ${response?.status()}`);
    await page.waitForSelector('[data-testid="chat-load-more-history-fixture"]', { timeout: 20_000 });
    await page.waitForSelector('[data-testid="virtuoso-scroller"]', { state: "attached", timeout: 20_000 });
    await page.waitForFunction(() => {
      const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
      const rect = scroller?.getBoundingClientRect();
      return rect && rect.width > 0 && rect.height > 0;
    }, null, { timeout: 20_000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-chat-message-row="true"]').length > 0, null, { timeout: 20_000 });
    await page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
      if (!scroller) throw new Error("missing scroller");
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await page.waitForTimeout(80);

    const markerId = await page.evaluate(() => document.querySelector('[data-chat-message-row="true"]')?.getAttribute("data-message-id"));
    assert.ok(markerId, "fixture should have a visible marker row at the top before prepend");
    const before = await readMarker(page, markerId);
    assert.ok(before.found, "marker should be visible before load more");
    assert.ok(before.top >= 20 && before.top < 260, `marker should be near top before load more, got ${before.top}`);

    const samples = [];
    const deadline = Date.now() + 900;
    while (Date.now() < deadline) {
      samples.push(await readMarker(page, markerId));
      await page.waitForTimeout(50);
    }
    await page.waitForFunction(() => document.querySelector('[data-testid="chat-load-more-history-fixture"]')?.getAttribute("data-loaded-older") === "true", null, { timeout: 5_000 });
    await page.waitForTimeout(220);
    const after = await readMarker(page, markerId);

    assert.ok(after.found, "marker should still be rendered after prepending older history");
    assert.ok(after.rows > before.rows, `older history should be prepended: before ${before.rows}, after ${after.rows}`);
    const topDelta = Math.abs(after.top - before.top);
    assert.ok(topDelta < 32, `marker should remain visually anchored after load more, moved ${topDelta}px (before ${before.top}, after ${after.top})`);
    const blankSamples = samples.filter((sample) => !sample.found || sample.rows === 0);
    assert.equal(blankSamples.length, 0, `load-more should not produce blank/missing marker samples: ${JSON.stringify(blankSamples)}`);

    if (failures.length > 0) throw new Error(failures.join("\n"));
    console.log(JSON.stringify({ ok: true, beforeTop: before.top, afterTop: after.top, topDelta, beforeRows: before.rows, afterRows: after.rows }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
