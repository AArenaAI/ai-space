const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 }, deviceScaleFactor: 1, locale: 'zh-CN' });
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3500);
  await page.evaluate(() => {
    const el = document.querySelector('#features');
    if (el) el.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(1200);
  const txt = await page.locator('body').innerText().catch(() => '');
  console.log(txt.includes('生成、编辑、参考帧'), txt.includes('图像生成、视频入口'));
  await page.screenshot({ path: path.join(process.cwd(), 'tmp/current-landing-features.png'), fullPage: false, animations: 'allow' });
  await browser.close();
})();
