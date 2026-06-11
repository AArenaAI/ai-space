#!/usr/bin/env node
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.CHAT_LOAD_MORE_HISTORY_FIXTURE_BASE_URL || "http://127.0.0.1:3000";

async function readMarker(page, markerId) {
  return page.evaluate((id) => {
    const marker = document.querySelector(`[data-message-id="${id}"]`);
    const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
    const rows = document.querySelectorAll('[data-chat-message-row="true"]').length;
    const fixture = document.querySelector('[data-testid="chat-load-more-history-fixture"]');
    if (!marker || !scroller) return { found: false, rows, scrollTop: scroller?.scrollTop ?? -1, loadedPages: Number(fixture?.getAttribute("data-loaded-pages") || "0") };
    const rect = marker.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    return {
      found: true,
      markerId: id,
      rows,
      top: rect.top,
      bottom: rect.bottom,
      visibleTop: Math.max(rect.top, scrollerRect.top),
      visibleBottom: Math.min(rect.bottom, scrollerRect.bottom),
      scrollerTop: scrollerRect.top,
      scrollerBottom: scrollerRect.bottom,
      intersectsScroller: rect.bottom >= scrollerRect.top + 8 && rect.top <= scrollerRect.bottom - 8,
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      loadedOlder: fixture?.getAttribute("data-loaded-older") === "true",
      loadedPages: Number(fixture?.getAttribute("data-loaded-pages") || "0"),
      bodyText: document.body.innerText.slice(0, 400),
    };
  }, markerId);
}

async function readFirstVisibleMarkerId(page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
    const scrollerRect = scroller?.getBoundingClientRect();
    if (!scrollerRect) return null;
    return Array.from(document.querySelectorAll('[data-chat-message-row="true"]'))
      .find((row) => {
        const rect = row.getBoundingClientRect();
        return rect.bottom >= scrollerRect.top + 8 && rect.top <= scrollerRect.bottom - 8;
      })
      ?.getAttribute("data-message-id") || null;
  });
}

