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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-stream-action-handler-regression-"));
  [
    "lib/chatCompletionFinalizer.ts",
    "lib/chatStreamEventDecision.ts",
    "lib/chatStreamActionHandler.ts",
  ].forEach((file) => transpileModule(file, tmpDir));
  return require(path.join(tmpDir, "chatStreamActionHandler.js"));
}

const mod = loadModule();
const searchDoneStatus = { kind: "web_search", status: "completed", label: "搜索完成" };

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

test("buildTextAppendIntent appends text and returns original data", () => {
  assert.deepEqual(mod.buildTextAppendIntent({ accumulated: "hello", data: " world" }), {
    type: "append_text",
    data: " world",
    accumulated: "hello world",
  });
});

test("buildStreamErrorIntent builds task-stream error patch without content", () => {
  assert.deepEqual(mod.buildStreamErrorIntent({
    payload: { type: "error", error: {}, message: "boom", errorCode: "rate_limit", retryable: true },
    accumulated: "",
    fallbackRequestId: "req_old",
  }), {
    type: "stream_error",
    accumulated: "boom",
    patch: {
      errorCode: "rate_limit",
      retryable: true,
      requestId: "req_old",
      activityStatus: undefined,
      searchStatus: undefined,
      searchSources: undefined,
    },
  });
});

test("buildStreamErrorIntent can include content for main chat stream", () => {
  assert.deepEqual(mod.buildStreamErrorIntent({
    payload: { type: "error", error: {}, message: "failed", errorCode: "bad", retryable: false, requestId: "req_new" },
    accumulated: "partial",
    fallbackRequestId: "req_old",
    includeContentInPatch: true,
  }), {
    type: "stream_error",
    accumulated: "partial",
    patch: {
      content: "partial",
      errorCode: "bad",
      retryable: false,
      requestId: "req_new",
      activityStatus: undefined,
      searchStatus: undefined,
      searchSources: undefined,
    },
  });
});

test("buildStreamSearchIntent normalizes search patch", () => {
  assert.deepEqual(mod.buildStreamSearchIntent({
    meta: { status: "completed", sources: [{ title: "A" }], sources_count: 1 },
    activityStatus: searchDoneStatus,
  }), {
    type: "search_patch",
    patch: {
      searchStatus: "completed",
      searchSources: [{ title: "A" }],
      searchSourcesCount: 1,
      activityStatus: searchDoneStatus,
    },
  });
});

test("buildDeltaAccumulatedIntent appends only non-empty legacy deltas", () => {
  assert.deepEqual(mod.buildDeltaAccumulatedIntent({ accumulated: "a", legacyDelta: "b" }), {
    type: "delta_accumulated",
    accumulated: "ab",
    hasLegacyDelta: true,
  });
  assert.deepEqual(mod.buildDeltaAccumulatedIntent({ accumulated: "a", legacyDelta: "" }), {
    type: "delta_accumulated",
    accumulated: "a",
    hasLegacyDelta: false,
  });
});

console.log("\nchat stream action handler regression tests passed");
