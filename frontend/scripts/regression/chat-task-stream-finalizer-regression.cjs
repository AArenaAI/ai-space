#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");

function transpileModule(sourceFile, tmpDir) {
  const source = fs.readFileSync(path.join(projectRoot, sourceFile), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      strict: true,
    },
    fileName: path.join(projectRoot, sourceFile),
  }).outputText;
  const outPath = path.join(tmpDir, sourceFile.replace(/^lib\//, "").replace(/\.ts$/, ".js"));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output);
}

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-task-stream-finalizer-regression-"));
  [
    "lib/chatCompletionFinalizer.ts",
    "lib/chatTaskStreamFinalizer.ts",
  ].forEach((file) => transpileModule(file, tmpDir));
  return require(path.join(tmpDir, "chatTaskStreamFinalizer.js"));
}

const mod = loadModule();

function createFinalizingStatus(hasContent) {
  return { kind: "generating", status: "running", label: hasContent ? "正在校准最终内容" : "正在生成" };
}

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

test("hasTaskStreamFinalContent checks accumulated, stream and realtime content", () => {
  assert.equal(mod.hasTaskStreamFinalContent({ accumulated: "  " }), false);
  assert.equal(mod.hasTaskStreamFinalContent({ accumulated: "a" }), true);
  assert.equal(mod.hasTaskStreamFinalContent({ streamContent: "b" }), true);
  assert.equal(mod.hasTaskStreamFinalContent({ realtimeContent: "c" }), true);
});

test("buildTaskStreamDoneDecision finalizes and starts polling only with content and server id", () => {
  assert.deepEqual(mod.buildTaskStreamDoneDecision({
    accumulated: "answer",
    serverMessageId: 10,
    createFinalizingStatus,
  }), {
    hasContent: true,
    patch: {
      completedAt: undefined,
      activityStatus: { kind: "generating", status: "running", label: "正在校准最终内容" },
      searchStatus: undefined,
    },
    shouldStartBackgroundPolling: true,
  });
});

test("buildTaskStreamDoneDecision keeps finalizing busy without content", () => {
  assert.deepEqual(mod.buildTaskStreamDoneDecision({
    accumulated: "",
    streamContent: "",
    realtimeContent: "",
    serverMessageId: 10,
    createFinalizingStatus,
  }), {
    hasContent: false,
    patch: {
      completedAt: undefined,
      activityStatus: { kind: "generating", status: "running", label: "正在生成" },
      searchStatus: undefined,
    },
    shouldStartBackgroundPolling: false,
  });
});

test("shouldSyncTaskStreamFinalMessage follows final data or accumulated content", () => {
  assert.equal(mod.shouldSyncTaskStreamFinalMessage({ hasFinalData: true, accumulated: "" }), true);
  assert.equal(mod.shouldSyncTaskStreamFinalMessage({ hasFinalData: false, accumulated: "x" }), true);
  assert.equal(mod.shouldSyncTaskStreamFinalMessage({ hasFinalData: false, accumulated: "" }), false);
});

test("shouldStartTaskStreamFallbackPolling requires server message id", () => {
  assert.equal(mod.shouldStartTaskStreamFallbackPolling({ serverMessageId: 1 }), true);
  assert.equal(mod.shouldStartTaskStreamFallbackPolling({ serverMessageId: undefined }), false);
});

console.log("\nchat task stream finalizer regression tests passed");
