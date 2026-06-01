#!/usr/bin/env node
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.CHAT_MESSAGE_OVERVIEW_FIXTURE_BASE_URL || "http://127.0.0.1:3000";

async function waitForRows(page) {
  await page.waitForSelector('[data-testid="virtuoso-scroller"]', { state: "attached", timeout: 20_000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-chat-message-row="true"]').length > 0, null, { timeout: 20_000 });
}

async function overviewExists(page) {
  return page.locator('[data-testid="chat-message-overview"]').count();
}

async function readCompact(page) {
  return page.evaluate(() => {
    const rail = document.querySelector('[data-testid="chat-message-overview-rail"]');
    const panel = document.querySelector('[data-testid="chat-message-overview-panel"]');
    const firstDot = document.querySelector('[data-testid="chat-message-overview-rail"] span');
    const rect = rail?.getBoundingClientRect();
    const panelStyle = panel ? getComputedStyle(panel) : null;
    const root = rail?.closest('[data-testid="chat-message-overview"]');
    const rootRect = root?.getBoundingClientRect();
    const dotRect = firstDot?.getBoundingClientRect();
    return {
      width: rect?.width ?? 0,
      height: rect?.height ?? 0,
      panelVisible: panelStyle ? panelStyle.visibility !== "hidden" && panelStyle.opacity !== "0" : false,
      itemCount: document.querySelectorAll('[data-testid="chat-message-overview-item"]').length,
      zIndex: getComputedStyle(root || panel).zIndex,
      rootRight: rootRect?.right ?? 0,
      rootLeft: rootRect?.left ?? 0,
      viewportWidth: window.innerWidth,
      dotWidth: dotRect?.width ?? 0,
      dotHeight: dotRect?.height ?? 0,
    };
  });
}

async function switchMode(page, testId) {
  await page.click(`[data-testid="${testId}"]`);
  await page.waitForTimeout(250);
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
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    const response = await page.goto(`${baseUrl}/test-chat-message-overview/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    assert.ok(response && response.status() < 400, `unexpected status ${response?.status()}`);
    await page.waitForSelector('[data-testid="chat-message-overview-fixture"]', { state: "attached", timeout: 20_000 });
    await page.waitForFunction(() => {
      const fixture = document.querySelector('[data-testid="chat-message-overview-fixture"]');
      const rect = fixture?.getBoundingClientRect();
      return Boolean(rect && rect.width > 0 && rect.height > 0);
    }, null, { timeout: 20_000 });
    await waitForRows(page);
    await page.waitForSelector('[data-testid="chat-message-overview"]', { timeout: 20_000 });

    const compact = await readCompact(page);
    assert.ok(compact.itemCount === 8, `overview should include 8 user message markers, got ${compact.itemCount}`);
    assert.ok(compact.width <= 32, `compact overview should be narrow, got ${compact.width}`);
    assert.equal(compact.panelVisible, false, "compact overview should hide summary panel before hover");
    assert.ok(Number(compact.dotWidth) >= 24 && Number(compact.dotWidth) <= 32 && Number(compact.dotHeight) >= 1 && Number(compact.dotHeight) <= 4, `compact capsule should be a short horizontal bar, got w=${compact.dotWidth} h=${compact.dotHeight}`);
    assert.ok(Number(compact.zIndex) >= 140, `overview should sit above chat controls and floating panels, got z-index ${compact.zIndex}`);
    assert.ok(compact.rootRight <= compact.viewportWidth && compact.rootLeft >= 0, `overview should stay inside viewport: ${JSON.stringify(compact)}`);

    const beforeHoverScroll = await page.locator('[data-testid="virtuoso-scroller"]').evaluate((el) => el.scrollTop);
    await page.hover('[data-testid="chat-message-overview-rail"]');
    await page.waitForTimeout(260);
    const expanded = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="chat-message-overview-panel"]');
      const labels = [...document.querySelectorAll('[data-testid="chat-message-overview-item"] span:first-child')];
      const firstDot = document.querySelector('[data-testid="chat-message-overview-item"] span:last-child');
      const rect = panel?.getBoundingClientRect();
      const dotRect = firstDot?.getBoundingClientRect();
      return {
        width: rect?.width ?? 0,
        labelVisibleCount: labels.filter((el) => getComputedStyle(el).display !== "none" && getComputedStyle(el).opacity !== "0").length,
        text: document.querySelector('[data-testid="chat-message-overview-panel"]')?.textContent || "",
        dotWidth: dotRect?.width ?? 0,
        dotHeight: dotRect?.height ?? 0,
      };
    });
    assert.ok(expanded.width >= 300, `hover overview should show full summary panel, got ${expanded.width}`);
    assert.ok(expanded.labelVisibleCount >= 8, `hover overview should show all labels, got ${expanded.labelVisibleCount}`);
    assert.ok(expanded.text.includes("dydx chain") || expanded.text.includes("dydx"), "hover overview should show user message summaries");
    assert.ok(expanded.dotWidth >= 18 && expanded.dotWidth <= 24 && expanded.dotHeight >= 1 && expanded.dotHeight <= 4, `hover capsule should be thin bar, got w=${expanded.dotWidth} h=${expanded.dotHeight}`);
    const afterHoverScroll = await page.locator('[data-testid="virtuoso-scroller"]').evaluate((el) => el.scrollTop);
    assert.ok(Math.abs(afterHoverScroll - beforeHoverScroll) <= 2, `hovering overview should not jump the chat scroller: before=${beforeHoverScroll} after=${afterHoverScroll}`);

    const targetId = "overview-user-2";
    await page.click(`[data-testid="chat-message-overview-item"][data-message-id="${targetId}"]`);
    await page.waitForTimeout(450);
    const jumped = await page.evaluate((id) => {
      const row = document.querySelector(`[data-message-id="${id}"]`);
      const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
      const rect = row?.getBoundingClientRect();
      const scrollerRect = scroller?.getBoundingClientRect();
      return {
        found: Boolean(row),
        top: rect?.top ?? -1,
        bottom: rect?.bottom ?? -1,
        scrollerTop: scrollerRect?.top ?? 0,
        scrollerBottom: scrollerRect?.bottom ?? 0,
        highlighted: row?.className.includes("bg-brand/10") ?? false,
      };
    }, targetId);
    assert.ok(jumped.found, "clicked overview target should be rendered");
    assert.ok(jumped.top >= jumped.scrollerTop && jumped.bottom <= jumped.scrollerBottom, `clicked target should be in viewport: ${JSON.stringify(jumped)}`);
    assert.ok(jumped.highlighted, "clicked target should be highlighted");

    await switchMode(page, "overview-mode-single");
    await waitForRows(page);
    assert.equal(await overviewExists(page), 0, "overview should hide with fewer than 2 user messages");

    await switchMode(page, "overview-mode-normal");
    await page.waitForSelector('[data-testid="chat-message-overview"]', { timeout: 20_000 });
    await switchMode(page, "overview-mode-compare");
    await waitForRows(page);
    assert.equal(await overviewExists(page), 0, "overview should hide in compare mode");

    await switchMode(page, "overview-mode-normal");
    await page.waitForSelector('[data-testid="chat-message-overview"]', { timeout: 20_000 });
    await page.locator('[data-chat-message-row="true"]').first().hover();
    await page.locator('button[title="选择分享"]').first().click({ force: true });
    await page.waitForTimeout(250);
    assert.equal(await overviewExists(page), 0, "overview should hide in select mode");

    // select mode is owned by MessageList internal state; reload to reset it before testing later modes.
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForSelector('[data-testid="chat-message-overview-fixture"]', { state: "attached", timeout: 20_000 });
    await waitForRows(page);

    await page.setViewportSize({ width: 620, height: 900 });
    await switchMode(page, "overview-mode-normal");
    await waitForRows(page);
    const mobileVisible = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="chat-message-overview"]');
      if (!root) return false;
      const rect = root.getBoundingClientRect();
      const style = getComputedStyle(root);
      return style.display !== "none" && rect.width > 0 && rect.height > 0;
    });
    assert.equal(mobileVisible, false, "overview should stay hidden on narrow screens");

    await page.setViewportSize({ width: 1440, height: 900 });
    await switchMode(page, "overview-mode-many");
    await waitForRows(page);
    await page.waitForSelector('[data-testid="chat-message-overview"]', { timeout: 20_000 });
    const manyCompact = await readCompact(page);
    assert.equal(manyCompact.itemCount, 40, `many-message overview should keep all markers, got ${manyCompact.itemCount}`);
    assert.ok(manyCompact.height <= 520, `many-message compact overview should be height-capped, got ${manyCompact.height}`);
    await page.hover('[data-testid="chat-message-overview-rail"]');
    await page.waitForTimeout(260);
    const manyExpanded = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="chat-message-overview-panel"]');
      if (!panel) return null;
      panel.scrollTop = panel.scrollHeight;
      panel.dispatchEvent(new Event("scroll", { bubbles: true }));
      const rect = panel.getBoundingClientRect();
      return {
        clientHeight: panel.clientHeight,
        scrollHeight: panel.scrollHeight,
        overflowY: getComputedStyle(panel).overflowY,
        width: rect.width,
      };
    });
    assert.ok(manyExpanded && manyExpanded.scrollHeight > manyExpanded.clientHeight, `many-message expanded panel should be internally scrollable: ${JSON.stringify(manyExpanded)}`);
    assert.equal(manyExpanded.overflowY, "auto", "many-message expanded panel should use overflow-y auto");
    assert.ok(manyExpanded.width >= 300, `many-message expanded panel should still show full panel, got ${manyExpanded.width}`);
    const manyTargetId = "overview-user-40";
    await page.click(`[data-testid="chat-message-overview-item"][data-message-id="${manyTargetId}"]`);
    await page.waitForTimeout(650);
    const manyJumped = await page.evaluate((id) => {
      const row = document.querySelector(`[data-message-id="${id}"]`);
      const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
      const rect = row?.getBoundingClientRect();
      const scrollerRect = scroller?.getBoundingClientRect();
      return {
        found: Boolean(row),
        top: rect?.top ?? -1,
        bottom: rect?.bottom ?? -1,
        scrollerTop: scrollerRect?.top ?? 0,
        scrollerBottom: scrollerRect?.bottom ?? 0,
        highlighted: row?.className.includes("bg-brand/10") ?? false,
      };
    }, manyTargetId);
    assert.ok(manyJumped.found, "last many-message overview target should be rendered after click");
    assert.ok(manyJumped.top >= manyJumped.scrollerTop && manyJumped.bottom <= manyJumped.scrollerBottom, `last many-message target should be in viewport: ${JSON.stringify(manyJumped)}`);
    assert.ok(manyJumped.highlighted, "last many-message target should be highlighted");

    if (failures.length > 0) throw new Error(failures.join("\n"));
    console.log(JSON.stringify({ ok: true, compact, expandedWidth: expanded.width, jumped, hiddenCases: ["single", "compare", "select", "mobile"], many: { itemCount: manyCompact.itemCount, scrollHeight: manyExpanded.scrollHeight, clientHeight: manyExpanded.clientHeight, jumped: manyJumped } }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
