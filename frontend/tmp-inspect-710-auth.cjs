const { chromium } = require('playwright');
const fs = require('fs');
const email = process.env.AI_SPACE_E2E_EMAIL;
const password = process.env.AI_SPACE_E2E_PASSWORD;
const base = 'https://testnet.ai-space.xyz';
async function login(){
  const response = await fetch(`${base}/api/auth/login`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email,password})});
  if(!response.ok) throw new Error(`login ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return { token: data.token || data.access_token || data.accessToken, user: data.user || data.data?.user || { email } };
}
function snapshot(){
  const rows = Array.from(document.querySelectorAll('[data-chat-message-row="true"][data-message-id]'));
  const assistants = rows.filter(row => (row.getAttribute('data-message-role') || row.dataset.messageRole || '') === 'assistant' || row.querySelector('[data-markdown-token-renderer], [data-markdown-lite-renderer]'));
  const latest = assistants.at(-1) || rows.at(-1) || null;
  const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
  const token = latest ? Array.from(latest.querySelectorAll('[data-markdown-token-renderer]')).map(n => n.getAttribute('data-markdown-token-renderer') || '') : [];
  const lite = latest ? Array.from(latest.querySelectorAll('[data-markdown-lite-renderer]')).map(n => n.getAttribute('data-markdown-lite-renderer') || '') : [];
  const events = Array.isArray(window.__AI_SPACE_CHAT_PROFILE_EVENTS) ? window.__AI_SPACE_CHAT_PROFILE_EVENTS : [];
  const latestId = latest?.getAttribute('data-message-id') || '';
  const latestEvents = events.filter(e => String(e.messageId || '') === latestId).slice(-20);
  return {
    t: Math.round(performance.now()),
    url: location.href,
    rowCount: rows.length,
    assistantRowCount: assistants.length,
    latestId,
    latestRole: latest?.getAttribute('data-message-role') || '',
    textLen: (latest?.textContent || '').length,
    token,
    lite,
    distanceToBottom: scroller ? Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) : null,
    scrollHeight: scroller?.scrollHeight || null,
    scrollTop: scroller ? Math.round(scroller.scrollTop) : null,
    clientHeight: scroller?.clientHeight || null,
    latestEvents: latestEvents.map(e => ({phase:e.phase, renderedBlockCount:e.renderedBlockCount, hydrateMode:e.hydrateMode, at:Math.round(e.at||0)})),
    textStart: (latest?.textContent || '').replace(/\s+/g,' ').slice(0,180)
  };
}
(async()=>{
  if(!email || !password) throw new Error('missing auth env');
  const auth = await login();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport:{width:1440,height:1000}, deviceScaleFactor:1 });
  const logs=[];
  page.on('console', msg => logs.push({type:msg.type(), text:msg.text().slice(0,500)}));
  page.on('pageerror', err => logs.push({type:'pageerror', text:String(err).slice(0,500)}));
  await page.addInitScript(({token,user})=>{ localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user)); localStorage.setItem('theme','dark'); window.__AI_SPACE_CHAT_PROFILE_ENABLED = true; }, auth);
  await page.goto(`${base}/chat/?id=710`, { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForSelector('[data-testid="virtuoso-scroller"]', {timeout:60000});
  await page.waitForFunction(() => document.querySelectorAll('[data-chat-message-row="true"][data-message-id]').length > 0, null, {timeout:60000});
  const samples=[];
  for(let i=0;i<40;i++) { samples.push(await page.evaluate(snapshot)); await page.waitForTimeout(250); }
  await page.screenshot({path:'/tmp/ai-space-710-auth.png', fullPage:false});
  const result={samples, logs, screenshot:'/tmp/ai-space-710-auth.png'};
  fs.writeFileSync('/tmp/ai-space-710-auth.json', JSON.stringify(result,null,2));
  const deltas=[];
  for(let i=1;i<samples.length;i++){
    const a=samples[i-1], b=samples[i];
    if(a.latestId!==b.latestId || a.textLen!==b.textLen || JSON.stringify(a.token)!==JSON.stringify(b.token) || JSON.stringify(a.lite)!==JSON.stringify(b.lite) || a.rowCount!==b.rowCount || Math.abs((a.distanceToBottom??0)-(b.distanceToBottom??0))>2) deltas.push({i, prev:{t:a.t, row:a.rowCount, id:a.latestId, len:a.textLen, token:a.token, lite:a.lite, dist:a.distanceToBottom, sh:a.scrollHeight}, next:{t:b.t, row:b.rowCount, id:b.latestId, len:b.textLen, token:b.token, lite:b.lite, dist:b.distanceToBottom, sh:b.scrollHeight}});
  }
  console.log(JSON.stringify({first:samples[0], last:samples.at(-1), deltas:deltas.slice(0,30), deltaCount:deltas.length, logs:logs.slice(-20), screenshot:'/tmp/ai-space-710-auth.png'}, null, 2));
  await browser.close();
})();