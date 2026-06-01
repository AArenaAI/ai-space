#!/usr/bin/env node
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.CHAT_USER_CONTENT_FIXTURE_BASE_URL || "http://127.0.0.1:3000";

async function scrollChat(page, position) {
  await page.evaluate((pos) => {
    const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
    if (!scroller) throw new Error("virtuoso scroller not found");
    scroller.scrollTop = pos === "top" ? 0 : scroller.scrollHeight;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, position);
  await page.waitForTimeout(500);
}

async function scrollUntilUserMessageText(page, text) {
  for (const ratio of [0, 0.25, 0.5, 0.7, 0.85, 1]) {
    await page.evaluate((nextRatio) => {
      const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
      if (!scroller) throw new Error("virtuoso scroller not found");
      scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * nextRatio;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    }, ratio);
    await page.waitForTimeout(500);
    const visibleInMessage = await page.evaluate((needle) => {
      const rows = [...document.querySelectorAll('[data-chat-message-row="true"][data-message-role="user"]')];
      return rows.some((row) => row.textContent?.includes(needle));
    }, text);
    if (visibleInMessage) return;
  }
  throw new Error(`user message text not found after scrolling: ${text}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("favicon")) errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  try {
    const url = `${baseUrl}/test-chat-user-content/`;
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    assert.ok(response && response.status() < 400, `unexpected status ${response?.status()} for ${url}`);
    await page.waitForSelector('[data-testid="chat-user-content-fixture"]', { timeout: 20_000 });
    await page.waitForSelector('[data-chat-message-row="true"]', { timeout: 20_000 });

    await scrollChat(page, "top");
    await page.waitForFunction(() => document.body.innerText.includes("需求说明.txt"), { timeout: 10_000 });
    const fileChips = page.locator('[data-testid="user-message-file-chip"]');
    const fileChipCount = await fileChips.count();
    await assert.equal(fileChipCount, 2, "expected two user file chips");
    await assert.match(await fileChips.nth(0).innerText(), /需求说明\.txt/);
    await assert.match(await fileChips.nth(1).innerText(), /长文档报告\.pdf/);

    const longCodeBlock = page.locator('[data-testid="markdown-code-block"]').first();
    await longCodeBlock.waitFor({ state: "visible", timeout: 10_000 });
    await assert.match(await longCodeBlock.innerText(), /代码块较长，已折叠/);
    await assert.match(await longCodeBlock.innerText(), /150 行/);
    await assert.equal(await longCodeBlock.locator('text=long code line 150').count(), 0, "long code should be collapsed initially");
    await longCodeBlock.getByRole('button', { name: /代码块较长|展开|收起/ }).click();
    await page.waitForSelector('text=long code line 150', { timeout: 10_000 });

    await scrollUntilUserMessageText(page, "请基于这段引用继续解释");
    const quoteCard = page.locator('[data-testid="user-message-quote-card"]');
    await quoteCard.waitFor({ state: "visible", timeout: 10_000 });
    const quoteText = await quoteCard.innerText();
    await assert.match(quoteText, /引用文本/);
    await assert.match(quoteText, /这是第 1 轮用户消息/);
    await assert.match(await page.locator('[data-testid="user-message-text"]').filter({ hasText: "请基于这段引用继续解释" }).innerText(), /请基于这段引用继续解释/);

    await scrollChat(page, "bottom");
    await page.waitForFunction(() => document.body.innerText.includes("展开完整消息"), { timeout: 10_000 });
    const longToggle = page.locator('[data-testid="user-message-collapse-toggle"]');
    await longToggle.waitFor({ state: "visible", timeout: 10_000 });
    await assert.match(await longToggle.innerText(), /展开完整消息/);
    await assert.equal(await page.locator('text=这是用户长消息第 36 行').count(), 0, "long user message should be collapsed initially");
    await longToggle.click();
    await page.waitForSelector('text=这是用户长消息第 36 行', { timeout: 10_000 });
    await assert.match(await longToggle.innerText(), /收起长消息/);

    assert.equal(errors.length, 0, `unexpected console/page errors: ${errors.slice(0, 3).join(" | ")}`);
    console.log(JSON.stringify({ ok: true, fileChips: fileChipCount, quote: true, longUser: true, longCode: true }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
