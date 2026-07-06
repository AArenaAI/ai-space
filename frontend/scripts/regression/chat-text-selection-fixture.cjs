#!/usr/bin/env node
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.TEXT_SELECTION_FIXTURE_BASE_URL || "http://127.0.0.1:3000";

async function selectFixtureText(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-chat-message-row="true"]') || document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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
}

async function openQuoteCard(page) {
  const selectedText = await selectFixtureText(page);
  const selectionBar = page.locator('[data-testid="chat-text-selection-bar"]');
  await selectionBar.waitFor({ state: "visible", timeout: 10_000 });
  await page.locator('[data-testid="chat-text-selection-copy-quote"]').click();
  const quoteCard = page.locator('[data-testid="chat-quote-draft"]');
  await quoteCard.waitFor({ state: "visible", timeout: 10_000 });
  await assert.match(await quoteCard.innerText(), /引用文本|引用上下文|Quoted context/i);
  await assert.match(await quoteCard.innerText(), new RegExp(selectedText));
  await selectionBar.waitFor({ state: "detached", timeout: 10_000 });
  return selectedText;
}

async function waitForSent(page, expected) {
  await page.waitForFunction((value) => {
    const node = document.querySelector('[data-testid="chat-text-selection-last-sent"]');
    return node?.textContent === value;
  }, expected, { timeout: 10_000 });
  const sent = await page.locator('[data-testid="chat-text-selection-last-sent"]').textContent();
  assert.equal(sent, expected);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" && !text.includes("favicon") && !/Failed to load resource: the server responded with a status of 401/.test(text)) errors.push(text);
  });
  page.on("pageerror", (err) => errors.push(err.message));

  try {
    const url = `${baseUrl}/test-chat-text-selection/`;
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    assert.ok(response && response.status() < 400, `unexpected status ${response?.status()} for ${url}`);

    await page.waitForSelector('[data-chat-message-row="true"]', { state: "attached", timeout: 20_000 });
    await page.waitForFunction(() => document.body.innerText.includes("用于验证引用插入输入框"), { timeout: 20_000 });

    const textarea = page.locator('textarea').first();
    const quoteCard = page.locator('[data-testid="chat-quote-draft"]');
    await textarea.waitFor({ state: "visible", timeout: 10_000 });

    // Case 1: quote renders as a card, never as textarea text, and can be cleared.
    const selectedText = await openQuoteCard(page);
    assert.equal(await textarea.inputValue(), "", "quote should render as a card, not textarea text");
    await page.locator('[data-testid="chat-quote-draft-clear"]').click();
    await quoteCard.waitFor({ state: "detached", timeout: 10_000 });

    // Case 2: existing user input is preserved while quote is shown separately, then sent together.
    await textarea.fill("前置输入。 ");
    await openQuoteCard(page);
    assert.equal(await textarea.inputValue(), "前置输入。 ");
    await textarea.press("Enter");
    await waitForSent(page, `> ${selectedText}\n\n前置输入。`);
    await quoteCard.waitFor({ state: "detached", timeout: 10_000 });
    assert.equal(await textarea.inputValue(), "");

    // Case 3: quote-only send is still allowed and clears the quote card.
    await openQuoteCard(page);
    assert.equal(await textarea.inputValue(), "");
    await textarea.press("Enter");
    await waitForSent(page, `> ${selectedText}`);
    await quoteCard.waitFor({ state: "detached", timeout: 10_000 });
    assert.equal(await textarea.inputValue(), "");

    // Case 4: clearing a quote prevents it from leaking into the next plain send.
    await openQuoteCard(page);
    await page.locator('[data-testid="chat-quote-draft-clear"]').click();
    await quoteCard.waitFor({ state: "detached", timeout: 10_000 });
    await textarea.fill("清除后只发送正文。 ");
    await textarea.press("Enter");
    await waitForSent(page, "清除后只发送正文。");
    assert.equal(await textarea.inputValue(), "");

    assert.equal(errors.length, 0, `unexpected console/page errors: ${errors.slice(0, 3).join(" | ")}`);
    console.log(JSON.stringify({ ok: true, selectedText, cases: ["card-clear", "existing-input", "quote-only", "clear-no-leak"] }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
