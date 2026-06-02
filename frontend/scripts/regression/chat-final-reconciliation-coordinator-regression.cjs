#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-final-reconciliation-coordinator-regression-"));
  for (const name of ["chatStreamRunResult", "chatFinalReconciliationCoordinator"]) {
    const source = fs.readFileSync(path.join(projectRoot, `lib/${name}.ts`), "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, strict: true },
      fileName: path.join(projectRoot, `lib/${name}.ts`),
    }).outputText;
    fs.writeFileSync(path.join(tmpDir, `${name}.js`), output);
  }
  return require(path.join(tmpDir, "chatFinalReconciliationCoordinator.js"));
}

const {
  resolveFinalStreamContent,
  shouldSyncFinalRealtimeData,
  buildFinalStreamRunResult,
  decideFinalStreamReconciliation,
} = loadModule();

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const baseState = {
  groupContext: { groupId: 1, userMessageId: 2, groupModels: ["m1", "m2"] },
  serverMessageId: 9,
  generationTaskId: 5,
  lastSequence: 12,
  accumulated: "accumulated",
  useBackground: false,
  sawDone: false,
  recoverable: false,
};

test("resolveFinalStreamContent prefers non-empty stream content and falls back to accumulated", () => {
  assert.equal(resolveFinalStreamContent({ streamContent: "stream", accumulated: "acc" }), "stream");
  assert.equal(resolveFinalStreamContent({ streamContent: "", accumulated: "acc" }), "acc");
  assert.equal(resolveFinalStreamContent({ streamContent: undefined, accumulated: "acc" }), "acc");
});

test("shouldSyncFinalRealtimeData follows final content or realtime presence", () => {
  assert.equal(shouldSyncFinalRealtimeData({ finalContent: "hello", hasRealtimeData: false }), true);
  assert.equal(shouldSyncFinalRealtimeData({ finalContent: "", hasRealtimeData: true }), true);
  assert.equal(shouldSyncFinalRealtimeData({ finalContent: "", hasRealtimeData: false }), false);
});

test("buildFinalStreamRunResult preserves metadata and explicit final content", () => {
  const result = buildFinalStreamRunResult({ state: baseState, finalContent: "final" });
  assert.deepEqual(result, {
    groupContext: baseState.groupContext,
    serverMessageId: 9,
    generationTaskId: 5,
    lastSequence: 12,
    content: "final",
    useBackground: false,
    sawDone: false,
    recoverable: false,
  });
});

test("recover action before DONE starts task stream and optional background polling", () => {
  const action = decideFinalStreamReconciliation({
    state: { ...baseState, useBackground: true, sawDone: false },
    abortReason: null,
    streamContent: "partial",
    hasRealtimeData: true,
  });
  assert.equal(action.type, "recover");
  assert.equal(action.shouldSyncFinalData, true);
  assert.equal(action.finalContent, "partial");
  assert.equal(action.serverMessageId, 9);
  assert.equal(action.generationTaskId, 5);
  assert.equal(action.lastSequence, 12);
  assert.equal(action.shouldStartBackgroundPolling, true);
  assert.equal(action.result.content, "partial");
});

test("recover action does not start background polling without server id or background flag", () => {
  const noBackground = decideFinalStreamReconciliation({
    state: { ...baseState, useBackground: false, sawDone: false },
    abortReason: null,
    streamContent: "partial",
    hasRealtimeData: false,
  });
  assert.equal(noBackground.type, "recover");
  assert.equal(noBackground.shouldStartBackgroundPolling, false);

  const noServer = decideFinalStreamReconciliation({
    state: { ...baseState, serverMessageId: undefined, useBackground: true, sawDone: false },
    abortReason: null,
    streamContent: "partial",
    hasRealtimeData: false,
  });
  assert.equal(noServer.type, "recover");
  assert.equal(noServer.shouldStartBackgroundPolling, false);
});

test("reconcile_after_done action starts DB polling after DONE with server id", () => {
  const action = decideFinalStreamReconciliation({
    state: { ...baseState, sawDone: true },
    abortReason: null,
    streamContent: "done text",
    hasRealtimeData: false,
  });
  assert.equal(action.type, "reconcile_after_done");
  assert.equal(action.shouldStartBackgroundPolling, true);
  assert.equal(action.serverMessageId, 9);
  assert.equal(action.result.sawDone, true);
  assert.equal(action.result.content, "done text");
});

test("navigation abort before DONE recovers task stream while user abort stops", () => {
  const navigationAction = decideFinalStreamReconciliation({
    state: { ...baseState, sawDone: false },
    abortReason: "navigation",
    streamContent: "partial",
    hasRealtimeData: true,
  });
  assert.equal(navigationAction.type, "recover");
  assert.equal(navigationAction.serverMessageId, 9);
  assert.equal(navigationAction.generationTaskId, 5);
  assert.equal(navigationAction.lastSequence, 12);
  assert.equal(navigationAction.finalContent, "partial");

  const userAction = decideFinalStreamReconciliation({
    state: { ...baseState, sawDone: false },
    abortReason: "user",
    streamContent: "partial",
    hasRealtimeData: false,
  });
  assert.equal(userAction.type, "complete_or_cleanup");
  assert.equal(userAction.shouldMarkCompleted, false);
});

test("navigation/user abort after DONE still skips completed mark", () => {
  for (const abortReason of ["navigation", "user"]) {
    const action = decideFinalStreamReconciliation({
      state: { ...baseState, sawDone: true },
      abortReason,
      streamContent: "final",
      hasRealtimeData: false,
    });
    assert.equal(action.type, "complete_or_cleanup");
    assert.equal(action.shouldClearStores, true);
    assert.equal(action.shouldMarkCompleted, false);
  }
});

test("complete_or_cleanup marks completed only after DONE with final content", () => {
  const completed = decideFinalStreamReconciliation({
    state: { ...baseState, serverMessageId: undefined, generationTaskId: undefined, sawDone: true },
    abortReason: null,
    streamContent: " final ",
    hasRealtimeData: false,
  });
  assert.equal(completed.type, "complete_or_cleanup");
  assert.equal(completed.shouldClearStores, true);
  assert.equal(completed.shouldMarkCompleted, true);

  const noContent = decideFinalStreamReconciliation({
    state: { ...baseState, serverMessageId: undefined, generationTaskId: undefined, sawDone: true, accumulated: "" },
    abortReason: null,
    streamContent: "",
    hasRealtimeData: false,
  });
  assert.equal(noContent.shouldMarkCompleted, false);
  assert.equal(noContent.shouldSyncFinalData, false);
});

if (!process.exitCode) console.log("\nchat final reconciliation coordinator regression tests passed");
