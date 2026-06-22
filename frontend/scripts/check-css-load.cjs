const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', msg => console.log('[console]', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('[pageerror]', err.message));
  page.on('requestfailed', req => console.log('[requestfailed]', req.url(), req.failure()?.errorText));
  page.on('response', res => {
    const url = res.url();
    if (url.includes('_next') || url.includes('.css')) console.log('[res]', res.status(), url);
  });
  await page.goto('http://localhost:3000/image', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(2000);
  const result = await page.evaluate(() => {
    const bodyStyle = getComputedStyle(document.body);
    const hidden = document.querySelector('.hidden');
    const mdHidden = document.querySelector('.md\\:hidden');
    const aside = document.querySelector('aside');
    return {
      hrefs: Array.from(document.styleSheets).map(s => s.href).filter(Boolean),
      linkCount: document.querySelectorAll('link[rel="stylesheet"]').length,
      bodyMargin: bodyStyle.margin,
      bodyBg: bodyStyle.backgroundColor,
      hiddenDisplay: hidden ? getComputedStyle(hidden).display : null,
      mdHiddenDisplay: mdHidden ? getComputedStyle(mdHidden).display : null,
      asideDisplay: aside ? getComputedStyle(aside).display : null,
      cssRulesReadable: Array.from(document.styleSheets).map((s) => {
        try { return { href: s.href, rules: s.cssRules.length }; } catch (e) { return { href: s.href, error: String(e) }; }
      })
    };
  });
  console.log(JSON.stringify(result, null, 2));
  await page.screenshot({ path: 'tmp/css-check-image.png', fullPage: false });
  await browser.close();
})();
