#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "../..");
const sourceFile = path.join(repoRoot, "lib/chatLocalActionCoordinator.ts");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-local-action-coordinator-"));
const outFile = path.join(tempDir, "chatLocalActionCoordinator.cjs");
const source = fs.readFileSync(sourceFile, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
    skipLibCheck: true,
  },
  fileName: sourceFile,
});
fs.writeFileSync(outFile, compiled.outputText);

const {
  appendCreateConversationFailureMessage,
  buildClearMessagesState,
  buildCreateConversationFailureMessage,
  buildRegenerateRequest,
  deleteMessageById,
  findLastUserMessage,
  switchGroupView,
} = require(outFile);

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("buildCreateConversationFailureMessage returns stable assistant placeholder", () => {
  assert.deepEqual(
    buildCreateConversationFailureMessage({ id: "m1", modelId: "gpt-x", createdAt: 123 }),
    {
      id: "m1",
      role: "assistant",
      content: "❌ 创建对话失败，请检查登录状态或刷新页面重试",
      model: "gpt-x",
      createdAt: 123,
    }
  );
});

test("appendCreateConversationFailureMessage appends without mutating previous", () => {
  const previous = [{ id: "u1", role: "user", content: "hi", createdAt: 1 }];
  const failure = buildCreateConversationFailureMessage({ id: "a1", modelId: "m", createdAt: 2 });
  const next = appendCreateConversationFailureMessage(previous, failure);
  assert.equal(previous.length, 1);
  assert.equal(next.length, 2);
  assert.equal(next[1], failure);
});

test("buildClearMessagesState clears messages and conversation id", () => {
  assert.deepEqual(buildClearMessagesState(), { messages: [], currentConversation: undefined });
});

test("deleteMessageById filters only matching id", () => {
  const messages = [
    { id: "1", role: "user", content: "a" },
    { id: "2", role: "assistant", content: "b" },
    { id: "1", role: "assistant", content: "duplicate" },
  ];
  assert.deepEqual(deleteMessageById(messages, "1"), [{ id: "2", role: "assistant", content: "b" }]);
});

test("findLastUserMessage walks backward", () => {
  const messages = [
    { id: "u1", role: "user", content: "old" },
    { id: "a1", role: "assistant", content: "answer" },
    { id: "u2", role: "user", content: "latest" },
  ];
  assert.deepEqual(findLastUserMessage(messages), { id: "u2", role: "user", content: "latest" });
});

test("buildRegenerateRequest returns last user content", () => {
  const request = buildRegenerateRequest([
    { role: "assistant", content: "ignored" },
    { role: "user", content: "again" },
  ]);
  assert.deepEqual(request, { content: "again", shouldRegenerate: true });
});

test("buildRegenerateRequest returns undefined without user message", () => {
  assert.equal(buildRegenerateRequest([{ role: "assistant", content: "only" }]), undefined);
});

test("switchGroupView returns a new map and preserves old entries", () => {
  const previous = new Map([[1, 0]]);
  const next = switchGroupView(previous, 2, 3);
  assert.notEqual(next, previous);
  assert.equal(previous.has(2), false);
  assert.equal(next.get(1), 0);
  assert.equal(next.get(2), 3);
});

(async () => {
  try {
    for (const entry of tests) {
      await entry.fn();
      console.log(`✓ ${entry.name}`);
    }
    console.log(`chat local action coordinator regression passed (${tests.length} tests)`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
