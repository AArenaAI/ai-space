#!/usr/bin/env node
const { chromium } = require('playwright');
const { env, login, printResult, summarizeConsole } = require('./chat-live-utils.cjs');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function clickModelSelectorOption(page, trigger, targetName) {
  await trigger.click({ timeout: 5000 });
  const pattern = new RegExp(escapeRegExp(targetName).replace(/\\s+/g, '\\s*'), 'i');
  const option = page.locator('button, [role="option"], [role="menuitem"], li, div').filter({ hasText: pattern }).last();
  try {
    await option.waitFor({ state: 'visible', timeout: 10000 });
  } catch (error) {
    const visibleCandidates = await page.locator('button, [role="option"], [role="menuitem"], li, div')
      .evaluateAll((nodes) => nodes
        .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .filter((text, index, arr) => arr.indexOf(text) === index)
        .slice(0, 80));
    throw new Error(`model option not found: ${targetName}; candidates=${JSON.stringify(visibleCandidates)}`);
  }
  await option.click({ timeout: 5000 });
  await page.waitForTimeout(500);
}

async function waitForRequestBody(page, predicate, timeout = 30000) {
  return page.waitForRequest((req) => {
    if (req.method() !== 'POST') return false;
    if (!predicate(req.url())) return false;
    return true;
  }, { timeout }).then((req) => {
    const body = req.postData() || '{}';
    try { return JSON.parse(body); } catch { return { raw: body }; }
  });
}

(async () => {
  const baseUrl = env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz');
  const auth = await login({ baseUrl });
  const browser = await chromium.launch({ headless: env('HEADFUL') !== '1' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleEvents = [];
  const pageErrors = [];
  page.on('console', (msg) => consoleEvents.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('selected-model', 'deepseek-v4-pro');
    localStorage.removeItem('compare-mode');
    localStorage.removeItem('compare-models');
  }, { token: auth.token, user: auth.user });

  await page.goto(`${baseUrl}/chat?model_selection_live=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const normalTrigger = page.locator('header button').filter({ hasText: /DeepSeek|GPT|Kimi|Gemini|Claude/i }).first();
  await clickModelSelectorOption(page, normalTrigger, 'V4 Flash');
  const normalHeaderText = (await page.locator('header').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const normalBodyPromise = waitForRequestBody(page, (url) => url.endsWith('/api/chat') || url.includes('/api/chat'));
  await page.locator('textarea').last().fill(`模型选择普通模式 live ${Date.now()}，只回答 OK`);
  await page.locator('textarea').last().press('Enter');
  const normalBody = await normalBodyPromise;
  await page.waitForTimeout(1000);
  const normalHeaderAfterSend = (await page.locator('header').innerText().catch(() => '')).replace(/\s+/g, ' ');

  await page.goto(`${baseUrl}/chat?model_selection_compare_live=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  const compareToggle = page.locator('button').filter({ hasText: /Compare|对比|比较/ }).last();
  await compareToggle.click({ timeout: 5000 }).catch(async () => {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+C' : 'Control+Shift+C').catch(() => {});
  });
  await page.waitForTimeout(1000);
  const compareHeader = page.locator('[data-chat-compare-activity-layout="true"]').locator('xpath=ancestor::div[contains(@class,"border-b")][1]').first();
  const compareModelTriggers = page.locator('[data-chat-compare-activity-layout="true"]').locator('xpath=ancestor::div[contains(@class,"border-b")][1]').locator('button');
  await clickModelSelectorOption(page, compareModelTriggers.nth(0), 'V4 Pro');
  await clickModelSelectorOption(page, compareModelTriggers.nth(1), 'V4 Flash');
  const compareHeaderText = (await compareHeader.innerText().catch(() => '')).replace(/\s+/g, ' ');
  const compareBodyPromise = waitForRequestBody(page, (url) => url.includes('/api/chat/compare/init') || url.includes('/api/chat/init'));
  await page.locator('textarea').last().fill(`模型选择对比模式 live ${Date.now()}，只回答 OK`);
  await page.locator('textarea').last().press('Enter');
  const compareBody = await compareBodyPromise;
  await browser.close();

  const normalModel = normalBody.model || normalBody?.body?.model;
  const compareModels = compareBody.compare_models || compareBody.group_models || [];
  const result = {
    normalHeaderText,
    normalHeaderAfterSend,
    normalBodyModel: normalModel,
    compareHeaderText,
    compareBodyModels: compareModels,
    compareBodyModel: compareBody.model,
    pageErrors,
    consoleErrors: summarizeConsole(consoleEvents),
  };
  result.ok = normalModel === 'deepseek-v4-flash'
    && /V4 Flash/i.test(normalHeaderText + normalHeaderAfterSend)
    && /V4 Pro/i.test(compareHeaderText)
    && /V4 Flash/i.test(compareHeaderText)
    && pageErrors.length === 0;
  printResult(result);
  if (!result.ok) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
