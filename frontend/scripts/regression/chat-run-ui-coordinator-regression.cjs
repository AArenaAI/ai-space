#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "../..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-run-ui-"));
function compile(rel) {
  const sourceFile = path.join(repoRoot, rel);
  const outFile = path.join(tempDir, rel.replace(/[\\/]/g, "_").replace(/\.ts$/, ".cjs"));
  const source = fs.readFileSync(sourceFile, "utf8");
  let output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  output = output.replace(/require\("\.\/(chatCompletionFinalizer|chatErrorRecovery|chatStreamRunResult)"\)/g, (_m, name) => `require("./lib_${name}.cjs")`);
  fs.writeFileSync(outFile, output);
  return outFile;
}
compile("lib/chatCompletionFinalizer.ts");
compile("lib/chatStreamRunResult.ts");
compile("lib/chatErrorRecovery.ts");
const modulePath = compile("lib/chatRunUiCoordinator.ts");
const {
  decideSingleSendError,
  decideSingleSendFinally,
  decideCompareRunError,
  decideCompareRunFinally,
  buildConversationUpdatedEventDetail,
} = require(modulePath);

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

const busy = { kind: "generating", status: "running", label: "生成中" };

test("single send abort user returns stopped patch", () => {
  const decision = decideSingleSendError({ error: { name: "AbortError" }, abortReason: "user", modelId: "m", conversationId: 1, busyActivityStatus: busy });
  assert.equal(decision.type, "stopped");
  assert.equal(decision.patch.stopped, true);
});

test("single send navigation abort is ignored", () => {
  const decision = decideSingleSendError({ error: { name: "AbortError" }, abortReason: "navigation", modelId: "m", conversationId: 1, busyActivityStatus: busy });
  assert.equal(decision.type, "none");
});

test("single send background model with conversation becomes recoverable busy", () => {
  const decision = decideSingleSendError({ error: new Error("net"), abortReason: null, modelId: "gpt-5.5-pro-fast", conversationId: 2, busyActivityStatus: busy });
  assert.equal(decision.type, "recoverable_busy");
  assert.deepEqual(decision.patch.activityStatus, busy);
});

test("single send guest limit maps display copy", () => {
  const decision = decideSingleSendError({ error: { errorCode: "guest_limit_exceeded", message: "raw" }, abortReason: null, modelId: "m", busyActivityStatus: busy });
  assert.equal(decision.type, "display_error");
  assert.equal(decision.patch.content, "⚠️ 匿名用户每日次数用完，请登录后继续");
});

test("single send finally skips global mutation on navigation", () => {
  const decision = decideSingleSendFinally({ abortReason: "navigation", hasActiveTaskStream: false, conversationId: 3 });
  assert.equal(decision.shouldUpdateLoading, false);
  assert.equal(decision.shouldClearMainController, false);
  assert.equal(decision.shouldDispatchConversationUpdated, false);
});

test("single send finally clears controller only when no task stream remains", () => {
  assert.equal(decideSingleSendFinally({ abortReason: null, hasActiveTaskStream: false }).shouldClearMainController, true);
  assert.equal(decideSingleSendFinally({ abortReason: null, hasActiveTaskStream: true }).shouldClearMainController, false);
});

test("compare error recovers from stream server id and starts polling", () => {
  const decision = decideCompareRunError({
    assistantModel: "m",
    error: new Error("net"),
    streamResult: { serverMessageId: 10, generationTaskId: 11 },
    hasTaskStream: false,
    hasBackgroundPoller: false,
    conversationId: 4,
    busyActivityStatus: busy,
    now: 100,
  });
  assert.equal(decision.type, "recoverable_busy");
  assert.equal(decision.patch.serverMessageId, 10);
  assert.equal(decision.patch.generationTaskId, 11);
  assert.equal(decision.shouldStartBackgroundPolling, true);
});

test("compare error falls back to existing ids for patch when realtime ids are absent but task stream exists", () => {
  const decision = decideCompareRunError({
    assistantModel: "m",
    error: new Error("net"),
    hasTaskStream: true,
    hasBackgroundPoller: false,
    conversationId: 4,
    existingServerMessageId: 20,
    existingGenerationTaskId: 21,
    busyActivityStatus: busy,
    now: 100,
  });
  assert.equal(decision.type, "recoverable_busy");
  assert.equal(decision.patch.serverMessageId, 20);
  assert.equal(decision.patch.generationTaskId, 21);
  assert.equal(decision.shouldStartBackgroundPolling, false);
});

test("compare error otherwise returns display error patch", () => {
  const decision = decideCompareRunError({ assistantModel: "m", error: { errorCode: "bad", message: "Boom" }, hasTaskStream: false, hasBackgroundPoller: false, busyActivityStatus: busy, now: 123 });
  assert.equal(decision.type, "display_error");
  assert.equal(decision.patch.content, "❌ Boom");
  assert.equal(decision.patch.completedAt, 123);
});

test("compare finally preserves navigation and otherwise clears compare controllers", () => {
  const nav = decideCompareRunFinally({ abortReason: "navigation", hasActiveTaskStream: false, hasActivePoller: false, conversationId: 1 });
  assert.equal(nav.shouldClearCompareControllers, false);
  assert.equal(nav.shouldDispatchConversationUpdated, false);
  const done = decideCompareRunFinally({ abortReason: null, hasActiveTaskStream: true, hasActivePoller: false, conversationId: 1 });
  assert.equal(done.shouldClearCompareControllers, true);
  assert.equal(done.isLoading, true);
  assert.equal(done.shouldDispatchConversationUpdated, true);
});

test("buildConversationUpdatedEventDetail is stable", () => {
  assert.deepEqual(buildConversationUpdatedEventDetail(5, "2026-01-01T00:00:00.000Z"), { id: 5, updated_at: "2026-01-01T00:00:00.000Z" });
});

console.log("\nchat run UI coordinator regression tests passed");
