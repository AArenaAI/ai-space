#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '../..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-bootstrap-task-resume-'));
const sourcePath = path.join(repoRoot, 'lib/chatBootstrapTaskResume.ts');
const tmpFile = path.join(tmpRoot, 'chatBootstrapTaskResume.cjs');
const transformed = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
fs.writeFileSync(tmpFile, transformed);
const { buildBootstrapTaskResumePlan } = require(tmpFile);

function assistant(id, serverMessageId, content = '') {
  return { id, role: 'assistant', content, createdAt: 1, serverMessageId };
}

function testBuildsResumePlanForMatchingAssistant() {
  const resumed = new Set();
  const plan = buildBootstrapTaskResumePlan({
    alreadyResumedTaskIds: resumed,
    messages: [assistant('local-a', 101, 'hello')],
    activeTasks: [{ id: 7, conversation_id: 762, assistant_message_id: 101, status: 'running', last_sequence_number: 12, updated_at: 'now' }],
  });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].task.id, 7);
  assert.equal(plan[0].message.id, 'local-a');
  assert.equal(plan[0].after, 12);
  assert.equal(plan[0].initialContent, 'hello');
}

function testSkipsCompletedMissingAndAlreadyResumedTasks() {
  const plan = buildBootstrapTaskResumePlan({
    alreadyResumedTaskIds: new Set([8]),
    messages: [assistant('local-a', 101, 'hello')],
    activeTasks: [
      { id: 8, conversation_id: 762, assistant_message_id: 101, status: 'running', last_sequence_number: 1, updated_at: 'now' },
      { id: 9, conversation_id: 762, assistant_message_id: 101, status: 'completed', last_sequence_number: 2, updated_at: 'now' },
      { id: 10, conversation_id: 762, assistant_message_id: 999, status: 'streaming', last_sequence_number: 3, updated_at: 'now' },
    ],
  });
  assert.equal(plan.length, 0);
}

function testAllowsRunningStreamingAndRetryingOnly() {
  const plan = buildBootstrapTaskResumePlan({
    alreadyResumedTaskIds: new Set(),
    messages: [assistant('local-a', 101), assistant('local-b', 102)],
    activeTasks: [
      { id: 11, conversation_id: 762, assistant_message_id: 101, status: 'retrying', last_sequence_number: 0, updated_at: 'now' },
      { id: 12, conversation_id: 762, assistant_message_id: 102, status: 'streaming', last_sequence_number: 4, updated_at: 'now' },
      { id: 13, conversation_id: 762, assistant_message_id: 102, status: 'incomplete', last_sequence_number: 5, updated_at: 'now' },
    ],
  });
  assert.deepEqual(plan.map((item) => item.task.id), [11, 12]);
  assert.deepEqual(plan.map((item) => item.after), [0, 4]);
}

testBuildsResumePlanForMatchingAssistant();
testSkipsCompletedMissingAndAlreadyResumedTasks();
testAllowsRunningStreamingAndRetryingOnly();
console.log('chat bootstrap task resume regression passed');
