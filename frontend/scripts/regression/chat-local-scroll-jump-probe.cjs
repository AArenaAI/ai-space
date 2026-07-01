#!/usr/bin/env node
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.LOCAL_SCROLL_PROBE_BASE_URL || 'http://127.0.0.1:3000';
const scenarios = [
  { name: 'normal-load-more', path: '/test-chat-load-more-history/?currentTurns=32&olderTurns=18&pages=3&lines=16&delay=120', compare: false },
  { name: 'normal-performance', path: '/test-chat-performance/?count=260&longEvery=8&hasMore=0', compare: false },
  { name: 'compare-performance', path: '/test-chat-performance/?count=120&longEvery=8&compare=1&hasMore=0', compare: true },
];

function rowSnapshot(row, scrollerRect) {
  const rect = row.getBoundingClientRect();
  return {
    id: row.getAttribute('data-message-id') || '',
    role: row.getAttribute('data-message-role') || '',
    top: Math.round(rect.top - scrollerRect.top),
    bottom: Math.round(rect.bottom - scrollerRect.top),
    h: Math.round(rect.height),
    text: (row.textContent || '').replace(/\s+/g, ' ').slice(0, 90),
  };
}

async function sample(page, label) {
  return page.evaluate((label) => {
    const el = document.querySelector('[data-testid="chat-history-scroll-container"]');
    if (!(el instanceof HTMLElement)) throw new Error('missing chat scroller');
    const rect = el.getBoundingClientRect();
    const rows = Array.from(el.querySelectorAll('[data-chat-message-row="true"]')).map((row) => {
      const r = row.getBoundingClientRect();
      return {
        id: row.getAttribute('data-message-id') || '',
        role: row.getAttribute('data-message-role') || '',
        top: Math.round(r.top - rect.top),
        bottom: Math.round(r.bottom - rect.top),
        h: Math.round(r.height),
        text: (row.textContent || '').replace(/\s+/g, ' ').slice(0, 90),
      };
    });
    const visible = rows.filter((r) => r.bottom >= 0 && r.top <= rect.height);
    const centerY = rect.height / 2;
    const center = visible.map((r) => ({ ...r, dist: Math.abs((r.top + r.bottom) / 2 - centerY) })).sort((a, b) => a.dist - b.dist)[0] || null;
    return {
      label,
      t: Date.now(),
      scrollTop: Math.round(el.scrollTop),
      scrollHeight: Math.round(el.scrollHeight),
      clientHeight: Math.round(el.clientHeight),
      distanceToBottom: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
      rowCount: rows.length,
      firstVisible: visible[0] || null,
      center,
      lastVisible: visible[visible.length - 1] || null,
      bodyTextLength: document.body.innerText.length,
    };
  }, label);
}

function sameCenter(a, b) {
  if (!a?.center || !b?.center) return true;
  if (a.center.id !== b.center.id) return false;
  return Math.abs(a.center.top - b.center.top) <= 90;
}

async function runScenario(browser, scenario) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  try {
    await page.addInitScript(() => localStorage.setItem('theme', 'green'));
    const response = await page.goto(`${baseUrl}${scenario.path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    assert.ok(response && response.status() < 400, `${scenario.name} unexpected response ${response?.status()}`);
    await page.waitForSelector('[data-testid="chat-history-scroll-container"]', { timeout: 30_000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="chat-history-scroll-container"]');
      return el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 100 && document.querySelectorAll('[data-chat-message-row="true"]').length > 4;
    }, null, { timeout: 30_000 });

    const scrollerBox = await page.locator('[data-testid="chat-history-scroll-container"]').boundingBox();
    assert.ok(scrollerBox, `${scenario.name} missing scroller box`);
    await page.mouse.move(scrollerBox.x + scrollerBox.width / 2, scrollerBox.y + scrollerBox.height / 2);

    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="chat-history-scroll-container"]');
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await page.waitForTimeout(350);

    const samples = [];
    samples.push(await sample(page, `${scenario.name}:bottom`));
    const jumps = [];
    for (let i = 0; i < 18; i += 1) {
      const before = await sample(page, `${scenario.name}:before-up-${i}`);
      await page.mouse.wheel(0, -720);
      await page.waitForTimeout(90);
      const afterWheel = await sample(page, `${scenario.name}:after-wheel-up-${i}`);
      await page.waitForTimeout(420);
      const settle = await sample(page, `${scenario.name}:settle-up-${i}`);
      samples.push(before, afterWheel, settle);
      const postWheelDrift = Math.abs(settle.scrollTop - afterWheel.scrollTop);
      const centerChangedNoInput = !sameCenter(afterWheel, settle);
      // Numeric scrollTop can legitimately change when rich markdown hydrates or
      // browser anchoring preserves the same visual row. Count only visual row
      // movement: center row identity/top drift after the wheel has settled.
      if (centerChangedNoInput) {
        jumps.push({ phase: 'up-settle', i, postWheelDrift, afterWheel, settle });
      }
      if (settle.rowCount > afterWheel.rowCount && !sameCenter(afterWheel, settle)) {
        jumps.push({ phase: 'prepend-center-change', i, afterWheel, settle });
      }
      if (settle.scrollTop <= 4) break;
    }

    for (let i = 0; i < 12; i += 1) {
      const before = await sample(page, `${scenario.name}:before-down-${i}`);
      await page.mouse.wheel(0, 720);
      await page.waitForTimeout(90);
      const afterWheel = await sample(page, `${scenario.name}:after-wheel-down-${i}`);
      await page.waitForTimeout(420);
      const settle = await sample(page, `${scenario.name}:settle-down-${i}`);
      samples.push(before, afterWheel, settle);
      const postWheelDrift = Math.abs(settle.scrollTop - afterWheel.scrollTop);
      const centerChangedNoInput = !sameCenter(afterWheel, settle);
      if (centerChangedNoInput) {
        jumps.push({ phase: 'down-settle', i, postWheelDrift, afterWheel, settle });
      }
      if (settle.distanceToBottom <= 4) break;
    }

    return { name: scenario.name, ok: jumps.length === 0 && consoleErrors.length === 0 && pageErrors.length === 0, jumps, consoleErrors, pageErrors, samplesHead: samples.slice(0, 4), samplesTail: samples.slice(-4) };
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const scenario of scenarios) results.push(await runScenario(browser, scenario));
  } finally {
    await browser.close();
  }
  const ok = results.every((r) => r.ok);
  console.log(JSON.stringify({ ok, results }, null, 2));
  if (!ok) process.exit(1);
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
