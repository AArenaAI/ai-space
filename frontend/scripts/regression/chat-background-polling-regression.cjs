#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(projectRoot, "lib/chatBackgroundPolling.ts");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-background-polling-regression-"));
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
  const outPath = path.join(tmpDir, "chatBackgroundPolling.cjs");
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

test("completed status only finishes when content exists", () => {
  assert.equal(mod.evaluateBackgroundTaskPoll({ status: "completed", content: "answer" }).isFinished, true);
  const emptyCompleted = mod.evaluateBackgroundTaskPoll({ status: "completed", content: "   " });
  assert.equal(emptyCompleted.hasContent, false);
  assert.equal(emptyCompleted.isFinished, false);
});

test("cancelled status is hard stopped even without content", () => {
  const state = mod.evaluateBackgroundTaskPoll({ status: "cancelled", content: "" });
  assert.equal(state.isHardStopped, true);
  assert.equal(state.isFinished, true);
});

test("failed and incomplete require three stable polls", () => {
  let state = mod.evaluateBackgroundTaskPoll({ status: "failed", content: "partial", previousContent: "", terminalStableCount: 0 });
  assert.equal(state.terminalStableCount, 0);
  assert.equal(state.isFinished, false);
  state = mod.evaluateBackgroundTaskPoll({ status: "failed", content: "partial", previousContent: "partial", terminalStableCount: 0 });
  assert.equal(state.terminalStableCount, 1);
  assert.equal(state.isFinished, false);
  state = mod.evaluateBackgroundTaskPoll({ status: "failed", content: "partial", previousContent: "partial", terminalStableCount: 2 });
  assert.equal(state.terminalStableCount, 3);
  assert.equal(state.isFinished, true);
});

test("non-terminal status resets stable count", () => {
  const state = mod.evaluateBackgroundTaskPoll({ status: "running", content: "partial", previousContent: "partial", terminalStableCount: 2 });
  assert.equal(state.terminalStableCount, 0);
  assert.equal(state.isFinished, false);
});

test("message patch prefers live stream content while stream is active", () => {
  const patch = mod.buildBackgroundPollingMessagePatch({
    existingContent: "old",
    polledContent: "db full",
    liveContent: "stream half",
    streamActive: true,
    serverMessageId: 12,
    isFinished: false,
    now: 100,
    createBusyStatus: () => ({ kind: "generating", status: "running", label: "生成中" }),
  });
  assert.deepEqual(patch, {
    content: "stream half",
    reasoningContent: undefined,
    serverMessageId: 12,
    generationStartedAt: undefined,
    statusTimeline: undefined,
    serverGenerationStatus: undefined,
    activityStatus: { kind: "generating", status: "running", label: "生成中" },
    completedAt: undefined,
  });
});

test("shouldApplyPolledContent rejects active stream, blank db, shorter db and non-completed status", () => {
  assert.equal(mod.shouldApplyPolledContent({ streamActive: true, liveContent: "live", dbContent: "db full", taskStatus: "completed" }), false);
  assert.equal(mod.shouldApplyPolledContent({ streamActive: false, liveContent: "live", dbContent: "   ", taskStatus: "completed" }), false);
  assert.equal(mod.shouldApplyPolledContent({ streamActive: false, liveContent: "live content", dbContent: "short", taskStatus: "completed" }), false);
  assert.equal(mod.shouldApplyPolledContent({ streamActive: false, liveContent: "live", dbContent: "db full", taskStatus: "running" }), false);
  assert.equal(mod.shouldApplyPolledContent({ streamActive: false, liveContent: "live", dbContent: "db full", taskStatus: "completed" }), true);
});

test("selectFinalAssistantContent prefers completed db then live then existing", () => {
  assert.equal(mod.selectFinalAssistantContent({ existingContent: "old", liveContent: "live", dbContent: "db full", taskStatus: "completed" }), "db full");
  assert.equal(mod.selectFinalAssistantContent({ existingContent: "old", liveContent: "live content", dbContent: "short", taskStatus: "completed" }), "short");
  assert.equal(mod.selectFinalAssistantContent({ existingContent: "old", liveContent: "live", dbContent: "db full", taskStatus: "running" }), "live");
  assert.equal(mod.selectFinalAssistantContent({ existingContent: "old", liveContent: "", dbContent: "db full", taskStatus: "running" }), "old");
});

test("message patch uses polled content and clears activity when finished", () => {
  const patch = mod.buildBackgroundPollingMessagePatch({
    existingContent: "old",
    polledContent: "db full",
    streamActive: false,
    serverMessageId: 12,
    isFinished: true,
    now: 100,
    createBusyStatus: () => ({ kind: "generating", status: "running", label: "生成中" }),
  });
  assert.deepEqual(patch, {
    content: "db full",
    reasoningContent: undefined,
    serverMessageId: 12,
    generationStartedAt: undefined,
    statusTimeline: undefined,
    serverGenerationStatus: "completed",
    activityStatus: undefined,
    completedAt: 100,
  });
});

test("shouldKeepBackgroundLoading covers terminal pending and empty content", () => {
  assert.equal(mod.shouldKeepBackgroundLoading({ status: "failed", hasContent: true }), true);
  assert.equal(mod.shouldKeepBackgroundLoading({ status: "cancelled", hasContent: true }), true);
  assert.equal(mod.shouldKeepBackgroundLoading({ status: "incomplete", hasContent: true }), true);
  assert.equal(mod.shouldKeepBackgroundLoading({ status: "running", hasContent: false }), true);
  assert.equal(mod.shouldKeepBackgroundLoading({ status: "running", hasContent: true }), false);
});

console.log("\nchat background polling regression tests passed");
process.exit(0);
