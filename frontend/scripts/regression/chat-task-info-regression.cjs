#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(projectRoot, "lib/chatTaskInfo.ts");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-task-info-regression-"));
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
  const outPath = path.join(tmpDir, "chatTaskInfo.cjs");
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

test("normalizes generation task numeric ids and group metadata", () => {
  assert.deepEqual(mod.normalizeGenerationTaskInfo({
    id: "12",
    assistant_message_id: "34",
    group_id: "56",
    group_index: 0,
    user_message_id: "78",
    group_models: ["gpt", "", 123, "claude"],
  }), {
    serverMessageId: 34,
    groupId: 56,
    groupIndex: 0,
    userMessageId: 78,
    groupModels: ["gpt", "claude"],
    generationTaskId: 12,
    useBackground: false,
    isComplexTask: false,
  });
});

test("generation task uses task_id fallback and existing fallback ids", () => {
  assert.deepEqual(mod.normalizeGenerationTaskInfo({ task_id: 0 }, { generationTaskId: 99, serverMessageId: 88 }), {
    serverMessageId: 88,
    groupId: undefined,
    groupIndex: undefined,
    userMessageId: undefined,
    groupModels: undefined,
    generationTaskId: 99,
    useBackground: false,
    isComplexTask: false,
  });
});

test("generation task detects background variants", () => {
  assert.equal(mod.normalizeGenerationTaskInfo({ use_background: true }).useBackground, true);
  assert.equal(mod.normalizeGenerationTaskInfo({ background: true }).useBackground, true);
  const complex = mod.normalizeGenerationTaskInfo({ is_complex_task: true });
  assert.equal(complex.useBackground, true);
  assert.equal(complex.isComplexTask, true);
});

test("generation task filters empty group models", () => {
  assert.equal(mod.normalizeGenerationTaskInfo({ group_models: ["", 0, null] }).groupModels, undefined);
});

test("normalizes background task fields", () => {
  assert.deepEqual(mod.normalizeBackgroundTaskInfo({
    id: "bg-1",
    assistant_message_id: 44,
    group_id: 55,
    group_index: "2",
    user_message_id: 66,
    group_models: ["a", "b"],
  }), {
    serverMessageId: 44,
    groupId: 55,
    groupIndex: 2,
    userMessageId: 66,
    groupModels: ["a", "b"],
    backgroundTaskId: "bg-1",
    useBackground: true,
    isComplexTask: true,
  });
});

test("background task defaults empty id string", () => {
  assert.equal(mod.normalizeBackgroundTaskInfo({}).backgroundTaskId, "");
});

console.log("\nchat task info regression tests passed");
process.exit(0);
