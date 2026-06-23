const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  for (const route of ['/chat','/image','/translator','/document-reader','/ai-comic','/ppt']) {
    await page.goto(`http://localhost:3000${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(6000);
    const info = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('main, aside, header, [class], textarea, input, button')).slice(0, 200).map((el) => {
        const r = el.getBoundingClientRect();
        const text = (el.innerText || el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        return { tag: el.tagName, cls: String(el.className).slice(0, 120), text, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      }).filter(e => e.w > 100 && e.h > 40 && e.text);
      return { body: document.body.innerText.replace(/\s+/g,' ').slice(0,200), els };
    });
    console.log('\nROUTE', route, info.body);
    console.table(info.els.slice(0, 20));
  }
  await browser.close();
})();
