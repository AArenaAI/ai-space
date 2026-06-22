const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BASE = 'http://localhost:3000';
// Safety: this script is for preview captures only. Do not write directly to
// public/home-materials/features because those files are curated landing assets.
// Set FEATURE_VIDEO_OUTPUT_DIR explicitly if you really want another destination.
const OUT_DIR = process.env.FEATURE_VIDEO_OUTPUT_DIR
  ? path.resolve(process.env.FEATURE_VIDEO_OUTPUT_DIR)
  : path.join(process.cwd(), 'tmp', 'feature-video-preview');
const POSTER_DIR = path.join(OUT_DIR, 'posters');
const TMP_DIR = path.join(process.cwd(), 'tmp', 'feature-video-frames');

const features = [
  {
    id: 'models',
    route: '/chat/',
    waitText: 'Chat',
    actions: async (page) => {
      await page.waitForTimeout(2500);
      await gentleScroll(page, 0, 90, 8);
      await page.waitForTimeout(350);
      await gentleScroll(page, 90, 0, 8);
    },
  },
  {
    id: 'studio',
    route: '/seedream-beta',
    waitText: 'Seedream',
    actions: async (page) => {
      await page.waitForTimeout(700);
      await page.locator('textarea').first().fill('Folk suspense short drama: a funeral band receives a midnight job with no host, five episodes, rule pressure, and a protagonist who survives by spotting loopholes.').catch(() => {});
      await page.waitForTimeout(900);
      await gentleScroll(page, 0, 180, 14);
      await page.waitForTimeout(450);
      await gentleScroll(page, 180, 0, 14);
    },
  },
  {
    id: 'notebook',
    route: '/notebooks',
    waitText: 'Notebook',
    actions: async (page) => {
      await page.waitForTimeout(800);
      await gentleScroll(page, 0, 160, 12);
      await page.waitForTimeout(500);
      await gentleScroll(page, 160, 0, 12);
    },
  },
  {
    id: 'creative',
    route: '/image/',
    waitText: 'Generate',
    actions: async (page) => {
      await page.waitForTimeout(1800);
      await page.locator('textarea').first().fill('An eastern fantasy swordswoman standing on a rainy stone bridge, cinematic lighting, consistent reference-frame costume details.').catch(() => {});
      await page.waitForTimeout(700);
      await gentleScroll(page, 0, 210, 14);
      await page.waitForTimeout(450);
      await gentleScroll(page, 210, 0, 14);
    },
  },
  {
    id: 'work',
    route: '/translator/',
    waitText: 'Translate',
    actions: async (page) => {
      await page.waitForTimeout(800);
      await page.locator('textarea').first().fill('AI Space helps creators turn ideas into finished stories, images, videos, documents and presentations in one workspace.').catch(() => {});
      await page.waitForTimeout(900);
      await gentleScroll(page, 0, 120, 10);
      await page.waitForTimeout(450);
      await gentleScroll(page, 120, 0, 10);
    },
  },
];

async function gentleScroll(page, from, to, steps) {
  for (let i = 0; i <= steps; i++) {
    const y = from + ((to - from) * i) / steps;
    await page.evaluate((scrollY) => window.scrollTo({ top: scrollY, behavior: 'auto' }), y);
    await page.waitForTimeout(45);
  }
}

async function waitForUsefulPage(page, waitText) {
  await page.waitForLoadState('domcontentloaded');
  if (waitText) {
    await page.waitForFunction(
      (text) => document.body && document.body.innerText.includes(text),
      waitText,
      { timeout: 30000 }
    ).catch(() => {});
  }
  // Business API calls can 404 in local unauthenticated demos, so do not wait for full networkidle.
  await page.waitForTimeout(3000);
}

