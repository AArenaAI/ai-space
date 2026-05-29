#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(projectRoot, "lib/chatCompletionFinalizer.ts");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-completion-finalizer-regression-"));
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
  const outPath = path.join(tmpDir, "chatCompletionFinalizer.cjs");
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

test("buildFinalizingPatch clears completedAt and sets finalizing status", () => {
  const patch = mod.buildFinalizingPatch({
    hasContent: true,
    createFinalizingStatus: (hasContent) => ({ kind: "generating", status: "running", label: hasContent ? "同步最终内容" : "收尾中" }),
  });
  assert.deepEqual(patch, {
    completedAt: undefined,
    activityStatus: { kind: "generating", status: "running", label: "同步最终内容" },
  });
});

test("buildStreamErrorPatch clears activity and search transient state", () => {
  assert.deepEqual(mod.buildStreamErrorPatch({ errorCode: "rate_limit", retryable: true, requestId: "req_1" }), {
    errorCode: "rate_limit",
    retryable: true,
    requestId: "req_1",
    activityStatus: undefined,
    searchStatus: undefined,
    searchSources: undefined,
  });
});

test("buildStoppedPatch marks stopped and completed time", () => {
  assert.deepEqual(mod.buildStoppedPatch(123), {
    stopped: true,
    completedAt: 123,
    activityStatus: undefined,
  });
});

test("buildRecoverableBusyPatch preserves task ids and clears completedAt", () => {
  const activityStatus = { kind: "generating", status: "running", label: "后台继续生成" };
  assert.deepEqual(mod.buildRecoverableBusyPatch({ serverMessageId: 11, generationTaskId: 22, activityStatus }), {
    serverMessageId: 11,
    generationTaskId: 22,
    activityStatus,
    completedAt: undefined,
  });
});

test("buildCompletedPatch clears activity", () => {
  assert.deepEqual(mod.buildCompletedPatch(456), {
    completedAt: 456,
    activityStatus: undefined,
  });
});

test("buildDisplayErrorMessage handles known errors", () => {
  assert.equal(mod.buildDisplayErrorMessage({ errorCode: "file_not_ready" }), "⏳ 文件解析中，请稍后再问");
  assert.equal(mod.buildDisplayErrorMessage({ errorCode: "guest_limit_exceeded", message: "自定义额度提示" }), "⚠️ 自定义额度提示");
  assert.equal(mod.buildDisplayErrorMessage({ errorCode: "other", message: "坏了" }), "❌ 坏了");
});

test("buildDisplayErrorPatch can omit completedAt for single chat legacy behavior", () => {
  assert.deepEqual(mod.buildDisplayErrorPatch({ errorCode: "unknown", message: "请求失败" }), {
    content: "❌ 请求失败",
    completedAt: undefined,
    activityStatus: undefined,
  });
});

console.log("\nchat completion finalizer regression tests passed");
process.exit(0);
