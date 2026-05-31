#!/usr/bin/env node
const { spawnSync } = require('node:child_process');

const matrix = [
  {
    name: 'gpt-search-clean-browser',
    env: { REAL_CHAT_MODEL: 'gpt-5.4-mini', REAL_CHAT_SEARCH: '1', REAL_CHAT_REASONING: '1', REAL_CHAT_REQUIRE_CLEAN_CONTENT: '1' },
  },
  {
    name: 'gemini-search-reasoning-browser',
    env: { REAL_CHAT_MODEL: 'gemini-3.1-pro-preview', REAL_CHAT_SEARCH: '1', REAL_CHAT_REASONING: '1', REAL_CHAT_REQUIRE_CLEAN_CONTENT: '1' },
  },
  {
    name: 'deepseek-clean-no-search',
    env: { REAL_CHAT_MODEL: process.env.REAL_CHAT_DEEPSEEK_MODEL || 'deepseek-v4-pro', REAL_CHAT_REASONING: '1', REAL_CHAT_REQUIRE_CLEAN_CONTENT: '1' },
    optional: process.env.REAL_CHAT_REQUIRE_DEEPSEEK === '1' ? false : true,
  },
  {
    name: 'deepseek-search-fallback-context',
    env: { REAL_CHAT_MODEL: process.env.REAL_CHAT_DEEPSEEK_MODEL || 'deepseek-v4-pro', REAL_CHAT_SEARCH: '1', REAL_CHAT_REASONING: '1', REAL_CHAT_REQUIRE_CLEAN_CONTENT: '1' },
    optional: process.env.REAL_CHAT_REQUIRE_DEEPSEEK_SEARCH === '1' ? false : true,
  },
];

const selectedNames = new Set((process.env.REAL_CHAT_MATRIX || '').split(',').map((s) => s.trim()).filter(Boolean));
const selected = selectedNames.size ? matrix.filter((item) => selectedNames.has(item.name)) : matrix;
if (selectedNames.size && selected.length !== selectedNames.size) {
  const known = new Set(matrix.map((item) => item.name));
  const unknown = [...selectedNames].filter((name) => !known.has(name));
  throw new Error(`unknown matrix item(s): ${unknown.join(', ')}`);
}

function parseSummary(output) {
  const marker = 'real chat e2e summary';
  const idx = output.lastIndexOf(marker);
  if (idx < 0) return null;
  const jsonStart = output.indexOf('{', idx);
  if (jsonStart < 0) return null;
  try {
    return JSON.parse(output.slice(jsonStart));
  } catch {
    return null;
  }
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
    timeout: Number(process.env.REAL_CHAT_MATRIX_TIMEOUT_MS || 180_000),
  });
  const output = `${child.stdout || ''}\n${child.stderr || ''}`;
  const summary = parseSummary(output);
  const passed = child.status === 0;
  if (!passed && !item.optional) failed = true;
  results.push({
    name: item.name,
    model: item.env.REAL_CHAT_MODEL,
    search: item.env.REAL_CHAT_SEARCH === '1',
    reasoning: item.env.REAL_CHAT_REASONING === '1',
    optional: Boolean(item.optional),
    passed,
    status: child.status,
    signal: child.signal || undefined,
    elapsedMs: Date.now() - started,
    contentLength: summary?.api?.contentLength,
    reasoningLength: summary?.api?.reasoningLength,
    streamDone: summary?.api?.streamDone,
    taskStatus: summary?.api?.taskStatus,
    persistedReasoningLength: summary?.api?.persistedReasoningLength,
    browserHistory: Boolean(summary?.browser?.historyContentOk),
    errorTail: passed ? undefined : output.slice(-1200),
  });
}

console.log(JSON.stringify({ ok: !failed, results }, null, 2));
if (failed) process.exit(1);
