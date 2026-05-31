#!/usr/bin/env node
const { spawnSync } = require('node:child_process');

const scenarios = [
  {
    name: 'file-current-turn',
    env: {
      REAL_CHAT_MODEL: process.env.REAL_CHAT_FILE_MODEL || 'gpt-5.4-mini',
      REAL_CHAT_PROMPT: '真实E2E文件验证：请只根据附件内容回答，输出 AI_SPACE_FILE_OK 和数字 314。',
      REAL_CHAT_EXPECT: 'AI_SPACE_FILE_OK[\\s\\S]*314',
      REAL_CHAT_ATTACH_TEXT_FILE: '1',
      REAL_CHAT_FILE_NAME: 'ai-space-real-e2e.txt',
      REAL_CHAT_FILE_CONTENT: '附件事实：请在回答中输出 AI_SPACE_FILE_OK 和数字 314。',
      REAL_CHAT_BROWSER: '0',
    },
  },
  {
    name: 'stop-task-cancel',
    env: {
      REAL_CHAT_MODEL: process.env.REAL_CHAT_STOP_MODEL || 'gpt-5.4-mini',
      REAL_CHAT_PROMPT: '真实E2E停止验证：请输出一个较长回答，分 20 点说明，每点包含 STOP_E2E_MARKER。',
      REAL_CHAT_EXPECT: 'STOP_E2E_MARKER',
      REAL_CHAT_CANCEL_AFTER_TASK: '1',
      REAL_CHAT_SKIP_COMPLETED_ASSERT: '1',
      REAL_CHAT_BROWSER: '0',
      REAL_CHAT_TIMEOUT_MS: '120000',
    },
    optional: process.env.REAL_CHAT_REQUIRE_STOP === '1' ? false : true,
  },
  {
    name: 'compare-two-models',
    env: {
      REAL_CHAT_MODEL: process.env.REAL_CHAT_COMPARE_MODEL || 'gpt-5.4-mini',
      REAL_CHAT_COMPARE_MODELS: process.env.REAL_CHAT_COMPARE_MODELS || 'gpt-5.4-mini,gemini-3.1-flash',
      REAL_CHAT_COMPARE_QUERY: '真实E2E compare 验证：请只回答 COMPARE_OK 和数字 2718。',
      REAL_CHAT_EXPECT: 'COMPARE_OK[\\s\\S]*2718',
      REAL_CHAT_MODE: 'compare',
      REAL_CHAT_BROWSER: '0',
    },
    optional: process.env.REAL_CHAT_REQUIRE_COMPARE === '1' ? false : true,
  },
  {
    name: 'task-recovery-stream-after',
    env: {
      REAL_CHAT_MODEL: process.env.REAL_CHAT_TASK_MODEL || 'gpt-5.4-mini',
      REAL_CHAT_PROMPT: '真实E2E任务恢复验证：请回答 TASK_RECOVERY_OK 和数字 1618，并保持简短。',
      REAL_CHAT_EXPECT: 'TASK_RECOVERY_OK[\\s\\S]*1618',
      REAL_CHAT_TASK_RECOVERY_AFTER: '1',
      REAL_CHAT_BROWSER: '0',
    },
  },
];

const selectedNames = new Set((process.env.REAL_CHAT_EXTRA || '').split(',').map((s) => s.trim()).filter(Boolean));
const selected = selectedNames.size ? scenarios.filter((item) => selectedNames.has(item.name)) : scenarios;
if (selectedNames.size && selected.length !== selectedNames.size) {
  const known = new Set(scenarios.map((item) => item.name));
  const unknown = [...selectedNames].filter((name) => !known.has(name));
  throw new Error(`unknown scenario(s): ${unknown.join(', ')}`);
}

const results = [];
let failed = false;
for (const item of selected) {
  const started = Date.now();
  const child = spawnSync(process.execPath, ['scripts/regression/chat-real-e2e.cjs'], {
    cwd: process.cwd(),
    env: { ...process.env, ...item.env },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 5,
    timeout: Number(process.env.REAL_CHAT_EXTRA_TIMEOUT_MS || 180_000),
  });
  const output = `${child.stdout || ''}\n${child.stderr || ''}`;
  const passed = child.status === 0;
  if (!passed && !item.optional) failed = true;
  results.push({
    name: item.name,
    optional: Boolean(item.optional),
    passed,
    status: child.status,
    signal: child.signal || undefined,
    elapsedMs: Date.now() - started,
    errorTail: passed ? undefined : output.slice(-1200),
  });
}
console.log(JSON.stringify({ ok: !failed, results }, null, 2));
if (failed) process.exit(1);
