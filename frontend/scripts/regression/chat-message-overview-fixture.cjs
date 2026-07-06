#!/usr/bin/env node
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.CHAT_MESSAGE_OVERVIEW_FIXTURE_BASE_URL || "http://127.0.0.1:3000";

async function waitForRows(page) {
  await page.waitForSelector('[data-testid="chat-history-scroll-container"]', { state: "attached", timeout: 20_000 });
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

async function getActiveOverviewId(page) {
  return page.evaluate(() => {
    const active = document.querySelector('[data-testid="chat-message-overview-item"][data-overview-active="true"], [data-testid="chat-message-overview-item"].text-brand');
    return active?.getAttribute("data-message-id") || "";
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const failures = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && !/Failed to load resource/.test(text)) failures.push(`console error: ${text}`);
  });
  page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));

  try {
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    const response = await page.goto(`${baseUrl}/test-chat-message-overview`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    assert.ok(response && response.status() < 400, `unexpected status ${response?.status()}`);
    await page.waitForSelector('[data-testid="chat-message-overview-fixture"]', { state: "attached", timeout: 20_000 });
    await page.waitForFunction(() => {
      const fixture = document.querySelector('[data-testid="chat-message-overview-fixture"]');
      const rect = fixture?.getBoundingClientRect();
      return Boolean(rect && rect.width > 0 && rect.height > 0);
    }, null, { timeout: 20_000 });
    await waitForRows(page);
    await page.waitForSelector('[data-testid="chat-message-overview"]', { timeout: 20_000 });
    await page.waitForFunction(() => {
      const scroller = document.querySelector('[data-testid="chat-history-scroll-container"]');
      if (!scroller) return false;
      return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 4;
    }, null, { timeout: 20_000 });
    // MessageList intentionally performs a few post-layout bottom locks after chat restore.
    // Wait for that settling window before asserting that hover itself does not move the scroller.
    await page.waitForTimeout(900);

    // Default: at bottom, active overview should point to the latest user message.
    const defaultActiveId = await getActiveOverviewId(page);
    assert.equal(defaultActiveId, "overview-user-8", `default active overview at bottom should be the latest user message, got ${defaultActiveId}`);

    // Scroll to the very top: active should switch to the earliest user message.
    await page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="chat-history-scroll-container"]');
      if (scroller) {
        scroller.scrollTop = 0;
        scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      }
    });
    await page.waitForTimeout(150);
    const topActiveId = await getActiveOverviewId(page);
    assert.equal(topActiveId, "overview-user-1", `active overview at the very top should be the earliest user message, got ${topActiveId}`);

    // Scroll back down to restore center-focus logic.
    await page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="chat-history-scroll-container"]');
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
        scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      }
    });
    await page.waitForTimeout(150);
    const bottomActiveId = await getActiveOverviewId(page);
    assert.equal(bottomActiveId, "overview-user-8", `active overview at the very bottom should return to the latest user message, got ${bottomActiveId}`);

    const compact = await readCompact(page);
    assert.ok(compact.itemCount === 8, `overview should include 8 user message markers, got ${compact.itemCount}`);
    assert.ok(compact.width <= 32, `compact overview should be narrow, got ${compact.width}`);
    assert.equal(compact.panelVisible, false, "compact overview should hide summary panel before hover");
    assert.ok(Number(compact.dotWidth) >= 24 && Number(compact.dotWidth) <= 32 && Number(compact.dotHeight) >= 1 && Number(compact.dotHeight) <= 4, `compact capsule should be a short horizontal bar, got w=${compact.dotWidth} h=${compact.dotHeight}`);
    assert.ok(Number(compact.zIndex) >= 140, `overview should sit above chat controls and floating panels, got z-index ${compact.zIndex}`);
    assert.ok(compact.rootRight <= compact.viewportWidth && compact.rootLeft >= 0, `overview should stay inside viewport: ${JSON.stringify(compact)}`);
    const activeReadingBadge = await page.evaluate(() => {
      const active = document.querySelector('[data-testid="chat-message-overview-item"][data-overview-active="true"]');
      return {
        id: active?.getAttribute('data-message-id') || '',
        text: active?.textContent || '',
        ariaCurrent: active?.getAttribute('aria-current') || '',
      };
    });
    assert.equal(activeReadingBadge.id, 'overview-user-8', `active overview item should expose data-overview-active: ${JSON.stringify(activeReadingBadge)}`);
    assert.equal(activeReadingBadge.ariaCurrent, 'true', `active overview item should expose aria-current: ${JSON.stringify(activeReadingBadge)}`);
    assert.ok(activeReadingBadge.text.includes('正在阅读'), `active overview item should show reading hint: ${JSON.stringify(activeReadingBadge)}`);

    const beforeHoverScroll = await page.locator('[data-testid="chat-history-scroll-container"]').evaluate((el) => el.scrollTop);
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
    const afterHoverScroll = await page.locator('[data-testid="chat-history-scroll-container"]').evaluate((el) => el.scrollTop);
    assert.ok(Math.abs(afterHoverScroll - beforeHoverScroll) <= 2, `hovering overview should not jump the chat scroller: before=${beforeHoverScroll} after=${afterHoverScroll}`);

    const targetId = "overview-user-2";
    await page.click(`[data-testid="chat-message-overview-item"][data-message-id="${targetId}"]`);
    await page.waitForTimeout(450);
    const jumped = await page.evaluate((id) => {
      const row = document.querySelector(`[data-message-id="${id}"]`);
      const scroller = document.querySelector('[data-testid="chat-history-scroll-container"]');
      const rect = row?.getBoundingClientRect();
      const scrollerRect = scroller?.getBoundingClientRect();
      const rowCenter = rect ? rect.top + rect.height / 2 : -1;
      const scrollerCenter = scrollerRect ? scrollerRect.top + scrollerRect.height / 2 : -1;
      return {
        found: Boolean(row),
        top: rect?.top ?? -1,
        bottom: rect?.bottom ?? -1,
        scrollerTop: scrollerRect?.top ?? 0,
        scrollerBottom: scrollerRect?.bottom ?? 0,
        centerDelta: Math.abs(rowCenter - scrollerCenter),
        scrollerHeight: scrollerRect?.height ?? 0,
        highlighted: row?.className.includes("bg-brand/10") ?? false,
      };
    }, targetId);
    assert.ok(jumped.found, "clicked overview target should be rendered");
    assert.ok(jumped.top >= jumped.scrollerTop && jumped.bottom <= jumped.scrollerBottom, `clicked target should be in viewport: ${JSON.stringify(jumped)}`);
    assert.ok(jumped.centerDelta <= Math.max(48, jumped.scrollerHeight * 0.08), `clicked target should be centered in the chat scroller: ${JSON.stringify(jumped)}`);
    assert.ok(jumped.highlighted, "clicked target should be highlighted");
    await page.waitForTimeout(120);
    const savedOverviewAnchor = await page.evaluate(() => {
      const raw = sessionStorage.getItem('ai-space-chat-scroll:2000');
      return raw ? JSON.parse(raw) : null;
    });
    assert.equal(savedOverviewAnchor?.anchorMessageId, targetId, `overview click should persist the target message as scroll anchor: ${JSON.stringify(savedOverviewAnchor)}`);
    assert.equal(typeof savedOverviewAnchor?.anchorOffset, 'number', `overview click should persist anchor offset: ${JSON.stringify(savedOverviewAnchor)}`);

    await page.click('[data-testid="overview-target-assistant"]');
    await page.waitForTimeout(500);
    const targetedAssistant = await page.evaluate(() => {
      const assistant = document.querySelector('[data-chat-message-row="true"][data-server-message-id="4"]');
      const pairedUser = document.querySelector('[data-chat-message-row="true"][data-server-message-id="3"]');
      const scroller = document.querySelector('[data-testid="chat-history-scroll-container"]');
      const assistantRect = assistant?.getBoundingClientRect();
      const userRect = pairedUser?.getBoundingClientRect();
      const scrollerRect = scroller?.getBoundingClientRect();
      const assistantCenter = assistantRect ? assistantRect.top + assistantRect.height / 2 : -1;
      const scrollerCenter = scrollerRect ? scrollerRect.top + scrollerRect.height / 2 : -1;
      return {
        assistantFound: Boolean(assistant),
        userFound: Boolean(pairedUser),
        assistantHighlighted: assistant?.className.includes('bg-brand/10') ?? false,
        userHighlighted: pairedUser?.className.includes('bg-brand/10') ?? false,
        assistantTop: assistantRect?.top ?? -1,
        assistantBottom: assistantRect?.bottom ?? -1,
        userTop: userRect?.top ?? -1,
        scrollerTop: scrollerRect?.top ?? 0,
        scrollerBottom: scrollerRect?.bottom ?? 0,
        centerDelta: Math.abs(assistantCenter - scrollerCenter),
        scrollerHeight: scrollerRect?.height ?? 0,
      };
    });
    assert.ok(targetedAssistant.assistantFound, `targeted assistant row should be rendered: ${JSON.stringify(targetedAssistant)}`);
    assert.ok(targetedAssistant.assistantHighlighted, `targetMessageId should highlight the exact assistant message, not only its user group: ${JSON.stringify(targetedAssistant)}`);
    assert.equal(targetedAssistant.userHighlighted, false, `paired user should not be highlighted for assistant target: ${JSON.stringify(targetedAssistant)}`);
    assert.ok(targetedAssistant.assistantTop >= targetedAssistant.scrollerTop && targetedAssistant.assistantBottom <= targetedAssistant.scrollerBottom, `targeted assistant should be in viewport: ${JSON.stringify(targetedAssistant)}`);
    assert.ok(targetedAssistant.centerDelta <= Math.max(64, targetedAssistant.scrollerHeight * 0.12), `targeted assistant should be near centered: ${JSON.stringify(targetedAssistant)}`);
    await page.click('[data-testid="overview-clear-target"]');
    await page.waitForTimeout(120);

    // Let the click-jump active lock expire before testing passive scroll active-marker timing.
    await page.waitForTimeout(950);
    const activeSwitchTiming = await page.evaluate(async () => {
      const scroller = document.querySelector('[data-testid="chat-history-scroll-container"]');
      const target = document.querySelector('[data-chat-message-row="true"][data-message-id="overview-user-3"]');
      if (!scroller || !target) return { ok: false, reason: "missing scroller or target" };
      const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      const activeId = () => document.querySelector('[data-testid="chat-message-overview-item"].text-brand')?.getAttribute("data-message-id") || "";

      const placeTargetNearTop = () => {
        const targetRect = target.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        scroller.scrollTop += targetRect.top - scrollerRect.top - 8;
        scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      };
      placeTargetNearTop();
      await waitFrame();
      placeTargetNearTop();
      await waitFrame();
      const topActiveId = activeId();
      const topTargetRect = target.getBoundingClientRect();
      const topScrollerRect = scroller.getBoundingClientRect();
      const topTargetCenter = topTargetRect.top + topTargetRect.height / 2;
      const focusTop = topScrollerRect.top + topScrollerRect.height * 0.35;

      const placeTargetAtCenter = () => {
        const targetRect = target.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        const targetCenter = targetRect.top + targetRect.height / 2;
        const scrollerCenter = scrollerRect.top + scrollerRect.height / 2;
        scroller.scrollTop += targetCenter - scrollerCenter;
        scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      };
      placeTargetAtCenter();
      await waitFrame();
      placeTargetAtCenter();
      await waitFrame();
      const centeredActiveId = activeId();
      const centeredTargetRect = target.getBoundingClientRect();
      const centeredScrollerRect = scroller.getBoundingClientRect();
      const centeredDelta = Math.abs(
        centeredTargetRect.top + centeredTargetRect.height / 2 - (centeredScrollerRect.top + centeredScrollerRect.height / 2)
      );

      return {
        ok: true,
        topActiveId,
        topTargetTop: topTargetRect.top,
        topScrollerTop: topScrollerRect.top,
        topTargetCenter,
        focusTop,
        centeredActiveId,
        centeredDelta,
      };
    });
    assert.ok(activeSwitchTiming.ok, `active switch timing setup failed: ${JSON.stringify(activeSwitchTiming)}`);
    assert.ok(activeSwitchTiming.topTargetCenter < activeSwitchTiming.focusTop, `premature-switch check should place next user before the center focus band: ${JSON.stringify(activeSwitchTiming)}`);
    assert.notEqual(activeSwitchTiming.topActiveId, "overview-user-3", `overview active marker should not switch when the next user row only appears near the top: ${JSON.stringify(activeSwitchTiming)}`);
    assert.equal(activeSwitchTiming.centeredActiveId, "overview-user-3", `overview active marker should switch once the user row reaches the center focus band: ${JSON.stringify(activeSwitchTiming)}`);
    assert.ok(activeSwitchTiming.centeredDelta <= 48, `centered active-switch target should be close to the scroller center: ${JSON.stringify(activeSwitchTiming)}`);

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
    await page.locator('button[title="选择分享"], button[title="Select to share"]').first().click({ force: true });
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
    assert.equal(manyCompact.itemCount, 9, `many-message overview should render the visible 9-item window, got ${manyCompact.itemCount}`);
    assert.ok(manyCompact.height <= 520, `many-message compact overview should be height-capped, got ${manyCompact.height}`);
    await page.hover('[data-testid="chat-message-overview-rail"]');
    await page.waitForTimeout(260);
    const manyExpanded = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="chat-message-overview-panel"]');
      if (!panel) return null;
      const rect = panel.getBoundingClientRect();
      const ids = [...document.querySelectorAll('[data-testid="chat-message-overview-item"]')].map((item) => item.getAttribute("data-message-id"));
      return {
        renderedCount: ids.length,
        firstId: ids[0] || "",
        lastId: ids[ids.length - 1] || "",
        overflowY: getComputedStyle(panel).overflowY,
        width: rect.width,
      };
    });
    assert.ok(manyExpanded, "many-message expanded panel should exist");
    assert.equal(manyExpanded.renderedCount, 9, `many-message expanded panel should render the same 9-item window, got ${JSON.stringify(manyExpanded)}`);
    assert.equal(manyExpanded.lastId, "overview-user-40", `many-message expanded panel should initially include the active/latest item: ${JSON.stringify(manyExpanded)}`);
    assert.ok(manyExpanded.width >= 300, `many-message expanded panel should still show full panel, got ${manyExpanded.width}`);

    const beforePanelWheelScroll = await page.locator('[data-testid="chat-history-scroll-container"]').evaluate((el) => el.scrollTop);
    await page.hover('[data-testid="chat-message-overview-panel"]');
    await page.mouse.wheel(0, -720);
    await page.waitForTimeout(120);
    const afterPanelWheel = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[data-testid="chat-message-overview-item"]')].map((item) => item.getAttribute("data-message-id"));
      return {
        firstId: ids[0] || "",
        lastId: ids[ids.length - 1] || "",
      };
    });
    const afterPanelWheelScroll = await page.locator('[data-testid="chat-history-scroll-container"]').evaluate((el) => el.scrollTop);
    assert.notEqual(afterPanelWheel.firstId, manyExpanded.firstId, `wheel over expanded overview panel should browse the overview window: before=${JSON.stringify(manyExpanded)} after=${JSON.stringify(afterPanelWheel)}`);
    assert.ok(Math.abs(afterPanelWheelScroll - beforePanelWheelScroll) <= 2, `wheel over expanded overview panel should not scroll the main chat: before=${beforePanelWheelScroll} after=${afterPanelWheelScroll}`);

    const scrollbarDragStart = await page.evaluate(() => {
      const thumb = document.querySelector('[data-testid="chat-message-overview-scrollbar-thumb"]');
      const track = document.querySelector('[data-testid="chat-message-overview-scrollbar"]');
      const scroller = document.querySelector('[data-testid="chat-history-scroll-container"]');
      const ids = [...document.querySelectorAll('[data-testid="chat-message-overview-item"]')].map((item) => item.getAttribute("data-message-id"));
      const thumbRect = thumb?.getBoundingClientRect();
      const trackRect = track?.getBoundingClientRect();
      return {
        ok: Boolean(thumbRect && trackRect && scroller),
        beforeFirstId: ids[0] || "",
        beforeScrollTop: scroller?.scrollTop ?? -1,
        x: thumbRect ? thumbRect.left + thumbRect.width / 2 : 0,
        startY: thumbRect ? thumbRect.top + thumbRect.height / 2 : 0,
        endY: trackRect ? trackRect.bottom - 6 : 0,
        trackHeight: trackRect?.height ?? 0,
        thumbHeight: thumbRect?.height ?? 0,
      };
    });
    assert.ok(scrollbarDragStart.ok, `scrollbar drag setup failed: ${JSON.stringify(scrollbarDragStart)}`);
    await page.mouse.move(scrollbarDragStart.x, scrollbarDragStart.startY);
    await page.mouse.down();
    await page.mouse.move(scrollbarDragStart.x, scrollbarDragStart.endY, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    const scrollbarDrag = await page.evaluate((start) => {
      const scroller = document.querySelector('[data-testid="chat-history-scroll-container"]');
      const ids = [...document.querySelectorAll('[data-testid="chat-message-overview-item"]')].map((item) => item.getAttribute("data-message-id"));
      return {
        ...start,
        afterFirstId: ids[0] || "",
        afterLastId: ids[ids.length - 1] || "",
        afterScrollTop: scroller?.scrollTop ?? -1,
      };
    }, scrollbarDragStart);
    assert.notEqual(scrollbarDrag.afterFirstId, scrollbarDrag.beforeFirstId, `dragging overview scrollbar should browse the overview window: ${JSON.stringify(scrollbarDrag)}`);
    assert.equal(scrollbarDrag.afterLastId, "overview-user-40", `dragging overview scrollbar down should reach the latest items: ${JSON.stringify(scrollbarDrag)}`);
    assert.ok(Math.abs(scrollbarDrag.afterScrollTop - scrollbarDrag.beforeScrollTop) <= 2, `dragging overview scrollbar should not scroll the main chat: ${JSON.stringify(scrollbarDrag)}`);

    await page.mouse.wheel(0, 720);
    await page.waitForTimeout(120);
    const manyTargetId = "overview-user-40";
    await page.click(`[data-testid="chat-message-overview-item"][data-message-id="${manyTargetId}"]`);
    await page.waitForTimeout(650);
    const manyJumped = await page.evaluate((id) => {
      const row = document.querySelector(`[data-message-id="${id}"]`);
      const scroller = document.querySelector('[data-testid="chat-history-scroll-container"]');
      const rect = row?.getBoundingClientRect();
      const scrollerRect = scroller?.getBoundingClientRect();
      const rowCenter = rect ? rect.top + rect.height / 2 : -1;
      const scrollerCenter = scrollerRect ? scrollerRect.top + scrollerRect.height / 2 : -1;
      return {
        found: Boolean(row),
        top: rect?.top ?? -1,
        bottom: rect?.bottom ?? -1,
        scrollerTop: scrollerRect?.top ?? 0,
        scrollerBottom: scrollerRect?.bottom ?? 0,
        centerDelta: Math.abs(rowCenter - scrollerCenter),
        scrollerHeight: scrollerRect?.height ?? 0,
        highlighted: row?.className.includes("bg-brand/10") ?? false,
      };
    }, manyTargetId);
    assert.ok(manyJumped.found, "last many-message overview target should be rendered after click");
    assert.ok(manyJumped.top >= manyJumped.scrollerTop && manyJumped.bottom <= manyJumped.scrollerBottom, `last many-message target should be in viewport: ${JSON.stringify(manyJumped)}`);
    assert.ok(manyJumped.centerDelta <= Math.max(48, manyJumped.scrollerHeight * 0.08), `last many-message target should be centered in the chat scroller: ${JSON.stringify(manyJumped)}`);
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
