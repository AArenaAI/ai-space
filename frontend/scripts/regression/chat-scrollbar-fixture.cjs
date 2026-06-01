#!/usr/bin/env node
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.CHAT_SCROLLBAR_FIXTURE_BASE_URL || "http://127.0.0.1:3000";

async function readMetrics(page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
    if (!scroller) throw new Error("virtuoso scroller not found");
    const rect = scroller.getBoundingClientRect();
    const scrollbar = getComputedStyle(scroller, "::-webkit-scrollbar");
    const thumb = getComputedStyle(scroller, "::-webkit-scrollbar-thumb");
    const track = getComputedStyle(scroller, "::-webkit-scrollbar-track");
    const style = getComputedStyle(scroller);
    const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
    return {
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right },
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      maxScrollTop,
      ratio: maxScrollTop > 0 ? scroller.scrollTop / maxScrollTop : 0,
      overflowY: style.overflowY,
      scrollbarWidth: scrollbar.width,
      scrollbarHeight: scrollbar.height,
      thumbBackground: thumb.backgroundColor,
      trackBackground: track.backgroundColor,
      firefoxScrollbarWidth: style.scrollbarWidth,
      firefoxScrollbarColor: style.scrollbarColor,
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
    await page.goto(`${baseUrl}/test-chat-user-content/`, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForSelector('[data-testid="chat-user-content-fixture"]', { timeout: 20_000 });
    await page.waitForSelector('[data-testid="virtuoso-scroller"]', { timeout: 10_000 });

    const initial = await readMetrics(page);
    assert.equal(initial.overflowY, "auto", "chat scroller should own vertical scrolling");
    assert.ok(initial.maxScrollTop > 0, "fixture should be vertically scrollable");
    assert.notEqual(initial.scrollbarWidth, "5px", "chat scrollbar should not inherit the 5px global minimal scrollbar");
    assert.ok(parseFloat(initial.scrollbarWidth) >= 10, `chat scrollbar hit area should be at least 10px, got ${initial.scrollbarWidth}`);
    assert.match(initial.thumbBackground, /rgba?\(/, "thumb should have an explicit background color");
    assert.notEqual(initial.thumbBackground, "rgba(107, 138, 109, 0.3)", "green theme thumb should not use the low-contrast global scrollbar color");

    await page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
      scroller.scrollTop = 0;
    });
    await page.waitForTimeout(100);
    const top = await readMetrics(page);
    assert.ok(top.scrollTop <= 2, `expected scrollTop near top, got ${top.scrollTop}`);

    await page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
      scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
    });
    await page.waitForTimeout(150);
    const bottom = await readMetrics(page);
    assert.ok(bottom.ratio > 0.95, `expected ratio near bottom, got ${bottom.ratio}`);

    if (failures.length > 0) {
      throw new Error(failures.join("\n"));
    }

    console.log(JSON.stringify({
      ok: true,
      scrollbarWidth: initial.scrollbarWidth,
      thumbBackground: initial.thumbBackground,
      trackBackground: initial.trackBackground,
      bottomRatio: bottom.ratio,
    }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
