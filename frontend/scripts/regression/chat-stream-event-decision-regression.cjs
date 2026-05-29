#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(projectRoot, "lib/chatStreamEventDecision.ts");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-stream-event-decision-regression-"));
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
  fs.writeFileSync(path.join(tmpDir, "chatStreamEventDecision.js"), transpiled);
  return require(path.join(tmpDir, "chatStreamEventDecision.js"));
}

const mod = loadModule();
const generatingStatus = { kind: "generating", status: "running", label: "生成中" };
const busyStatus = { kind: "generating", status: "running", label: "仍在生成" };
const searchStatus = { kind: "web_search", status: "completed", label: "搜索完成" };

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

test("mergeStreamGroupMeta prefers incoming values and preserves fallbacks", () => {
  assert.deepEqual(mod.mergeStreamGroupMeta({
    existing: { groupId: 1, groupIndex: 0, userMessageId: 2, groupModels: ["a"] },
    incoming: { groupIndex: 3, groupModels: [] },
  }), { groupId: 1, groupIndex: 3, userMessageId: 2, groupModels: ["a"] });
});

test("buildChatDonePatch completes when content exists", () => {
  assert.deepEqual(mod.buildChatDonePatch({
    accumulated: "",
    streamContent: "answer",
    now: 123,
    busyStatus,
  }), {
    hasContent: true,
    patch: { completedAt: 123, activityStatus: undefined },
  });
});

test("buildChatDonePatch keeps busy when content is empty", () => {
  assert.deepEqual(mod.buildChatDonePatch({
    accumulated: " ",
    realtimeContent: "",
    now: 123,
    busyStatus,
  }), {
    hasContent: false,
    patch: { completedAt: undefined, activityStatus: busyStatus },
  });
});

test("buildChatGenerationTaskPatch merges meta and marks background registration", () => {
  const result = mod.buildChatGenerationTaskPatch({
    taskInfo: {
      serverMessageId: 10,
      groupId: 20,
      groupIndex: 1,
      userMessageId: 30,
      groupModels: ["m1", "m2"],
      generationTaskId: 40,
      useBackground: true,
      isComplexTask: false,
    },
    existingMeta: { groupId: 1, groupModels: ["old"] },
    lastSequence: 7,
    activityStatus: generatingStatus,
  });
  assert.deepEqual(result.meta, {
    groupId: 20,
    groupIndex: 1,
    userMessageId: 30,
    groupModels: ["m1", "m2"],
    serverMessageId: 10,
    generationTaskId: 40,
    useBackground: true,
  });
  assert.equal(result.shouldMarkBackgroundPollingStarted, true);
  assert.equal(result.shouldRegisterBackgroundTask, true);
  assert.deepEqual(result.patch, {
    serverMessageId: 10,
    groupId: 20,
    groupIndex: 1,
    groupModels: ["m1", "m2"],
    userMessageId: 30,
    generationTaskId: 40,
    useBackground: true,
    isComplexTask: false,
    lastSequence: 7,
    activityStatus: generatingStatus,
  });
});

test("buildChatGenerationTaskPatch registers complex non-background tasks", () => {
  const result = mod.buildChatGenerationTaskPatch({
    taskInfo: { serverMessageId: 10, useBackground: false, isComplexTask: true },
    existingMeta: {},
    lastSequence: 0,
    activityStatus: generatingStatus,
  });
  assert.equal(result.shouldRegisterBackgroundTask, true);
  assert.equal(result.shouldMarkBackgroundPollingStarted, false);
});

test("buildChatBackgroundTaskPatch forces background complex task state", () => {
  const result = mod.buildChatBackgroundTaskPatch({
    taskInfo: {
      serverMessageId: 10,
      backgroundTaskId: "bg",
      groupId: 20,
      groupModels: ["m"],
      useBackground: true,
      isComplexTask: true,
    },
    existingMeta: { userMessageId: 30 },
    activityStatus: busyStatus,
  });
  assert.equal(result.shouldRegisterBackgroundTask, true);
  assert.deepEqual(result.meta, {
    groupId: 20,
    groupIndex: undefined,
    userMessageId: 30,
    groupModels: ["m"],
    serverMessageId: 10,
    useBackground: true,
  });
  assert.equal(result.patch.backgroundTaskId, "bg");
  assert.equal(result.patch.isComplexTask, true);
});

test("buildChatActivityPatch only sets search status for web search", () => {
  assert.deepEqual(mod.buildChatActivityPatch({
    meta: { kind: "web_search", status: "searching" },
    activityStatus: searchStatus,
  }), { activityStatus: searchStatus, searchStatus: "searching" });
  assert.deepEqual(mod.buildChatActivityPatch({
    meta: { kind: "tool_call", status: "running" },
    activityStatus: generatingStatus,
  }), { activityStatus: generatingStatus });
});

test("buildChatSearchPatch normalizes sources and count", () => {
  assert.deepEqual(mod.buildChatSearchPatch({
    meta: { status: "completed", sources: [{ url: "u" }], sources_count: 1 },
    activityStatus: searchStatus,
  }), {
    searchStatus: "completed",
    searchSources: [{ url: "u" }],
    searchSourcesCount: 1,
    activityStatus: searchStatus,
  });
});

test("buildChatDeltaAccumulatedState appends only non-empty legacy delta", () => {
  assert.deepEqual(mod.buildChatDeltaAccumulatedState({ accumulated: "a", legacyDelta: "b" }), {
    accumulated: "ab",
    hasLegacyDelta: true,
  });
  assert.deepEqual(mod.buildChatDeltaAccumulatedState({ accumulated: "a", legacyDelta: "" }), {
    accumulated: "a",
    hasLegacyDelta: false,
  });
});

console.log("\nchat stream event decision regression tests passed");
