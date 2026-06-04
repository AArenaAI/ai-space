#!/usr/bin/env node
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.CHAT_MARKDOWN_TOKEN_FIXTURE_BASE_URL || "http://127.0.0.1:3000";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !/Minified React error #(422|425)/.test(message.text())) {
      failures.push(`console error: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    if (!/Minified React error #(422|425)/.test(error.message)) failures.push(`page error: ${error.message}`);
  });

  try {
    const response = await page.goto(`${baseUrl}/test-chat-markdown-token/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    assert.ok(response && response.status() < 400, `unexpected status ${response?.status()}`);
    await page.waitForSelector('[data-testid="markdown-token-fixture"]', { state: "attached", timeout: 20_000 });
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="markdown-token-fixture"]');
      if (!root) return null;
      return {
        heading: root.querySelectorAll("h1").length,
        strong: root.querySelectorAll("strong").length,
        emphasis: root.querySelectorAll("em").length,
        deleted: root.querySelectorAll("del").length,
        inlineCode: [...root.querySelectorAll("code")].filter((node) => !node.closest('[data-testid="markdown-code-block"]')).length,
        links: root.querySelectorAll('a[href="https://example.com"]').length,
        taskInputs: root.querySelectorAll('input[type="checkbox"]').length,
        tables: root.querySelectorAll("table").length,
        blockquotes: root.querySelectorAll("blockquote").length,
        codeBlocks: root.querySelectorAll('[data-testid="markdown-code-block"]').length,
        renderer: root.querySelector("[data-markdown-token-renderer]")?.getAttribute("data-markdown-token-renderer") || root.querySelector("[data-markdown-lite-renderer]")?.getAttribute("data-markdown-lite-renderer") || "none",
        bodyText: root.textContent || "",
      };
    });

    assert.ok(result, "fixture root missing");
    assert.equal(result.heading, 1, `heading should render: ${JSON.stringify(result)}`);
    assert.ok(result.strong >= 2, `bold text should render in paragraph and table: ${JSON.stringify(result)}`);
    assert.equal(result.emphasis, 1, `italic text should render: ${JSON.stringify(result)}`);
    assert.equal(result.deleted, 1, `strikethrough should render: ${JSON.stringify(result)}`);
    assert.ok(result.inlineCode >= 1, `inline code should render: ${JSON.stringify(result)}`);
    assert.equal(result.links, 1, `link should render: ${JSON.stringify(result)}`);
    assert.equal(result.taskInputs, 2, `task list checkboxes should render: ${JSON.stringify(result)}`);
    assert.equal(result.tables, 1, `table should render: ${JSON.stringify(result)}`);
    assert.equal(result.blockquotes, 1, `blockquote should render: ${JSON.stringify(result)}`);
    assert.equal(result.codeBlocks, 1, `code fence should render custom code block: ${JSON.stringify(result)}`);
    assert.ok(!result.bodyText.includes("[a link](https://example.com)"), `raw markdown link leaked: ${JSON.stringify(result)}`);
    if (failures.length > 0) throw new Error(failures.join("\n"));

    console.log(JSON.stringify({ ok: true, ...result }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