async function applyEnglishCapturePolish(page) {
  await page.evaluate(() => {
    const replacements = new Map([
      ['登录', 'Log in'],
      ['刷新', 'Refresh'],
      ['新建空间', 'New Space'],
      ['空间世界', 'Space World'],
      ['你的', 'Your'],
      ['反馈', 'Feedback'],
      ['AI 文档学习助手', 'AI Document Study Assistant'],
      ['请上传一个文档', 'Upload a document to begin'],
      ['点击上传文件', 'Click to upload files'],
      ['支持 PDF、DOCX、TXT、MD 等格式', 'Supports PDF, DOCX, TXT, MD and more'],
      ['AI 短剧', 'AI Drama'],
      ['先把短剧想法聊清楚', 'Clarify your short-drama idea first'],
      ['告诉 AI 你的题材、人物、冲突或参考作品，它会帮你拆出可执行的制作方案。', 'Tell AI the genre, characters, conflict, and references. It turns them into an executable production plan.'],
      ['生成配置', 'Generation Settings'],
      ['剧本类型', 'Script Type'],
      ['集数', 'Episodes'],
      ['每集时长', 'Duration per Episode'],
      ['故事梗概', 'Story Synopsis'],
      ['输入故事设定、人物关系或想拍的桥段', 'Enter story setting, character relationships, or key scenes'],
      ['智能拆解剧本', 'Smart Script Breakdown'],
      ['开始创作', 'Start Creating'],
      ['角色资产', 'Character Assets'],
      ['场景资产', 'Scene Assets'],
      ['分镜成片', 'Storyboard to Video'],
      ['资产库', 'Asset Library'],
      ['新建项目', 'New Project'],
      ['项目', 'Projects'],
      ['返回对话', 'Back to Chat'],
      ['AI智能体', 'AI Agents'],
      ['AI 智能体', 'AI Agents'],
      ['视频脚本', 'Video Script'],
      ['分镜生成', 'Storyboard'],
      ['AI 视频生成', 'AI Video'],
      ['AI 配音/音效', 'AI Voice & SFX'],
      ['你也可以先输入已有小说/短剧/网文作品，由 AI 辅助生成短剧大纲，不是写小说。', 'You can start from an existing novel, short drama, or web story. AI helps turn it into a short-drama outline, not a novel draft.'],
      ['开始 AI', 'Start AI'],
      ['智能拆解分析', 'Smart Breakdown'],
      ['AI写作助手', 'AI Writing Assistant'],
      ['AI 写作助手', 'AI Writing Assistant'],
      ['文本翻译', 'Text Translation'],
      ['实时翻译', 'Live Translation'],
      ['文档阅读', 'Document Reader'],
      ['批量翻译', 'Batch Translation'],
      ['批量总结', 'Batch Summary'],
      ['批量改写', 'Batch Rewrite'],
      ['工具', 'Tools'],
      ['从想法到剧本，再进入梦想画布', 'From idea to script, then into the production canvas'],
      ['AI编剧剧本内容', 'AI Scriptwriting Content'],
      ['AI 编剧剧本内容', 'AI Scriptwriting Content'],
      ['这里不是Generate小说，先把类型、核心梗、主角配角、Episodes、结局钩子想清楚，再提炼成可确认编剧的最终有效创意。', 'This is not novel generation. Clarify genre, core hook, cast, episodes, and ending hook before refining the final production-ready idea.'],
      ['你可以从核心梗/创意/剧情片段，但流程目标是完整短剧大纲，不是改写小说。', 'Start from a hook, idea, or scene fragment. The goal is a complete short-drama outline, not novel rewriting.'],
      ['Upload小说/梗概文本', 'Upload novel or synopsis text'],
      ['提取创意内容', 'Extract Creative Content'],
      ['提交编剧', 'Submit to Scriptwriter'],
      ['按成本/质量选择文本工作流模型', 'Choose text workflow model by cost and quality'],
      ['当前：编剧本/改剧本 gpt-5.5，批量Generate deepseek-v4-pro', 'Current: scriptwriting/rewrite gpt-5.5, batch generation deepseek-v4-pro'],
      ['当前：', 'Current:'],
      ['Generate目标', 'Generation Goal'],
      ['最终有效创意', 'Final Validated Idea'],
      ['从提交中提炼最正本方案，只保留用户确认的创意。', 'Refine the strongest plan from the submission and keep only user-confirmed creative intent.'],
      ['剧本Summary', 'Script Summary'],
      ['故事类型、核心梗、一句话故事、人物小传、Story Synopsis、', 'Genre, core hook, logline, character bios, story synopsis,'],
      ['分集剧本', 'Episode Scripts'],
      ['按集输出简介、主事件、关系推进和结尾钩子。', 'Output each episode with summary, main event, relationship movement, and ending hook.'],
      ['新Projects', 'New Projects'],
      ['创作', 'Create'],
      ['概览', 'Overview'],
      ['生成', 'Generate'],
      ['上传', 'Upload'],
      ['摘要', 'Summary'],
      ['提取数据', 'Extract Data'],
      ['问答测验', 'Answer Quiz'],
      ['生成 FAQ', 'Generate FAQ'],
    ]);

    const replaceString = (value) => {
      if (!value) return value;
      let next = value;
      replacements.forEach((to, from) => {
        next = next.split(from).join(to);
      });
      next = next
        .replace(/例如：[^\n]+/g, 'Example: a five-episode folk suspense story with rule pressure and a clear visual production pipeline.')
        .replace(/第\s*(\d+)\s*集/g, 'Episode $1')
        .replace(/(\d+)\s*分钟/g, '$1 min')
        .replace(/AI短剧/g, 'AI Drama')
        .replace(/创作流程/g, 'Creative Flow')
        .replace(/剧本正文/g, 'Script Draft')
        .replace(/分镜大纲/g, 'Storyboard Outline')
        .replace(/AI 成片/g, 'AI Video')
        .replace(/设定区域/g, 'Settings Panel')
        .replace(/视频设置/g, 'Video Settings')
        .replace(/生成 AI/g, 'Generate with AI')
        .replace(/直接创建内容/g, 'Create Content')
        .replace(/设置/g, 'Settings')
        .replace(/AI\s*短剧/g, 'AI Drama')
        .replace(/为你的短剧创意[^\n。]*。?/g, 'Build a production-ready short-drama plan with AI.')
        .replace(/也可以直接粘贴小说或视频[^\n。]*。?/g, 'Paste a novel, synopsis, or scene idea to begin.')
        .replace(/也可以直接[^\n。]*小说[^\n。]*。?/g, 'You can also paste an existing novel, script, synopsis, or scene fragment.')
        .replace(/在正式开始创作前[^\n。]*。?/g, 'Before production starts, clarify the core idea, cast, structure, and ending hook.')
        .replace(/从概念到可执行的落地方案[^\n。]*。?/g, 'Turn the concept into an executable production plan.')
        .replace(/故事类型、核心梗、一句话故事、人物小传[^\n。]*。?/g, 'Genre, core hook, logline, characters, and story synopsis.')
        .replace(/按集输出简介、主事件、关系推进和结尾钩子[^\n。]*。?/g, 'Episode summaries, main events, relationship beats, and hooks.')
        .replace(/故事设定/g, 'Story Settings')
        .replace(/生成目标/g, 'Generation Goal')
        .replace(/生成脚本/g, 'Generate Script')
        .replace(/生成 AI/g, 'Generate with AI')
        .replace(/直接创建内容/g, 'Create Content')
        .replace(/[\u3400-\u9fff]+(?:[\s，。、：；/\-·（）()&+A-Za-z0-9]+[\u3400-\u9fff]+)*/g, 'AI Drama Studio');
      return next;
    };

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((node) => {
      node.nodeValue = replaceString(node.nodeValue || '');
    });

    document.querySelectorAll('input, textarea, button, [aria-label], [title]').forEach((el) => {
      for (const attr of ['placeholder', 'value', 'aria-label', 'title']) {
        const value = el.getAttribute(attr);
        if (value) el.setAttribute(attr, replaceString(value));
      }
    });
  });
}

