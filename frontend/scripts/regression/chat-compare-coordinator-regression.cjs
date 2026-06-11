#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(projectRoot, "lib/chatCompareCoordinator.ts");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-compare-coordinator-regression-"));
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
  const outPath = path.join(tmpDir, "chatCompareCoordinator.cjs");
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

test("selectCompareModelIds keeps available models and caps at two", () => {
  assert.deepEqual(mod.selectCompareModelIds(
    ["m1", "missing", "m2", "m3", "m4", "m5"],
    [{ id: "m1" }, { id: "m2" }, { id: "m3" }, { id: "m4" }, { id: "m5" }]
  ), ["m1", "m2"]);
});

test("shouldStartCompare requires at least two models", () => {
  assert.equal(mod.shouldStartCompare(["m1"]), false);
  assert.equal(mod.shouldStartCompare(["m1", "m2"]), true);
});

test("mergeCompareGroupContext merges ids and uses incoming group models", () => {
  assert.deepEqual(mod.mergeCompareGroupContext({
    incoming: { groupId: 2, userMessageId: 3, groupModels: ["a", "b"] },
    existing: { groupId: 1, userMessageId: 1, groupModels: ["old"] },
    fallbackGroupModels: ["f1", "f2"],
  }), { groupId: 2, userMessageId: 3, groupModels: ["a", "b"] });
});

test("mergeCompareGroupContext preserves existing ids and falls back group models", () => {
  assert.deepEqual(mod.mergeCompareGroupContext({
    incoming: { groupModels: [] },
    existing: { groupId: 8, userMessageId: 9, groupModels: ["old"] },
    fallbackGroupModels: ["f1", "f2"],
  }), { groupId: 8, userMessageId: 9, groupModels: ["f1", "f2"] });
});

test("mergeCompareGroupContext returns existing when incoming is missing", () => {
  const existing = { groupId: 1, userMessageId: 2, groupModels: ["m"] };
  assert.equal(mod.mergeCompareGroupContext({ existing, fallbackGroupModels: ["f"] }), existing);
});

test("isCompareGroupContextReady requires group id and user message id", () => {
  assert.equal(mod.isCompareGroupContextReady(undefined), false);
  assert.equal(mod.isCompareGroupContextReady({ groupId: 1, groupModels: [] }), false);
  assert.equal(mod.isCompareGroupContextReady({ groupId: 1, userMessageId: 2, groupModels: [] }), true);
});

test("getCompareRequestGroupContext hides context for first request unless explicit", () => {
  const current = { groupId: 1, userMessageId: 2, groupModels: ["m"] };
  const explicit = { groupId: 3, userMessageId: 4, groupModels: ["e"] };
  assert.equal(mod.getCompareRequestGroupContext({ index: 0, currentContext: current }), undefined);
  assert.equal(mod.getCompareRequestGroupContext({ index: 1, currentContext: current }), current);
  assert.equal(mod.getCompareRequestGroupContext({ index: 0, explicitContext: explicit, currentContext: current }), explicit);
});

test("shouldSkipSaveUserMessage skips all non-first compare requests", () => {
  assert.equal(mod.shouldSkipSaveUserMessage(0), false);
  assert.equal(mod.shouldSkipSaveUserMessage(1), true);
});

test("resolveCompareRequestGroupModels prefers request models and falls back when empty", () => {
  assert.deepEqual(mod.resolveCompareRequestGroupModels({ requestGroupModels: ["a"], fallbackGroupModels: ["f"] }), ["a"]);
  assert.deepEqual(mod.resolveCompareRequestGroupModels({ requestGroupModels: [], fallbackGroupModels: ["f"] }), ["f"]);
  assert.deepEqual(mod.resolveCompareRequestGroupModels({ fallbackGroupModels: ["f"] }), ["f"]);
});

console.log("\nchat compare coordinator regression tests passed");
process.exit(0);
