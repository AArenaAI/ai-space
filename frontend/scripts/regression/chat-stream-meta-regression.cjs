#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(projectRoot, "lib/chatStreamMeta.ts");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-stream-meta-regression-"));
  const source = fs.readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      strict: true,
    },
    fileName: sourcePath,
  }).outputText;
  const outPath = path.join(tmpDir, "chatStreamMeta.cjs");
  fs.writeFileSync(outPath, transpiled);
  return require(outPath);
}

const mod = loadModule();

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

test("normalizes chat meta", () => {
  assert.deepEqual(mod.normalizeChatStreamPayload({ _chat_meta: { request_id: "req_1" } }), {
    type: "chat_meta",
    meta: { request_id: "req_1" },
    requestId: "req_1",
  });
});

test("normalizes generation task before delta", () => {
  const task = { id: 12, assistant_message_id: 34 };
  assert.deepEqual(mod.normalizeChatStreamPayload({ _generation_task: task, choices: [{ delta: { content: "x" } }] }), {
    type: "generation_task",
    task,
  });
});

test("normalizes background task", () => {
  const task = { id: "bg", assistant_message_id: 34 };
  assert.deepEqual(mod.normalizeChatStreamPayload({ _background_task: task }), {
    type: "background_task",
    task,
  });
});

test("normalizes provider error metadata", () => {
  assert.deepEqual(mod.normalizeChatStreamPayload({ _error_meta: { user_message: "限流", error_code: "rate_limit", retriable: true, request_id: "r" } }), {
    type: "error",
    error: { user_message: "限流", error_code: "rate_limit", retriable: true, request_id: "r" },
    message: "限流",
    errorCode: "rate_limit",
    retryable: true,
    requestId: "r",
  });
});

test("normalizes legacy error", () => {
  const result = mod.normalizeChatStreamPayload({ _error: { message: "boom", code: "bad", retryable: false } });
  assert.equal(result.type, "error");
  assert.equal(result.message, "boom");
  assert.equal(result.errorCode, "bad");
  assert.equal(result.retryable, false);
});

test("normalizes activity and search metadata", () => {
  assert.deepEqual(mod.normalizeChatStreamPayload({ _activity_meta: { kind: "web_search", status: "running" } }), {
    type: "activity",
    meta: { kind: "web_search", status: "running" },
  });
  assert.deepEqual(mod.normalizeChatStreamPayload({ _search_meta: { status: "completed", sources: [] } }), {
    type: "search",
    meta: { status: "completed", sources: [] },
  });
});

test("falls back to choices delta", () => {
  assert.deepEqual(mod.normalizeChatStreamPayload({ choices: [{ delta: { content: "hello", reasoning: "plan" } }] }), {
    type: "delta",
    rawDelta: { content: "hello", reasoning: "plan" },
  });
});

test("missing choices returns empty delta object", () => {
  assert.deepEqual(mod.normalizeChatStreamPayload({}), {
    type: "delta",
    rawDelta: {},
  });
});

console.log("\nchat stream meta regression tests passed");
process.exit(0);