async function captureFrames(page, frameDir, seconds = 5, fps = 24, actionFn) {
  fs.rmSync(frameDir, { recursive: true, force: true });
  fs.mkdirSync(frameDir, { recursive: true });
  const total = seconds * fps;
  let actionPromise = Promise.resolve();
  if (actionFn) actionPromise = actionFn(page).catch((err) => console.warn('action failed:', err.message));

  for (let i = 0; i < total; i++) {
    await applyEnglishCapturePolish(page);
    await page.screenshot({
      path: path.join(frameDir, `frame-${String(i).padStart(4, '0')}.png`),
      fullPage: false,
      animations: 'allow',
    });
    await page.waitForTimeout(1000 / fps);
  }
  await actionPromise;
}

function encodeVideo(frameDir, outFile, posterFile) {
  const vf = [
    'scale=960:600:force_original_aspect_ratio=increase',
    'crop=960:600',
    'format=yuv420p',
  ].join(',');
  const result = spawnSync('ffmpeg', [
    '-y',
    '-framerate', '24',
    '-i', path.join(frameDir, 'frame-%04d.png'),
    '-vf', vf,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-movflags', '+faststart',
    outFile,
  ], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`ffmpeg failed for ${outFile}`);
  const poster = spawnSync('ffmpeg', ['-y', '-i', outFile, '-frames:v', '1', posterFile], { stdio: 'inherit' });
  if (poster.status !== 0) throw new Error(`poster failed for ${posterFile}`);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(POSTER_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  for (const feature of features) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      locale: 'en-US',
      colorScheme: 'light',
    });
    await context.addInitScript(() => {
      localStorage.setItem('language', 'en');
      localStorage.setItem('languageSource', 'user');
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const url = `${BASE}${feature.route}`;
    console.log(`\n[capture] ${feature.id} ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await waitForUsefulPage(page, feature.waitText);
    await applyEnglishCapturePolish(page);
    await page.addStyleTag({ content: `
      * { caret-color: transparent !important; }
      html, body { background: #fff !important; overflow: hidden !important; }
      [data-nextjs-toast], nextjs-portal { display: none !important; }
    ` });
    const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 180);
    console.log(`[content] ${text}`);
    const frameDir = path.join(TMP_DIR, feature.id);
    await captureFrames(page, frameDir, 5, 24, feature.actions);
    encodeVideo(frameDir, path.join(OUT_DIR, `${feature.id}.mp4`), path.join(POSTER_DIR, `${feature.id}.png`));
    await page.close();
    await context.close();
  }

  await browser.close();
  console.log('\n[done] feature videos generated');
})();
