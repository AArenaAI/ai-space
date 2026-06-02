#!/usr/bin/env node
const { chromium } = require('playwright');

const baseUrl = process.env.CHAT_FIXTURE_BASE_URL || 'http://127.0.0.1:3000';
const path = '/test-chat-i18n/';
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;

function collectCjkSnippets(text) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => CJK_RE.test(line));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const issues = [];

  page.on('pageerror', (error) => issues.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') issues.push(`console.error: ${msg.text()}`);
  });
  page.on('response', (response) => {
    const url = response.url();
    const status = response.status();
    if (status >= 400 && !url.includes('/api/')) issues.push(`response ${status}: ${url}`);
  });

  await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('[data-testid="chat-i18n-fixture"][data-locale-ready="true"]', { timeout: 30_000 });
  await page.waitForFunction(() => document.documentElement.lang === 'en', null, { timeout: 10_000 });

  await page.evaluate(() => document.querySelector('[data-chat-status-kind="completed"]')?.click());
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-chat-status-timeline="true"]')).some((node) => node.textContent?.includes('Status flow')), null, { timeout: 10_000 });

  const moreButton = page.locator('button[title="More"]').first();
  await moreButton.waitFor({ state: 'visible', timeout: 10_000 });
  await page.evaluate(() => document.querySelector('button[title="More"]')?.click());

  await page.waitForSelector('[data-testid="chat-attachment-error-label"]', { timeout: 10_000 });
  await page.waitForFunction(() => document.body.innerText.includes('File parsing failed') || document.body.innerText.includes('Failed'), null, { timeout: 10_000 });
  await page.waitForFunction(() => document.body.innerText.includes('Completed') && /\b\d+s\b/.test(document.body.innerText), null, { timeout: 10_000 });

  const snapshot = await page.evaluate(() => {
    const visibleText = document.body.innerText;
    const titleAttrs = Array.from(document.querySelectorAll('[title]'))
      .map((node) => node.getAttribute('title') || '')
      .filter(Boolean);
    const ariaLabels = Array.from(document.querySelectorAll('[aria-label]'))
      .map((node) => node.getAttribute('aria-label') || '')
      .filter(Boolean);
    const attachmentLabels = Array.from(document.querySelectorAll('[data-testid="chat-attachment-error-label"]'))
      .map((node) => node.textContent || '')
      .filter(Boolean);
    return {
      htmlLang: document.documentElement.lang,
      visibleText,
      titleAttrs,
      ariaLabels,
      attachmentLabels,
      hasCompletedChineseDuration: /Completed\s*·\s*\d+秒/.test(visibleText),
      hasAttachmentError: attachmentLabels.length > 0,
    };
  });

  const visibleCjk = collectCjkSnippets(snapshot.visibleText);
  const titleCjk = snapshot.titleAttrs.filter((value) => CJK_RE.test(value));
  const ariaCjk = snapshot.ariaLabels.filter((value) => CJK_RE.test(value));

  if (snapshot.htmlLang !== 'en') issues.push(`expected html lang en, got ${snapshot.htmlLang}`);
  if (visibleCjk.length) issues.push(`visible CJK residue: ${JSON.stringify(visibleCjk.slice(0, 20))}`);
  if (titleCjk.length) issues.push(`title CJK residue: ${JSON.stringify(titleCjk.slice(0, 20))}`);
  if (ariaCjk.length) issues.push(`aria-label CJK residue: ${JSON.stringify(ariaCjk.slice(0, 20))}`);
  if (snapshot.hasCompletedChineseDuration) issues.push('completed status still uses Chinese duration unit');
  if (!snapshot.hasAttachmentError) issues.push('attachment error label is not visible');

  await browser.close();
  if (issues.length) {
    console.error(JSON.stringify({ ok: false, issues, snapshot }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, checked: 'chat i18n visible residue', attachmentLabels: snapshot.attachmentLabels }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
