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

async function assertAssistantCodeAnswerStableWhileScrolling(page) {
  const samples = [];
  const scrollerBox = await page.locator('[data-testid="virtuoso-scroller"]').boundingBox();
  if (!scrollerBox) throw new Error("virtuoso scroller box not found");
  await page.mouse.move(scrollerBox.x + scrollerBox.width / 2, scrollerBox.y + scrollerBox.height / 2);

  for (let step = 0; step < 80; step += 1) {
    if (step % 8 === 0) await page.mouse.wheel(0, step < 40 ? -600 : 900);
    await page.waitForTimeout(45);
    samples.push(await page.evaluate(() => {
      const row = document.querySelector('[data-chat-message-row="true"][data-message-id="assistant-code"]');
      const rect = row?.getBoundingClientRect();
      return {
        height: rect?.height || 0,
        hasAnswerText: Boolean(row?.textContent?.includes("下面是一个长代码块")) || Boolean(row?.querySelector('[data-testid="markdown-code-block"]')),
        answerFallbackCount: [...(row?.querySelectorAll('[data-markdown-plain-fallback]') || [])].filter((el) => !el.closest('.reasoning-markdown')).length,
        codeBlockCount: row?.querySelectorAll('[data-testid="markdown-code-block"]').length || 0,
      };
    }));
  }

  const missingAnswer = samples.filter((sample) => !sample.hasAnswerText);
  await assert.equal(missingAnswer.length, 0, `assistant answer should not disappear while scrolling: ${JSON.stringify(missingAnswer.slice(0, 3))}`);
  for (let index = 1; index < samples.length; index += 1) {
    const drop = samples[index - 1].height - samples[index].height;
    await assert.ok(drop <= 120, `assistant-code row should not shrink abruptly while renderer loads: ${JSON.stringify({ previous: samples[index - 1], next: samples[index], drop })}`);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("favicon")) errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  try {
    const url = `${baseUrl}/test-chat-user-content/`;
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    assert.ok(response && response.status() < 400, `unexpected status ${response?.status()} for ${url}`);
    await page.waitForSelector('[data-testid="chat-user-content-fixture"]', { state: "attached", timeout: 20_000 });
    await page.waitForSelector('[data-chat-message-row="true"]', { state: "attached", timeout: 20_000 });

    await scrollChat(page, "top");
    await page.waitForFunction(() => document.body.innerText.includes("需求说明.txt"), { timeout: 10_000 });
    const fileChips = page.locator('[data-testid="user-message-file-chip"]');
    const fileChipCount = await fileChips.count();
    await assert.equal(fileChipCount, 2, "expected two user file chips");
    await assert.match(await fileChips.nth(0).innerText(), /需求说明\.txt/);
    await assert.match(await fileChips.nth(1).innerText(), /长文档报告\.pdf/);

    const initialAssistantCodeRowHeight = await page.evaluate(() => document.querySelector('[data-chat-message-row="true"][data-message-id="assistant-code"]')?.getBoundingClientRect().height || 0);
    await assert.ok(initialAssistantCodeRowHeight < 1600, `historical long markdown fallback should not create a giant row before rich markdown loads: ${initialAssistantCodeRowHeight}`);

    const longCodeBlock = page.locator('[data-testid="markdown-code-block"]').first();
    await longCodeBlock.waitFor({ state: "visible", timeout: 10_000 });
    await assert.match(await longCodeBlock.innerText(), /代码块较长，已折叠/);
    await assert.match(await longCodeBlock.innerText(), /150 行 \/ 5\.1k 字符/);
    await assert.equal(await longCodeBlock.locator('text=long code line 150').count(), 0, "long code should be collapsed initially");

    await assertAssistantCodeAnswerStableWhileScrolling(page);

    const historicalReasoningToggle = page.locator('[data-chat-message-row="true"][data-message-id="assistant-code"] button[aria-expanded]').first();
    await historicalReasoningToggle.waitFor({ state: "attached", timeout: 10_000 });
    await assert.equal(await historicalReasoningToggle.getAttribute("aria-expanded"), "false", "historical reasoning should be collapsed by default");
    await assert.match(await historicalReasoningToggle.innerText(), /已折叠|collapsed/);
    const historicalReasoningState = await page.evaluate(() => {
      const row = document.querySelector('[data-chat-message-row="true"][data-message-id="assistant-code"]');
      const markdown = row?.querySelector('.reasoning-markdown');
      const collapsible = markdown?.closest('[aria-hidden]');
      return {
        ariaHidden: collapsible?.getAttribute('aria-hidden') || '',
        contentHeight: markdown?.getBoundingClientRect().height || 0,
        wrapperHeight: collapsible?.getBoundingClientRect().height || 0,
      };
    });
    await assert.equal(historicalReasoningState.ariaHidden, "true", "collapsed historical reasoning body should be aria-hidden");
    await assert.ok(historicalReasoningState.wrapperHeight <= 2, `collapsed historical reasoning wrapper should have near-zero height: ${JSON.stringify(historicalReasoningState)}`);

    await longCodeBlock.locator('[data-testid="markdown-code-copy-button"]').click();
    await page.waitForFunction(() => navigator.clipboard.readText().then((text) => text.includes('long code line 150')), null, { timeout: 10_000 });
    await longCodeBlock.getByRole('button', { name: /代码块较长|展开|收起/ }).click();
    await page.waitForSelector('text=long code line 150', { timeout: 10_000 });

    await scrollUntilUserMessageText(page, "请基于这段引用继续解释");
    const quoteCard = page.locator('[data-testid="user-message-quote-card"]');
    await quoteCard.waitFor({ state: "visible", timeout: 10_000 });
    const quoteText = await quoteCard.innerText();
    await assert.match(quoteText, /引用文本|引用上下文/);
    await assert.match(quoteText, /这是第 1 轮用户消息/);
    await assert.match(await page.locator('[data-testid="user-message-text"]').filter({ hasText: "请基于这段引用继续解释" }).innerText(), /请基于这段引用继续解释/);

    await scrollChat(page, "bottom");
    await page.waitForFunction(() => document.body.innerText.includes("展开完整消息"), { timeout: 10_000 });
    const longToggle = page.locator('[data-testid="user-message-collapse-toggle"]');
    await longToggle.waitFor({ state: "visible", timeout: 10_000 });
    await assert.match(await longToggle.innerText(), /展开完整消息 · 约 1\.8k 字 \/ 48 行/);
    await assert.equal(await page.locator('text=这是用户长消息第 48 行').count(), 0, "long user message should be collapsed initially");
    await longToggle.click();
    await page.waitForSelector('text=这是用户长消息第 48 行', { timeout: 10_000 });
    await assert.match(await longToggle.innerText(), /收起长消息 · 约 1\.8k 字 \/ 48 行/);
    await longToggle.click();
    await page.waitForTimeout(250);
    await assert.equal(await page.locator('text=这是用户长消息第 48 行').count(), 0, "long user message should collapse again after toggling");

    assert.equal(errors.length, 0, `unexpected console/page errors: ${errors.slice(0, 3).join(" | ")}`);
    console.log(JSON.stringify({ ok: true, fileChips: fileChipCount, quote: true, longUser: true, longCode: true }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
