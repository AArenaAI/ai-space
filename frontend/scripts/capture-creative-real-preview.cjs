const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BASE = 'http://localhost:3000';
const OUT_DIR = path.join(process.cwd(), 'tmp', 'creative-real-preview');
const FRAME_DIR = path.join(OUT_DIR, 'frames');
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(FRAME_DIR, { recursive: true });

async function waitForUsefulPage(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(4500);
}

async function gentleScroll(page, from, to, steps) {
  for (let i = 0; i <= steps; i++) {
    const y = from + ((to - from) * i) / steps;
    await page.evaluate((scrollY) => window.scrollTo({ top: scrollY, behavior: 'auto' }), y);
    await page.waitForTimeout(45);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'zh-CN', colorScheme: 'light' });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(`${BASE}/image/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await waitForUsefulPage(page);
  await page.addStyleTag({ content: `
    * { caret-color: transparent !important; }
    html, body { background: #fff !important; overflow: hidden !important; }
    [data-nextjs-toast], nextjs-portal { display: none !important; }
  ` });
  const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
  console.log(`[content] ${text}`);
  await page.screenshot({ path: path.join(OUT_DIR, 'real-page.png'), fullPage: false, animations: 'allow' });

  const actionPromise = (async () => {
    await page.waitForTimeout(900);
    const textarea = page.locator('textarea').first();
    if (await textarea.count()) {
      await textarea.fill('一位东方幻想女剑客站在雨夜石桥上，电影级光影，参考帧保持人物服饰一致');
    }
    await page.waitForTimeout(700);
    await gentleScroll(page, 0, 180, 14);
    await page.waitForTimeout(500);
    await gentleScroll(page, 180, 0, 14);
  })().catch((err) => console.warn('[action failed]', err.message));

  for (let i = 0; i < 120; i++) {
    await page.screenshot({ path: path.join(FRAME_DIR, `frame-${String(i).padStart(4, '0')}.png`), fullPage: false, animations: 'allow' });
    await page.waitForTimeout(1000 / 24);
  }
  await actionPromise;
  await browser.close();

  const vf = 'scale=960:600:force_original_aspect_ratio=increase,crop=960:600,format=yuv420p';
  let result = spawnSync('ffmpeg', ['-y', '-framerate', '24', '-i', path.join(FRAME_DIR, 'frame-%04d.png'), '-vf', vf, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', path.join(OUT_DIR, 'creative-real.mp4')], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
  result = spawnSync('ffmpeg', ['-y', '-ss', '00:00:02.00', '-i', path.join(OUT_DIR, 'creative-real.mp4'), '-frames:v', '1', path.join(OUT_DIR, 'creative-real-2s.png')], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
  console.log(`[done] ${OUT_DIR}`);
})();
