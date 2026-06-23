const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const routes = [
  ['models', '/chat'],
  ['studio', '/ai-comic'],
  ['notebook', '/notebooks'],
  ['creative', '/image'],
  ['work', '/translator'],
  ['document', '/document-reader'],
  ['ppt', '/ppt'],
];

(async () => {
  const outDir = path.join(process.cwd(), 'tmp', 'route-shots');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
  });
  for (const [name, route] of routes) {
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const url = `http://localhost:3000${route}`;
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: false });
      const title = await page.title().catch(() => '');
      const text = (await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')).slice(0, 300).replace(/\s+/g, ' ');
      console.log(`${name}\t${route}\t${title}\t${text}`);
    } catch (err) {
      console.log(`${name}\t${route}\tERROR\t${err.message}`);
    } finally {
      await page.close();
    }
  }
  await browser.close();
})();
