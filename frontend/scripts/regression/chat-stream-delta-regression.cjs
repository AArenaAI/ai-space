#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(projectRoot, "lib/chatStreamDelta.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: sourcePath,
}).outputText;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-stream-delta-regression-"));
const tmpFile = path.join(tmpDir, "chatStreamDelta.cjs");
fs.writeFileSync(tmpFile, compiled, "utf8");
const mod = require(tmpFile);

function test(name, fn) {
  fn();
  console.log(`✓ ${name}`);
}

try {
  test("stringifyStreamDelta handles primitives, arrays and object text fields", () => {
    assert.equal(mod.stringifyStreamDelta("a"), "a");
    assert.equal(mod.stringifyStreamDelta(42), "42");
    assert.equal(mod.stringifyStreamDelta(true), "true");
    assert.equal(mod.stringifyStreamDelta(["a", { text: "b" }, null, { value: "c" }]), "abc");
    assert.equal(mod.stringifyStreamDelta({ content: "content" }), "content");
    assert.equal(mod.stringifyStreamDelta({ summary: "summary" }), "summary");
    assert.equal(mod.stringifyStreamDelta({ delta: "delta" }), "delta");
  });

  test("reasoning-only delta opens legacy think block and emits reasoning op", () => {
    const state = { inReasoningBlock: false };
    const result = mod.buildStructuredStreamDelta("plan", "", state);
    assert.equal(result.legacyDelta, "<think>plan");
    assert.equal(result.hasContentDelta, false);
    assert.equal(state.inReasoningBlock, true);
    assert.deepEqual(result.operations, [{ type: "reasoning", reasoningDelta: "plan" }]);
  });

  test("content-only delta emits answer op without think markers", () => {
    const state = { inReasoningBlock: false };
    const result = mod.buildStructuredStreamDelta("", "answer", state);
    assert.equal(result.legacyDelta, "answer");
    assert.equal(result.hasContentDelta, true);
    assert.equal(state.inReasoningBlock, false);
    assert.deepEqual(result.operations, [{ type: "answer", answerDelta: "answer" }]);
  });

  test("reasoning and content in same event opens then closes reasoning before answer", () => {
    const state = { inReasoningBlock: false };
    const result = mod.buildStructuredStreamDelta("why", "final", state);
    assert.equal(result.legacyDelta, "<think>why</think>final");
    assert.equal(result.hasContentDelta, true);
    assert.equal(state.inReasoningBlock, false);
    assert.deepEqual(result.operations, [
      { type: "reasoning", reasoningDelta: "why" },
      { type: "close_reasoning" },
      { type: "answer", answerDelta: "final" },
    ]);
  });

  test("continuing reasoning block does not duplicate open marker", () => {
    const state = { inReasoningBlock: true };
    const result = mod.buildStructuredStreamDelta("more", "", state);
    assert.equal(result.legacyDelta, "more");
    assert.equal(state.inReasoningBlock, true);
    assert.deepEqual(result.operations, [{ type: "reasoning", reasoningDelta: "more" }]);
  });

  test("content after open reasoning block closes marker before answer", () => {
    const state = { inReasoningBlock: true };
    const result = mod.buildStructuredStreamDelta("", "final", state);
    assert.equal(result.legacyDelta, "</think>final");
    assert.equal(state.inReasoningBlock, false);
    assert.deepEqual(result.operations, [
      { type: "close_reasoning" },
      { type: "answer", answerDelta: "final" },
    ]);
  });

  console.log("\nchat stream delta regression tests passed");
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
