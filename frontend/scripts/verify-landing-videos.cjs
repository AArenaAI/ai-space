const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, locale: 'zh-CN' });
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll('#features video').length >= 5, { timeout: 30000 });
  await page.waitForTimeout(1000);
  const videos = await page.$$eval('#features video', nodes => nodes.map(v => ({
    src: v.getAttribute('src'),
    poster: v.getAttribute('poster'),
    aria: v.getAttribute('aria-label'),
    width: v.clientWidth,
    height: v.clientHeight,
  })));
  console.log(JSON.stringify(videos, null, 2));
  const missing = videos.filter(v => !v.src || !v.poster || v.width < 300 || v.height < 180);
  if (videos.length !== 5 || missing.length) {
    console.error('Invalid landing videos', { count: videos.length, missing });
    process.exit(1);
  }
  await page.screenshot({ path: 'tmp/landing-features-check.png', fullPage: false });
  await browser.close();
})();
