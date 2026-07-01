#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '../..');
const sourcePath = path.join(projectRoot, 'lib/chatPageState.ts');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-page-state-'));
const tmpFile = path.join(tmpDir, 'chatPageState.cjs');
const source = fs.readFileSync(sourcePath, 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, strict: true },
  fileName: sourcePath,
}).outputText;
fs.writeFileSync(tmpFile, output);
const { deriveChatPageState, shouldShowConversationShell } = require(tmpFile);

function error(status) {
  const err = new Error(String(status));
  err.status = status;
  return err;
}

assert.equal(deriveChatPageState({ conversationId: undefined, bootstrap: { status: 'idle' } }), 'new-chat');
assert.equal(deriveChatPageState({ conversationId: 7, bootstrap: { status: 'idle' } }), 'conversation-loading');
assert.equal(deriveChatPageState({ conversationId: 7, bootstrap: { status: 'loading' } }), 'conversation-loading');
assert.equal(deriveChatPageState({ conversationId: 7, bootstrap: { status: 'ready' } }), 'conversation-ready');
assert.equal(deriveChatPageState({ conversationId: 7, bootstrap: { status: 'anonymous' } }), 'anonymous');
assert.equal(deriveChatPageState({ conversationId: 7, bootstrap: { status: 'failed', error: error(404) } }), 'conversation-not-found');
assert.equal(deriveChatPageState({ conversationId: 7, bootstrap: { status: 'failed', error: error(403) } }), 'conversation-forbidden');
assert.equal(deriveChatPageState({ conversationId: 7, bootstrap: { status: 'failed', error: error(500) } }), 'conversation-error');
assert.equal(deriveChatPageState({ conversationId: 7, bootstrap: { status: 'failed', error: new Error('network') } }), 'conversation-error');

assert.equal(shouldShowConversationShell('conversation-loading'), true);
assert.equal(shouldShowConversationShell('conversation-revalidating'), true);
assert.equal(shouldShowConversationShell('conversation-error'), false);
assert.equal(shouldShowConversationShell('conversation-not-found'), false);
assert.equal(shouldShowConversationShell('new-chat'), false);

console.log('chat page state regression passed');
