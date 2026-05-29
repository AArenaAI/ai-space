#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(projectRoot, "lib/chatTaskEventDecision.ts");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-task-event-decision-regression-"));
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
  const outPath = path.join(tmpDir, "chatTaskEventDecision.cjs");
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

test("buildActiveTaskStreamState preserves existing state and updates stream fields", () => {
  assert.deepEqual(mod.buildActiveTaskStreamState({
    existing: { convId: 1, serverMessageId: 2, generationTaskId: 3, lastSequence: 4, content: "old" },
    convId: 10,
    serverMessageId: 20,
    generationTaskId: 30,
    lastSequence: 40,
    content: "new",
  }), {
    convId: 10,
    serverMessageId: 20,
    generationTaskId: 30,
    lastSequence: 40,
    content: "new",
  });
});

test("buildGenerationTaskEventPatches returns active state and realtime patch", () => {
  const activityStatus = { kind: "generating", status: "running", label: "生成中" };
  const result = mod.buildGenerationTaskEventPatches({
    taskInfo: {
      serverMessageId: 11,
      generationTaskId: 22,
      useBackground: true,
      isComplexTask: true,
    },
    convId: 7,
    lastSequence: 9,
    content: "partial",
    existingActiveState: { content: "old" },
    activityStatus,
  });
  assert.deepEqual(result, {
    activeState: {
      content: "partial",
      convId: 7,
      serverMessageId: 11,
      generationTaskId: 22,
      lastSequence: 9,
    },
    realtimePatch: {
      serverMessageId: 11,
      generationTaskId: 22,
      useBackground: true,
      isComplexTask: true,
      lastSequence: 9,
      activityStatus,
    },
  });
});

test("buildTaskActivityPatch maps web search running to searching", () => {
  const activityStatus = { kind: "web_search", status: "running", label: "搜索中" };
  assert.deepEqual(mod.buildTaskActivityPatch({ meta: { kind: "web_search", status: "running" }, activityStatus }), {
    activityStatus,
    searchStatus: "searching",
  });
});

test("buildTaskActivityPatch maps non-running web search to completed", () => {
  const activityStatus = { kind: "web_search", status: "completed", label: "搜索完成" };
  assert.deepEqual(mod.buildTaskActivityPatch({ meta: { kind: "web_search", status: "completed" }, activityStatus }), {
    activityStatus,
    searchStatus: "completed",
  });
});

test("buildTaskActivityPatch leaves searchStatus undefined for non-search activity", () => {
  const activityStatus = { kind: "generating", status: "running", label: "生成中" };
  assert.deepEqual(mod.buildTaskActivityPatch({ meta: { kind: "generating", status: "running" }, activityStatus }), {
    activityStatus,
    searchStatus: undefined,
  });
});

test("buildTaskSearchPatch normalizes sources and count", () => {
  const activityStatus = { kind: "web_search", status: "completed", label: "搜索完成" };
  assert.deepEqual(mod.buildTaskSearchPatch({ meta: { status: "completed", sources: [{ title: "a" }], sources_count: 1 }, activityStatus }), {
    searchStatus: "completed",
    searchSources: [{ title: "a" }],
    searchSourcesCount: 1,
    activityStatus,
  });
});

test("buildTaskDeltaState appends legacy delta and returns active state", () => {
  assert.deepEqual(mod.buildTaskDeltaState({
    legacyDelta: " world",
    accumulated: "hello",
    convId: 1,
    serverMessageId: 2,
    generationTaskId: 3,
    lastSequence: 4,
  }), {
    accumulated: "hello world",
    activeState: {
      convId: 1,
      serverMessageId: 2,
      generationTaskId: 3,
      lastSequence: 4,
      content: "hello world",
    },
  });
});

test("buildTaskDeltaState leaves state unchanged for empty delta", () => {
  assert.deepEqual(mod.buildTaskDeltaState({ legacyDelta: "", accumulated: "hello", lastSequence: 1 }), {
    accumulated: "hello",
  });
});

console.log("\nchat task event decision regression tests passed");
process.exit(0);
