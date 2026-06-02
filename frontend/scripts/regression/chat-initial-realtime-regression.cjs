#!/usr/bin/env node
const assert = require('node:assert/strict');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = function registerTs(module, filename) {
  const source = require('node:fs').readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

global.requestAnimationFrame = global.requestAnimationFrame || ((callback) => setTimeout(() => callback(Date.now()), 0));
global.cancelAnimationFrame = global.cancelAnimationFrame || ((id) => clearTimeout(id));

const projectRoot = path.resolve(__dirname, '../..');
const { initializeAssistantRealtime, initializeAssistantRealtimeBatch } = require(path.join(projectRoot, 'lib/chatInitialRealtime.ts'));
const { realtimeGet, realtimeClear } = require(path.join(projectRoot, 'lib/streaming.ts'));

realtimeClear('init-1');
initializeAssistantRealtime('init-1', 1234);
assert.deepEqual({
  phase: realtimeGet('init-1')?.phase,
  generationStartedAt: realtimeGet('init-1')?.generationStartedAt,
  content: realtimeGet('init-1')?.content,
  answerContent: realtimeGet('init-1')?.answerContent,
  reasoningContent: realtimeGet('init-1')?.reasoningContent,
}, {
  phase: 'waiting_provider',
  generationStartedAt: 1234,
  content: '',
  answerContent: '',
  reasoningContent: '',
});

realtimeClear('init-2');
realtimeClear('init-3');
initializeAssistantRealtimeBatch([{ id: 'init-2', createdAt: 2000 }, { id: 'init-3' }], 3000);
assert.equal(realtimeGet('init-2')?.generationStartedAt, 2000);
assert.equal(realtimeGet('init-3')?.generationStartedAt, 3000);
assert.equal(realtimeGet('init-2')?.phase, 'waiting_provider');
assert.equal(realtimeGet('init-3')?.phase, 'waiting_provider');

realtimeClear('init-1');
realtimeClear('init-2');
realtimeClear('init-3');
console.log('chat initial realtime regression tests passed');
