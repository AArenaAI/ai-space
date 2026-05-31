#!/usr/bin/env node
const { spawnSync } = require('node:child_process');

const matrix = [
  {
    name: 'gpt-search-clean-browser',
    env: { REAL_CHAT_MODEL: 'gpt-5.4-mini', REAL_CHAT_SEARCH: '1', REAL_CHAT_REASONING: '1', REAL_CHAT_REQUIRE_CLEAN_CONTENT: '1' },
  },
  {
    name: 'gemini-search-reasoning-browser',
    env: { REAL_CHAT_MODEL: 'gemini-3.1-pro-preview', REAL_CHAT_SEARCH: '1', REAL_CHAT_REASONING: '1', REAL_CHAT_REQUIRE_STREAM_REASONING: '1', REAL_CHAT_REQUIRE_PERSISTED_REASONING: '1', REAL_CHAT_REQUIRE_CLEAN_CONTENT: '1' },
  },
  {
    name: 'deepseek-clean-no-search',
    env: { REAL_CHAT_MODEL: process.env.REAL_CHAT_DEEPSEEK_MODEL || 'deepseek-v4-pro', REAL_CHAT_REASONING: '1', REAL_CHAT_REQUIRE_CLEAN_CONTENT: '1' },
    optional: process.env.REAL_CHAT_REQUIRE_DEEPSEEK === '1' ? false : true,
  },
];

const selected = (process.env.REAL_CHAT_MATRIX || '').split(',').map((s) => s.trim()).filter(Boolean);
const results = [];
let hardFailure = false;

for (const item of matrix) {
  if (selected.length && !selected.includes(item.name)) continue;
  const env = { ...process.env, ...item.env };
  const started = Date.now();
  const child = spawnSync(process.execPath, ['scripts/regression/chat-real-e2e.cjs'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 8,
    timeout: Number(process.env.REAL_CHAT_MATRIX_TIMEOUT_MS || 360000),
  });
  const output = `${child.stdout || ''}\n${child.stderr || ''}`;
  const passed = child.status === 0;
  const summary = {
    name: item.name,
    model: item.env.REAL_CHAT_MODEL,
    search: item.env.REAL_CHAT_SEARCH === '1',
    reasoning: item.env.REAL_CHAT_REASONING === '1',
    optional: !!item.optional,
    passed,
    status: child.status,
    elapsedMs: Date.now() - started,
  };
  const jsonMatch = output.match(/\{[\s\S]*?\n\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      summary.contentLength = parsed.contentLength;
      summary.reasoningLength = parsed.reasoningLength;
      summary.streamDone = parsed.streamDone;
      summary.taskStatus = parsed.taskStatus;
      summary.persistedReasoningLength = parsed.persistedReasoningLength;
      summary.browserHistory = !!parsed.browserHistory;
    } catch {}
  }
  if (!passed) {
    summary.errorTail = output.slice(-1200);
    if (!item.optional) hardFailure = true;
  }
  results.push(summary);
}

console.log(JSON.stringify({ ok: !hardFailure, results }, null, 2));
if (hardFailure) process.exit(1);
