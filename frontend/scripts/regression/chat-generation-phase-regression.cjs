#!/usr/bin/env node
const assert = require('node:assert/strict');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = function registerTs(module, filename) {
  const source = require('node:fs').readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const phase = require(path.join(__dirname, '../../lib/chatGenerationPhase.ts'));

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

test('streaming without metadata shows waiting_provider', () => {
  assert.equal(phase.deriveUserGenerationPhase(undefined, true), 'waiting_provider');
});

test('searching has priority before reasoning and content', () => {
  assert.equal(phase.deriveUserGenerationPhase({ searchStatus: 'searching', reasoningContent: 'x', answerContent: 'y' }, true), 'searching');
});

test('reasoning empty string is still a reasoning phase before answer', () => {
  assert.equal(phase.deriveUserGenerationPhase({ reasoningContent: '', answerContent: '' }, true), 'reasoning');
});

test('answer content derives streaming_answer', () => {
  assert.equal(phase.deriveUserGenerationPhase({ answerContent: 'hello' }, true), 'streaming_answer');
});

test('explicit finalizing phase is preserved while running', () => {
  assert.equal(phase.deriveUserGenerationPhase({ phase: 'finalizing' }, true), 'finalizing');
});

test('completed entries do not show a running phase', () => {
  assert.equal(phase.deriveUserGenerationPhase({ phase: 'completed', completedAt: Date.now(), answerContent: 'done' }, false), undefined);
});

test('elapsed time uses seconds and minute format', () => {
  assert.equal(phase.formatElapsedTime(0), '0秒');
  assert.equal(phase.formatElapsedTime(29_999), '29秒');
  assert.equal(phase.formatElapsedTime(65_000), '1分05秒');
});

test('status label interpolates elapsed time', () => {
  const dict = {
    'chat.phase.streaming_answer': '正在生成回答',
    'chat.phase.withElapsed': '{status} · 已用时 {elapsed}',
  };
  const t = (key, params) => {
    let text = dict[key] || key;
    for (const [k, v] of Object.entries(params || {})) text = text.replaceAll(`{${k}}`, v);
    return text;
  };
  assert.equal(phase.getGenerationPhaseWithElapsedLabel(t, 'streaming_answer', 12_000), '正在生成回答 · 已用时 12秒');
});

console.log('\nchat generation phase regression tests passed');
