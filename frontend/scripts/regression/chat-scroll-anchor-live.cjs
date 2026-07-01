#!/usr/bin/env node
const { chromium } = require('playwright');
const { env, login, summarizeConsole, printResult } = require('./chat-live-utils.cjs');

const baseUrl = env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz');
const normalId = Number(env('SCROLL_NORMAL_ID', '1217'));
const compareId = Number(env('SCROLL_COMPARE_ID', '1218'));
const rounds = Number(env('SCROLL_ROUNDS', '2'));
const step = Number(env('SCROLL_STEP', '700'));

async function openPage(token, user) {
  const browser = await chromium.launch({ headless: env('HEADFUL') !== '1' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    if (user?.default_workspace_id) localStorage.setItem('current-workspace', String(user.default_workspace_id));
  }, { token, user });
  return { browser, page };
}

async function focusScroller(page) {
  const box = await page.locator('[data-testid="chat-history-scroll-container"]').boundingBox();
  if (!box) throw new Error('missing chat scroller');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

async function sample(page, label) {
  return page.evaluate((label) => {
    const el = document.querySelector('[data-testid="chat-history-scroll-container"]');
    if (!el) return { label, missing: true };
    const rect = el.getBoundingClientRect();
    const rows = [...el.querySelectorAll('[data-chat-message-row="true"]')].map((row) => {
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
    const center = visible.map((r) => ({ ...r, dist: Math.abs((r.top + r.bottom) / 2 - rect.height / 2) })).sort((a, b) => a.dist - b.dist)[0] || null;
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
    };
  }, label);
}

function analyze(samples) {
  const jumps = [];
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a.missing || b.missing) continue;
    const dTop = b.scrollTop - a.scrollTop;
    const dHeight = b.scrollHeight - a.scrollHeight;
    const noUserBetween = /^after/.test(a.label) && /^settle/.test(b.label);
    const centerStable = Boolean(a.center && b.center && a.center.id === b.center.id && Math.abs((b.center.top ?? 0) - (a.center.top ?? 0)) <= 12);
    // During remote history prepend, scrollTop legitimately increases roughly
    // by the inserted height to keep the same visible row anchored. Do not flag
    // that numeric scrollTop delta as a visual jump when the center row remains
    // visually anchored in the viewport.
    if (noUserBetween && Math.abs(dTop) > 180 && !centerStable) {
      jumps.push({ type: 'post-wheel-settle-jump', label: `${a.label}->${b.label}`, dTop, dHeight, from: a, to: b });
    }
    if (noUserBetween && a.center && b.center && a.center.id !== b.center.id && Math.abs(dTop) > 120) {
      jumps.push({ type: 'center-changed-after-settle', label: `${a.label}->${b.label}`, dTop, dHeight, fromCenter: a.center, toCenter: b.center });
    }
  }
  return jumps;
}

async function runCase(page, id, kind) {
  const samples = [];
  await page.goto(`${baseUrl}/chat/?id=${id}&scroll_anchor_probe=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-history-scroll-container"]', { timeout: 30000 });
  await page.waitForTimeout(3500);
  await focusScroller(page);
  samples.push(await sample(page, `${kind}:initial`));
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="chat-history-scroll-container"]');
    if (el) el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(500);
  await focusScroller(page);
  samples.push(await sample(page, `${kind}:bottom`));
  for (let round = 0; round < rounds; round += 1) {
    for (let i = 0; i < 16; i += 1) {
      await page.mouse.wheel(0, -step);
      await page.waitForTimeout(90);
      samples.push(await sample(page, `after-${kind}-up-${round}-${i}`));
      await page.waitForTimeout(360);
      samples.push(await sample(page, `settle-${kind}-up-${round}-${i}`));
    }
    for (let i = 0; i < 16; i += 1) {
      await page.mouse.wheel(0, step);
      await page.waitForTimeout(90);
      samples.push(await sample(page, `after-${kind}-down-${round}-${i}`));
      await page.waitForTimeout(360);
      samples.push(await sample(page, `settle-${kind}-down-${round}-${i}`));
    }
  }
  return { id, kind, sampleCount: samples.length, jumps: analyze(samples), samplesHead: samples.slice(0, 8), samplesTail: samples.slice(-12) };
}

(async () => {
  if (!normalId || !compareId) throw new Error('SCROLL_NORMAL_ID and SCROLL_COMPARE_ID are required');
  const auth = await login({ baseUrl });
  const { browser, page } = await openPage(auth.token, auth.user);
  const events = { console: [], errors: [], requestfailed: [] };
  page.on('console', (msg) => events.console.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (error) => events.errors.push(String(error).slice(0, 300)));
  page.on('requestfailed', (req) => events.requestfailed.push({ url: req.url(), failure: req.failure()?.errorText || '' }));
  const normal = await runCase(page, normalId, 'normal');
  const compare = await runCase(page, compareId, 'compare');
  await browser.close();
  const result = {
    ok: normal.jumps.length === 0 && compare.jumps.length === 0 && events.errors.length === 0,
    normal: { ...normal, jumps: normal.jumps.slice(0, 12) },
    compare: { ...compare, jumps: compare.jumps.slice(0, 12) },
    consoleErrors: summarizeConsole(events.console),
    pageErrors: events.errors,
    requestfailed: events.requestfailed.slice(-10),
  };
  printResult(result);
  if (!result.ok) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
