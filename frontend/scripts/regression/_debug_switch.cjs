const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('console', (msg) => console.log('[console]', msg.text()));
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  const URL = 'http://127.0.0.1:3000/test-chat-local-send-switch-restore';
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  console.log('url', page.url());
  console.log('selector count', await page.locator('[data-testid="chat-local-send-switch-restore-fixture"]').count());
  console.log('body text snippet', await page.evaluate(() => document.body.innerText.slice(0, 500)));
  await browser.close();
})();
