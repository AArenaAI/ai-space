#!/usr/bin/env node
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.TEXT_SELECTION_FIXTURE_BASE_URL || "http://127.0.0.1:3000";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("favicon")) errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  try {
    const url = `${baseUrl}/test-chat-text-selection/`;
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    assert.ok(response && response.status() < 400, `unexpected status ${response?.status()} for ${url}`);

    await page.waitForSelector('[data-chat-message-row="true"]', { state: "attached", timeout: 20_000 });
    await page.waitForFunction(() => document.body.innerText.includes("用于验证引用插入输入框"), { timeout: 20_000 });

    const selectedText = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const text = node.textContent || "";
        const match = text.match(/这是第 1 轮用户消息/);
        if (match?.index !== undefined) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          document.dispatchEvent(new Event("selectionchange"));
          return match[0];
        }
        node = walker.nextNode();
      }
      throw new Error("target text node not found");
    });

    const bar = page.locator('[data-testid="chat-text-selection-bar"]');
    await bar.waitFor({ state: "visible", timeout: 10_000 });
    await page.locator('[data-testid="chat-text-selection-copy-quote"]').click();
    const textarea = page.locator('textarea').first();
    await textarea.waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForFunction((expected) => {
      const textarea = document.querySelector("textarea");
      return textarea instanceof HTMLTextAreaElement && textarea.value === `> ${expected}\n\n`;
    }, selectedText, { timeout: 10_000 });
    const inputValue = await textarea.inputValue();
    await bar.waitFor({ state: "detached", timeout: 10_000 });
    assert.equal(errors.length, 0, `unexpected console/page errors: ${errors.slice(0, 3).join(" | ")}`);
    console.log(JSON.stringify({ ok: true, inputValue }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
