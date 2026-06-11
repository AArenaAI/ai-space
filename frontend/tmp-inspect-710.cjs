const { chromium } = require('playwright');
const fs = require('fs');
(async()=>{
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const logs=[];
  page.on('console', msg => logs.push({type:msg.type(), text: msg.text().slice(0,500)}));
  page.on('pageerror', err => logs.push({type:'pageerror', text:String(err).slice(0,500)}));
  await page.goto('https://testnet.ai-space.xyz/chat/?id=710', { waitUntil:'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const info = await page.evaluate(() => {
    const text = document.body.innerText || '';
    const rows = Array.from(document.querySelectorAll('[data-message-id], [data-testid*="message"], .prose, [class*="message"], [class*="markdown"]')).slice(-50).map((el, i)=>({
      i,
      tag: el.tagName,
      id: el.getAttribute('data-message-id') || el.id || '',
      role: el.getAttribute('data-role') || '',
      cls: (el.className||'').toString().slice(0,180),
      textLen: (el.textContent||'').length,
      text: (el.textContent||'').replace(/\s+/g,' ').slice(0,220)
    }));
    return {url: location.href, title: document.title, bodyTextStart: text.slice(0,800), bodyTextLen: text.length, rows};
  });
  await page.screenshot({ path:'/tmp/ai-space-710-testnet.png', fullPage:false });
  fs.writeFileSync('/tmp/ai-space-710-testnet.json', JSON.stringify({info, logs}, null, 2));
  console.log(JSON.stringify({info, logs: logs.slice(-20), screenshot:'/tmp/ai-space-710-testnet.png'}, null, 2));
  await browser.close();
})();