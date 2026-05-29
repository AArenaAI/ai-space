#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-delta-applier-regression-"));
  for (const rel of ["lib/chatStreamDelta.ts", "lib/chatDeltaApplier.ts"]) {
    const sourcePath = path.join(projectRoot, rel);
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
    fs.writeFileSync(path.join(tmpDir, rel.replace("lib/", "").replace(".ts", ".js")), transpiled);
  }
  let applier = fs.readFileSync(path.join(tmpDir, "chatDeltaApplier.js"), "utf8");
  applier = applier.replace('require("./chatStreamDelta")', 'require("./chatStreamDelta.js")');
  fs.writeFileSync(path.join(tmpDir, "chatDeltaApplier.js"), applier);
  return require(path.join(tmpDir, "chatDeltaApplier.js"));
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

function collect(rawDelta, state = { inReasoningBlock: false }) {
  const calls = [];
  const result = mod.applyChatStreamDelta({
    messageId: "m1",
    rawDelta,
    reasoningState: state,
    append: (messageId, delta) => calls.push({ messageId, delta }),
  });
  return { result, calls, state };
}

test("applies answer-only delta", () => {
  const { result, calls, state } = collect({ content: "hello" });
  assert.deepEqual(result, {
    legacyDelta: "hello",
    hasContentDelta: true,
    contentDelta: "hello",
    reasoningDelta: "",
  });
  assert.deepEqual(calls, [{ messageId: "m1", delta: { answerDelta: "hello", reasoning: false } }]);
  assert.equal(state.inReasoningBlock, false);
});

test("applies reasoning-only delta and opens reasoning state", () => {
  const { result, calls, state } = collect({ reasoning_content: "thinking" });
  assert.equal(result.legacyDelta, "<think>thinking");
  assert.equal(result.hasContentDelta, false);
  assert.deepEqual(calls, [{ messageId: "m1", delta: { reasoningDelta: "thinking", reasoning: true } }]);
  assert.equal(state.inReasoningBlock, true);
});

test("closes reasoning before answer in mixed delta", () => {
  const state = { inReasoningBlock: true };
  const { result, calls } = collect({ reasoning: " more", content: " answer" }, state);
  assert.equal(result.legacyDelta, " more</think> answer");
  assert.deepEqual(calls, [
    { messageId: "m1", delta: { reasoningDelta: " more", reasoning: true } },
    { messageId: "m1", delta: { reasoning: false } },
    { messageId: "m1", delta: { answerDelta: " answer", reasoning: false } },
  ]);
  assert.equal(state.inReasoningBlock, false);
});

test("stringifies array and object content deltas", () => {
  const { result, calls } = collect({ content: [{ text: "a" }, { content: "b" }, 3] });
  assert.equal(result.contentDelta, "ab3");
  assert.equal(result.legacyDelta, "ab3");
  assert.deepEqual(calls, [{ messageId: "m1", delta: { answerDelta: "ab3", reasoning: false } }]);
});

test("handles missing raw delta", () => {
  const { result, calls } = collect(undefined);
  assert.deepEqual(result, {
    legacyDelta: "",
    hasContentDelta: false,
    contentDelta: "",
    reasoningDelta: "",
  });
  assert.deepEqual(calls, []);
});

console.log("\nchat delta applier regression tests passed");
process.exit(0);