async function readWindowState(page) {
  return page.evaluate(() => {
    const list = document.querySelector('[data-testid="chat-message-list"]');
    const fixture = document.querySelector('[data-testid="chat-load-more-history-fixture"]');
    const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
    return {
      visibleMessageCount: Number(list?.getAttribute("data-visible-message-count") || "0"),
      allVisibleMessageCount: Number(list?.getAttribute("data-all-visible-message-count") || "0"),
      hiddenLocalMessageCount: Number(list?.getAttribute("data-hidden-local-message-count") || "0"),
      loadedPages: Number(fixture?.getAttribute("data-loaded-pages") || "0"),
      loadingMore: fixture?.getAttribute("data-loading-more") === "true",
      rowCount: document.querySelectorAll('[data-chat-message-row="true"]').length,
      scrollTop: scroller?.scrollTop ?? 0,
      scrollHeight: scroller?.scrollHeight ?? 0,
      clientHeight: scroller?.clientHeight ?? 0,
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
    const url = `${baseUrl}/test-chat-load-more-history/?currentTurns=24&olderTurns=10&pages=2&lines=14&delay=180`;
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    assert.ok(response && response.status() < 400, `unexpected status ${response?.status()}`);
    await page.waitForSelector('[data-testid="chat-load-more-history-fixture"]', { state: "attached", timeout: 20_000 });
    await page.waitForSelector('[data-testid="virtuoso-scroller"]', { state: "attached", timeout: 20_000 });
    await page.waitForFunction(() => {
      const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
      const rect = scroller?.getBoundingClientRect();
      return rect && rect.width > 0 && rect.height > 0;
    }, null, { timeout: 20_000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-chat-message-row="true"]').length > 0, null, { timeout: 20_000 });

    const initialWindow = await readWindowState(page);
    assert.ok(initialWindow.visibleMessageCount > 0, `initial window should render messages: ${JSON.stringify(initialWindow)}`);
    assert.ok(initialWindow.hiddenLocalMessageCount > 0, `fixture should start with hidden local messages: ${JSON.stringify(initialWindow)}`);

    await page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
      if (!scroller) throw new Error("missing scroller");
      scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - 2600);
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await page.waitForTimeout(80);
    const scrollerBox = await page.locator('[data-testid="virtuoso-scroller"]').boundingBox();
    assert.ok(scrollerBox, "fixture scroller should have a bounding box before wheel scroll");
    await page.mouse.move(scrollerBox.x + scrollerBox.width / 2, scrollerBox.y + scrollerBox.height / 2);
    for (let i = 0; i < 80; i += 1) {
      const state = await page.evaluate(() => {
        const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
        const fixture = document.querySelector('[data-testid="chat-load-more-history-fixture"]');
        return {
          scrollTop: scroller?.scrollTop ?? 0,
          loadedPages: Number(fixture?.getAttribute("data-loaded-pages") || "0"),
          loadingMore: fixture?.getAttribute("data-loading-more") === "true",
        };
      });
      if (state.scrollTop <= 4 || state.loadedPages >= 1 || state.loadingMore) break;
      await page.mouse.wheel(0, -1000);
      await page.waitForTimeout(60);
    }

    const markerId = await readFirstVisibleMarkerId(page);
    assert.ok(markerId, "fixture should have a visible marker row at the top before prepend");
    const before = await readMarker(page, markerId);
    assert.ok(before.found, "marker should be visible before load more");
    assert.ok(before.visibleBottom > before.scrollerTop && before.visibleTop < before.scrollerBottom, `marker should intersect the scroller before load more: ${JSON.stringify(before)}`);
    assert.ok(before.visibleTop >= before.scrollerTop - 4 && before.visibleTop < before.scrollerTop + 260, `marker visible edge should be near top before load more, got ${before.visibleTop} in scroller ${before.scrollerTop}`);

    const samples = [];
    const deadline = Date.now() + 1200;
    while (Date.now() < deadline) {
      samples.push(await readMarker(page, markerId));
      await page.waitForTimeout(40);
    }
    await page.waitForFunction((previousVisibleCount) => {
      const list = document.querySelector('[data-testid="chat-message-list"]');
      return Number(list?.getAttribute("data-visible-message-count") || "0") > previousVisibleCount;
    }, initialWindow.visibleMessageCount, { timeout: 5_000 });
    await page.waitForTimeout(260);
    const after = await readMarker(page, markerId);
    const afterWindow = await readWindowState(page);

    assert.ok(after.found, "marker should still be rendered after releasing local hidden history");
    assert.equal(afterWindow.loadedPages, 0, "first top reach should release local hidden messages before requesting remote older pages");
    assert.ok(afterWindow.visibleMessageCount > initialWindow.visibleMessageCount, `local window should expand after top reach: before ${JSON.stringify(initialWindow)}, after ${JSON.stringify(afterWindow)}`);
    assert.ok(afterWindow.visibleMessageCount <= initialWindow.visibleMessageCount + 8, `local window should expand by at most 8 messages, before ${initialWindow.visibleMessageCount}, after ${afterWindow.visibleMessageCount}`);
    assert.ok(afterWindow.hiddenLocalMessageCount < initialWindow.hiddenLocalMessageCount, `hidden local messages should shrink after local release: before ${JSON.stringify(initialWindow)}, after ${JSON.stringify(afterWindow)}`);
    assert.ok(after.scrollHeight > before.scrollHeight, `released local history should increase scroll height: before ${before.scrollHeight}, after ${after.scrollHeight}`);
    const topDelta = Math.abs(after.visibleTop - before.visibleTop);
    assert.ok(topDelta < 32, `marker should remain visually anchored after load more, moved ${topDelta}px (before ${before.visibleTop}, after ${after.visibleTop})`);
    const blankSamples = samples.filter((sample) => sample.rows === 0 || (typeof sample.bodyText === "string" && sample.bodyText.length < 100));
    assert.equal(blankSamples.length, 0, `load-more should not produce blank message-list samples: ${JSON.stringify(blankSamples)}`);
    const missingMarkerSamples = samples.filter((sample) => !sample.found);
    assert.ok(missingMarkerSamples.length <= 2, `load-more should not repeatedly unmount the anchor marker: ${JSON.stringify(missingMarkerSamples.slice(0, 6))}`);
    const jumpSamples = samples.filter((sample) => sample.found && sample.intersectsScroller && Math.abs(sample.visibleTop - before.visibleTop) > 96);
    assert.equal(jumpSamples.length, 0, `load-more should not visibly jump/stick marker samples: ${JSON.stringify(jumpSamples.slice(0, 6))}`);

    if (failures.length > 0) throw new Error(failures.join("\n"));
    console.log(JSON.stringify({ ok: true, beforeTop: before.visibleTop, afterTop: after.visibleTop, topDelta, beforeRows: before.rows, afterRows: after.rows, initialWindow, afterWindow }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
