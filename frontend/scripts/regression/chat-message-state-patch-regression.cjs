#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(projectRoot, "lib/chatMessageStatePatch.ts");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-message-state-patch-regression-"));
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
  const outPath = path.join(tmpDir, "chatMessageStatePatch.cjs");
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

test("patchMessageById patches only matching message", () => {
  const messages = [
    { id: "a", content: "A" },
    { id: "b", content: "B" },
  ];
  const next = mod.patchMessageById(messages, "b", { content: "BB", completedAt: 1 });
  assert.deepEqual(next, [
    { id: "a", content: "A" },
    { id: "b", content: "BB", completedAt: 1 },
  ]);
  assert.equal(next[0], messages[0]);
  assert.notEqual(next[1], messages[1]);
});

test("patchMessageById supports functional patch", () => {
  const next = mod.patchMessageById([{ id: "a", count: 1 }], "a", (m) => ({ count: m.count + 1 }));
  assert.deepEqual(next, [{ id: "a", count: 2 }]);
});

test("applyFinalRealtimeDataToMessage applies realtime data after fallback content and sequence", () => {
  const message = { id: "a", content: "old", lastSequence: 3 };
  const next = mod.applyFinalRealtimeDataToMessage(message, {
    finalContent: "fallback",
    finalData: { content: "realtime", serverMessageId: 9 },
    latestSequence: 8,
  });
  assert.deepEqual(next, { id: "a", content: "realtime", lastSequence: 8, serverMessageId: 9 });
});

test("applyFinalRealtimeDataToMessage preserves structured reasoning for final render", () => {
  const next = mod.applyFinalRealtimeDataToMessage({ id: "a", content: "old" }, {
    finalContent: "fallback",
    finalData: { content: "answer", reasoningContent: "plan" },
    latestSequence: 4,
  });
  assert.deepEqual(next, { id: "a", content: "answer", reasoningContent: "plan", lastSequence: 4 });
});

test("applyFinalRealtimeDataToMessage uses final content when realtime content is empty", () => {
  const next = mod.applyFinalRealtimeDataToMessage({ id: "a", content: "old", lastSequence: 10 }, {
    finalContent: "streamed",
    finalData: { content: "" },
    latestSequence: 2,
  });
  assert.deepEqual(next, { id: "a", content: "", lastSequence: 10 });
});

test("applyFinalRealtimeDataToMessage preserves old content when no final content", () => {
  const next = mod.applyFinalRealtimeDataToMessage({ id: "a", content: "old" }, {
    finalContent: "",
    finalData: null,
    forceContentFallback: true,
  });
  assert.deepEqual(next, { id: "a", content: "old" });
});

test("applyCompareGroupContextToMessages patches user and assistant group metadata", () => {
  const messages = [
    { id: "user", content: "hi" },
    { id: "a1", content: "" },
    { id: "other", content: "x", groupIndex: 99 },
    { id: "a2", content: "" },
  ];
  const next = mod.applyCompareGroupContextToMessages(messages, {
    userMessageId: "user",
    assistantIds: ["a1", "a2"],
    context: { groupId: 7, userMessageId: 8, groupModels: ["m1", "m2"] },
  });
  assert.deepEqual(next, [
    { id: "user", content: "hi", serverMessageId: 8 },
    { id: "a1", content: "", groupId: 7, userMessageId: 8, groupModels: ["m1", "m2"], groupIndex: 0 },
    { id: "other", content: "x", groupIndex: 99 },
    { id: "a2", content: "", groupId: 7, userMessageId: 8, groupModels: ["m1", "m2"], groupIndex: 1 },
  ]);
});

console.log("\nchat message state patch regression tests passed");
process.exit(0);
