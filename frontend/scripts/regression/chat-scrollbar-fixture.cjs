#!/usr/bin/env node
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.CHAT_SCROLLBAR_FIXTURE_BASE_URL || "http://127.0.0.1:3000";

const scrollerSelector = '[data-testid="chat-history-scroll-container"]';

async function readMetrics(page) {
  return page.evaluate((scrollerSelector) => {
    const scroller = document.querySelector(scrollerSelector);
    const layer = document.querySelector('[data-testid="chat-scroll-progress-layer"]');
    const track = document.querySelector('[data-testid="chat-scroll-progress-track"]');
    const thumb = document.querySelector('[data-testid="chat-scroll-progress-thumb"]');
    if (!scroller) throw new Error("chat scroller not found");
    if (!layer || !track || !thumb) throw new Error("chat scroll progress overlay not found");

    const scrollerRect = scroller.getBoundingClientRect();
    const layerRect = layer.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    const thumbRect = thumb.getBoundingClientRect();
    const scrollerStyle = getComputedStyle(scroller);
    const nativeScrollbar = getComputedStyle(scroller, "::-webkit-scrollbar");
    const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;

    return {
      viewportHeight: window.innerHeight,
      scrollerRect: { x: scrollerRect.x, y: scrollerRect.y, width: scrollerRect.width, height: scrollerRect.height, right: scrollerRect.right, bottom: scrollerRect.bottom },
      layerRect: { x: layerRect.x, y: layerRect.y, width: layerRect.width, height: layerRect.height, right: layerRect.right, bottom: layerRect.bottom },
      trackRect: { x: trackRect.x, y: trackRect.y, width: trackRect.width, height: trackRect.height, right: trackRect.right, bottom: trackRect.bottom },
      thumbRect: { x: thumbRect.x, y: thumbRect.y, width: thumbRect.width, height: thumbRect.height, right: thumbRect.right, bottom: thumbRect.bottom },
      layerZIndex: getComputedStyle(layer).zIndex,
      expectedInputZIndex: "70",
      scrollerScrollbarWidth: nativeScrollbar.width,
      scrollerFirefoxScrollbarWidth: scrollerStyle.scrollbarWidth,
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      maxScrollTop,
      ratio: maxScrollTop > 0 ? scroller.scrollTop / maxScrollTop : 0,
      overlayValueNow: track.getAttribute("aria-valuenow"),
      overflowY: scrollerStyle.overflowY,
    };
  }, scrollerSelector);
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
    await page.goto(`${baseUrl}/test-chat-user-content/`, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForSelector('[data-testid="chat-user-content-fixture"]', { timeout: 20_000 });
    await page.waitForSelector('[data-testid="chat-scroll-progress-track"]', { timeout: 10_000 });

    const initial = await readMetrics(page);
    assert.equal(initial.overflowY, "auto", "chat scroller should own vertical scrolling");
    assert.ok(initial.maxScrollTop > 0, "fixture should be vertically scrollable");
    assert.equal(initial.scrollerFirefoxScrollbarWidth, "none", "native chat scrollbar should be hidden in Firefox-compatible CSS");
    assert.ok(parseFloat(initial.scrollerScrollbarWidth) <= 1, `native WebKit scrollbar should be hidden, got ${initial.scrollerScrollbarWidth}`);
    assert.ok(Number(initial.layerZIndex) > Number(initial.expectedInputZIndex), `overlay z-index ${initial.layerZIndex} should be above input z-index ${initial.expectedInputZIndex}`);
    assert.ok(Math.abs(initial.trackRect.y - initial.scrollerRect.y) < 2, `progress track should align to chat body top: track ${initial.trackRect.y}, scroller ${initial.scrollerRect.y}`);
    assert.ok(Math.abs(initial.trackRect.bottom - initial.scrollerRect.bottom) < 2, `progress track should align to chat body bottom: track ${initial.trackRect.bottom}, scroller ${initial.scrollerRect.bottom}`);
    assert.ok(Math.abs(initial.trackRect.height - initial.scrollerRect.height) < 2, `progress track height should equal chat body height: track ${initial.trackRect.height}, scroller ${initial.scrollerRect.height}`);

    await page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="chat-history-scroll-container"]');
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await page.waitForTimeout(120);
    const top = await readMetrics(page);
    assert.ok(top.scrollTop <= 2, `expected scrollTop near top, got ${top.scrollTop}`);
    assert.ok(Number(top.overlayValueNow) <= 5, `overlay should report near top, got ${top.overlayValueNow}`);

    const trackBoxBeforeDrag = await page.locator('[data-testid="chat-scroll-progress-track"]').boundingBox();
    assert.ok(trackBoxBeforeDrag, "track bounding box should exist");
    await page.mouse.move(trackBoxBeforeDrag.x + trackBoxBeforeDrag.width / 2, trackBoxBeforeDrag.y + trackBoxBeforeDrag.height * 0.15);
    await page.mouse.down();
    await page.mouse.move(trackBoxBeforeDrag.x + trackBoxBeforeDrag.width / 2, trackBoxBeforeDrag.y + trackBoxBeforeDrag.height * 0.82, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(180);
    const dragged = await readMetrics(page);
    assert.ok(dragged.ratio > 0.65, `dragging overlay should move chat scroll progress, got ratio ${dragged.ratio}`);
    assert.ok(Number(dragged.overlayValueNow) > 60, `overlay aria value should follow drag, got ${dragged.overlayValueNow}`);

    const stableBefore = await readMetrics(page);
    await page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="chat-history-scroll-container"]');
      scroller.scrollTop = scroller.scrollTop + 40;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await page.waitForTimeout(160);
    const stableAfter = await readMetrics(page);
    assert.ok(Math.abs(stableAfter.trackRect.y - stableBefore.trackRect.y) < 1, "overlay track top should not jump when content scrolls");
    assert.ok(Math.abs(stableAfter.trackRect.bottom - stableBefore.trackRect.bottom) < 1, "overlay track bottom should not jump when content scrolls");

    if (failures.length > 0) {
      throw new Error(failures.join("\n"));
    }

    console.log(JSON.stringify({
      ok: true,
      overlayZIndex: initial.layerZIndex,
      expectedInputZIndex: initial.expectedInputZIndex,
      trackBottom: initial.trackRect.bottom,
      scrollerTop: initial.scrollerRect.y,
      scrollerBottom: initial.scrollerRect.bottom,
      draggedRatio: dragged.ratio,
      stableTrackTopDelta: Math.abs(stableAfter.trackRect.y - stableBefore.trackRect.y),
    }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
