#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(projectRoot, "lib/chatStreamRunResult.ts");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-stream-run-result-regression-"));
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
  const outPath = path.join(tmpDir, "chatStreamRunResult.cjs");
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

test("buildChatStreamRunResult preserves full stream metadata", () => {
  const groupContext = { groupId: 1, userMessageId: 2, groupModels: ["a", "b"] };
  assert.deepEqual(mod.buildChatStreamRunResult({
    groupContext,
    serverMessageId: 11,
    generationTaskId: 22,
    lastSequence: 33,
    content: "hello",
    fallbackContent: "fallback",
    useBackground: true,
    sawDone: true,
    recoverable: true,
  }), {
    groupContext,
    serverMessageId: 11,
    generationTaskId: 22,
    lastSequence: 33,
    content: "hello",
    useBackground: true,
    sawDone: true,
    recoverable: true,
  });
});

test("buildChatStreamRunResult uses fallback content only when content is undefined", () => {
  assert.equal(mod.buildChatStreamRunResult({ content: "", fallbackContent: "fallback" }).content, "");
  assert.equal(mod.buildChatStreamRunResult({ fallbackContent: "fallback" }).content, "fallback");
});

test("shouldRecoverStream recovers navigation disconnects with ids but not user stops", () => {
  assert.equal(mod.shouldRecoverStream({ sawDone: false, serverMessageId: 1 }), true);
  assert.equal(mod.shouldRecoverStream({ sawDone: false, generationTaskId: 2 }), true);
  assert.equal(mod.shouldRecoverStream({ sawDone: false }), false);
  assert.equal(mod.shouldRecoverStream({ sawDone: true, serverMessageId: 1 }), false);
  assert.equal(mod.shouldRecoverStream({ sawDone: false, abortReason: "navigation", serverMessageId: 1 }), true);
  assert.equal(mod.shouldRecoverStream({ sawDone: false, abortReason: "user", serverMessageId: 1 }), false);
});

test("shouldReconcileAfterDone only runs for background tasks after DONE with ids", () => {
  assert.equal(mod.shouldReconcileAfterDone({ sawDone: true, serverMessageId: 1 }), false);
  assert.equal(mod.shouldReconcileAfterDone({ sawDone: true, serverMessageId: 1, useBackground: true }), true);
  assert.equal(mod.shouldReconcileAfterDone({ sawDone: true, generationTaskId: 2, useBackground: true }), true);
  assert.equal(mod.shouldReconcileAfterDone({ sawDone: true, useBackground: true }), false);
  assert.equal(mod.shouldReconcileAfterDone({ sawDone: false, serverMessageId: 1, useBackground: true }), false);
  assert.equal(mod.shouldReconcileAfterDone({ sawDone: true, abortReason: "navigation", serverMessageId: 1, useBackground: true }), false);
});

test("shouldCompleteUnrecoverablePartial only completes content without recovery ids", () => {
  assert.equal(mod.shouldCompleteUnrecoverablePartial({ sawDone: false, hasContent: true }), true);
  assert.equal(mod.shouldCompleteUnrecoverablePartial({ sawDone: false, hasContent: true, serverMessageId: 1 }), false);
  assert.equal(mod.shouldCompleteUnrecoverablePartial({ sawDone: false, hasContent: true, generationTaskId: 2 }), false);
  assert.equal(mod.shouldCompleteUnrecoverablePartial({ sawDone: true, hasContent: true }), false);
  assert.equal(mod.shouldCompleteUnrecoverablePartial({ sawDone: false, hasContent: false }), false);
  assert.equal(mod.shouldCompleteUnrecoverablePartial({ sawDone: false, hasContent: true, abortReason: "user" }), false);
  assert.equal(mod.shouldCompleteUnrecoverablePartial({ sawDone: false, hasContent: true, abortReason: "navigation" }), false);
});

test("shouldMarkCompleted requires DONE, content and non-abort reason", () => {
  assert.equal(mod.shouldMarkCompleted({ sawDone: true, hasFinalContent: true }), true);
  assert.equal(mod.shouldMarkCompleted({ sawDone: true, hasFinalContent: false }), false);
  assert.equal(mod.shouldMarkCompleted({ sawDone: false, hasFinalContent: true }), false);
  assert.equal(mod.shouldMarkCompleted({ sawDone: true, hasFinalContent: true, abortReason: "user" }), false);
  assert.equal(mod.shouldMarkCompleted({ sawDone: true, hasFinalContent: true, abortReason: "navigation" }), false);
});

console.log("\nchat stream run result regression tests passed");
process.exit(0);
