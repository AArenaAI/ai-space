#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '../..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-generation-store-'));
const outFile = path.join(tempDir, 'chatConversationGenerationStore.cjs');
let source = fs.readFileSync(path.join(repoRoot, 'lib/chatConversationGenerationStore.ts'), 'utf8');
source = source.replace(/import type \{ Message \} from "@\/lib\/chatTypes";\n/g, '');
source = source.replace(/import \{ isMessageGenerating \} from "@\/lib\/chatContent";\n/g, `
function isMessageGenerating(msg, isStreaming) {
  if (isStreaming) return true;
  if (msg.serverGenerationStatus === 'completed' || msg.serverGenerationStatus === 'failed' || msg.serverGenerationStatus === 'cancelled' || msg.serverGenerationStatus === 'incomplete') return false;
  if (msg.completedAt || msg.stopped) return false;
  if (msg.activityStatus && (msg.activityStatus.status === 'running' || msg.activityStatus.status === 'searching')) return true;
  if (msg.searchStatus === 'searching') return true;
  if (msg.generationTaskId || msg.backgroundTaskId || msg.useBackground || msg.isComplexTask) return true;
  if (!String(msg.content || '').trim() && typeof msg.createdAt === 'number' && Date.now() - msg.createdAt < 8000) return true;
  return false;
}
`);
fs.writeFileSync(outFile, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText);
const store = require(outFile);

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

test('completed messages with generationTaskId are idle when no active stream/poller exists', () => {
  const state = store.inferConversationGenerationState({
    conversationId: 7,
    messages: [{ id: 'a', role: 'assistant', content: 'done', generationTaskId: 99, completedAt: 1000 }],
    hasActiveTaskStream: false,
    hasCurrentPoller: false,
    hasPendingLocalAssistant: false,
    hasMainStream: false,
    previous: { conversationId: 7, status: 'streaming', updatedAt: 1 },
    now: 2,
  });
  assert.equal(state.status, 'idle');
});

test('server terminal status overrides stale running activity and task ids', () => {
  assert.equal(typeof store.inferConversationGenerationState, 'function');
  const state = store.inferConversationGenerationState({
    conversationId: 7,
    messages: [{
      id: 'a',
      role: 'assistant',
      content: 'done',
      generationTaskId: 99,
      activityStatus: { status: 'running' },
      serverGenerationStatus: 'completed',
    }],
    hasActiveTaskStream: false,
    hasCurrentPoller: false,
    hasPendingLocalAssistant: false,
    hasMainStream: false,
    previous: { conversationId: 7, status: 'polling', updatedAt: 1 },
    now: 2,
  });
  assert.equal(state.status, 'idle');
});

test('terminal server status wins over stale current poller refs', () => {
  const state = store.inferConversationGenerationState({
    conversationId: 7,
    messages: [{
      id: 'a',
      role: 'assistant',
      content: 'done',
      generationTaskId: 99,
      serverGenerationStatus: 'completed',
    }],
    hasActiveTaskStream: false,
    hasCurrentPoller: true,
    hasPendingLocalAssistant: false,
    hasMainStream: false,
    previous: { conversationId: 7, status: 'polling', updatedAt: 1 },
    now: 2,
  });
  assert.equal(state.status, 'idle');
});

test('restored finished assistant content with stale search or reasoning activity is idle', () => {
  const state = store.inferConversationGenerationState({
    conversationId: 7,
    messages: [{
      id: 'a',
      role: 'assistant',
      content: '<think>done reasoning</think>\n\n今天是 2026 年 6 月 25 日。',
      activityStatus: { status: 'running' },
      searchStatus: 'searching',
    }],
    hasActiveTaskStream: false,
    hasCurrentPoller: false,
    hasPendingLocalAssistant: false,
    hasMainStream: false,
    previous: { conversationId: 7, status: 'streaming', updatedAt: 1 },
    now: 2,
  });
  assert.equal(state.status, 'idle');
});

test('stale poller cannot keep completed assistant content active without a task anchor', () => {
  const state = store.inferConversationGenerationState({
    conversationId: 7,
    messages: [{
      id: 'a',
      role: 'assistant',
      content: '<think>done reasoning</think>\n\n今天是 2026 年 6 月 26 日。',
      activityStatus: { status: 'running' },
      searchStatus: 'searching',
    }],
    hasActiveTaskStream: false,
    hasCurrentPoller: true,
    hasPendingLocalAssistant: false,
    hasMainStream: false,
    previous: { conversationId: 7, status: 'polling', updatedAt: 1 },
    now: 2,
  });
  assert.equal(state.status, 'idle');
});

test('explicit active task stream still wins for current conversation when message has a task anchor', () => {
  const state = store.inferConversationGenerationState({
    conversationId: 7,
    messages: [{ id: 'a', role: 'assistant', content: 'partial', generationTaskId: 99 }],
    hasActiveTaskStream: true,
    hasCurrentPoller: false,
    hasPendingLocalAssistant: false,
    hasMainStream: false,
    now: 2,
  });
  assert.equal(state.status, 'streaming');
});

console.log('chat conversation generation store regression passed');
fs.rmSync(tempDir, { recursive: true, force: true });
