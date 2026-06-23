#!/usr/bin/env node
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.SCROLL_FIXTURE_BASE_URL || "http://127.0.0.1:3000";
const scrollerSelector = '[data-testid="chat-history-scroll-container"], [data-virtuoso-scroller]';

async function getScrollState(page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="chat-history-scroll-container"], [data-virtuoso-scroller]');
    if (!(scroller instanceof HTMLElement)) {
      return { found: false, scrollTop: 0, scrollHeight: 0, clientHeight: 0, distanceToBottom: 0 };
    }
    return {
      found: true,
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      distanceToBottom: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
    };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (text.includes("Text content did not match") || text.includes("hydration")) return;
      errors.push(text);
    }
  });
  page.on("pageerror", (err) => {
    if (err.message.includes("hydrating") || err.message.includes("server-rendered HTML") || err.message.includes("Text content does not match")) return;
    errors.push(err.message);
  });

  try {
    const url = `${baseUrl}/test-chat-performance/?mode=stream&count=120&deltas=120&deltaInterval=20&hasMore=0`;
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    assert.ok(response && response.status() < 400, `unexpected status ${response?.status()} for ${url}`);
    await page.waitForSelector('[data-testid="chat-performance-fixture"]', { state: "attached", timeout: 20_000 });
    const scroller = page.locator(scrollerSelector).first();
    await scroller.waitFor({ state: "attached", timeout: 20_000 });

    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="chat-history-scroll-container"], [data-virtuoso-scroller]');
      return el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 200;
    }, { timeout: 20_000 });

    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(120);

    const beforeWheel = await getScrollState(page);
    assert.equal(beforeWheel.found, true, "expected chat history scroller");
    assert.ok(beforeWheel.distanceToBottom <= 32, `expected near bottom before wheel, got ${beforeWheel.distanceToBottom}`);

    await scroller.evaluate((el) => {
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: -240, bubbles: true, cancelable: true }));
      el.scrollTop = Math.max(0, el.scrollTop - 240);
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await page.waitForTimeout(180);
    const afterWheel = await getScrollState(page);
    assert.ok(afterWheel.distanceToBottom > 40, `expected manual upward scroll to leave bottom, got ${afterWheel.distanceToBottom}`);

    await page.waitForTimeout(900);
    const duringStream = await getScrollState(page);
    assert.ok(
      duringStream.distanceToBottom > 40,
      `expected streaming not to snap back to bottom after manual browse, got ${JSON.stringify(duringStream)}`
    );

    await page.waitForFunction(() => {
      const node = document.querySelector('[data-testid="chat-stream-render-metrics"]');
      return node instanceof HTMLElement && !!node.getAttribute("data-metrics");
    }, { timeout: 45_000 }).catch(() => undefined);
    assert.equal(errors.length, 0, `unexpected console/page errors: ${errors.slice(0, 3).join(" | ")}`);
    console.log(JSON.stringify({ ok: true, afterWheel, duringStream }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
