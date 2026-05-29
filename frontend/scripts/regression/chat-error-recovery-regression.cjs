#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(projectRoot, "lib/chatErrorRecovery.ts");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-error-recovery-regression-"));
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
  const outPath = path.join(tmpDir, "chatErrorRecovery.cjs");
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

test("isBackgroundGenerationModel matches gpt-5.5-pro variants only", () => {
  assert.equal(mod.isBackgroundGenerationModel(undefined), false);
  assert.equal(mod.isBackgroundGenerationModel("gpt-5.5"), false);
  assert.equal(mod.isBackgroundGenerationModel("gpt-5.5-pro"), true);
  assert.equal(mod.isBackgroundGenerationModel("gpt-5.5-pro-heavy"), true);
});

test("hasRecoverableStreamState accepts server message id", () => {
  assert.equal(mod.hasRecoverableStreamState({ serverMessageId: 7 }), true);
});

test("hasRecoverableStreamState accepts generation task id", () => {
  assert.equal(mod.hasRecoverableStreamState({ generationTaskId: 42 }), true);
});

test("hasRecoverableStreamState accepts existing task stream or poller", () => {
  assert.equal(mod.hasRecoverableStreamState({ hasTaskStream: true }), true);
  assert.equal(mod.hasRecoverableStreamState({ hasBackgroundPoller: true }), true);
  assert.equal(mod.hasRecoverableStreamState({}), false);
});

test("shouldRecoverCompareRun recovers when any stream state exists", () => {
  assert.equal(mod.shouldRecoverCompareRun({ serverMessageId: 1, model: "plain" }), true);
  assert.equal(mod.shouldRecoverCompareRun({ hasTaskStream: true, model: "plain" }), true);
});

test("shouldRecoverCompareRun recovers background model only with conversation id", () => {
  assert.equal(mod.shouldRecoverCompareRun({ model: "gpt-5.5-pro", conversationId: 0 }), false);
  assert.equal(mod.shouldRecoverCompareRun({ model: "gpt-5.5-pro", conversationId: 12 }), true);
  assert.equal(mod.shouldRecoverCompareRun({ model: "gpt-5.5", conversationId: 12 }), false);
});

test("shouldIgnoreStreamAbort ignores user and navigation aborts only", () => {
  assert.equal(mod.shouldIgnoreStreamAbort({ isAbort: false, abortReason: "user" }), false);
  assert.equal(mod.shouldIgnoreStreamAbort({ isAbort: true, abortReason: "user" }), true);
  assert.equal(mod.shouldIgnoreStreamAbort({ isAbort: true, abortReason: "navigation" }), true);
  assert.equal(mod.shouldIgnoreStreamAbort({ isAbort: true, abortReason: "timeout" }), false);
});

test("shouldResumeTaskStreamAfterError skips ignored aborts", () => {
  assert.equal(mod.shouldResumeTaskStreamAfterError({ isAbort: true, abortReason: "user", serverMessageId: 1 }), false);
  assert.equal(mod.shouldResumeTaskStreamAfterError({ isAbort: true, abortReason: "navigation", generationTaskId: 9 }), false);
});

test("shouldResumeTaskStreamAfterError resumes when ids exist after non-ignored error", () => {
  assert.equal(mod.shouldResumeTaskStreamAfterError({ isAbort: false, abortReason: null, serverMessageId: 1 }), true);
  assert.equal(mod.shouldResumeTaskStreamAfterError({ isAbort: true, abortReason: "network", generationTaskId: 9 }), true);
  assert.equal(mod.shouldResumeTaskStreamAfterError({ isAbort: false, abortReason: null }), false);
});

test("resolveRecoveryIds prefers stream result ids over realtime ids", () => {
  assert.deepEqual(mod.resolveRecoveryIds({
    streamServerMessageId: 2,
    realtimeServerMessageId: 1,
    streamGenerationTaskId: 20,
    realtimeGenerationTaskId: 10,
  }), { serverMessageId: 2, generationTaskId: 20 });
});

test("resolveRecoveryIds falls back to realtime ids", () => {
  assert.deepEqual(mod.resolveRecoveryIds({
    realtimeServerMessageId: 1,
    realtimeGenerationTaskId: 10,
  }), { serverMessageId: 1, generationTaskId: 10 });
});

console.log("\nchat error recovery regression tests passed");
process.exit(0);
