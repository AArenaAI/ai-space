#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(projectRoot, "lib/chatHistoryTransform.ts");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-history-transform-regression-"));
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
  const outPath = path.join(tmpDir, "chatHistoryTransform.cjs");
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

test("stripReasoningBlocks removes closed think blocks", () => {
  assert.equal(mod.stripReasoningBlocks("before <think>hidden</think> after"), "before  after");
});

test("stripReasoningBlocks removes open trailing think block", () => {
  assert.equal(mod.stripReasoningBlocks("answer <think>unfinished"), "answer");
});

test("stripReasoningBlocks is case insensitive and trims", () => {
  assert.equal(mod.stripReasoningBlocks("  <THINK>x</THINK> visible  "), "visible");
});

test("truncateAssistantHistory keeps short content", () => {
  assert.equal(mod.truncateAssistantHistory("short", 10, 3), "short");
});

test("truncateAssistantHistory truncates long content with notice", () => {
  assert.equal(mod.truncateAssistantHistory("abcdef", 5, 3), "abc\n\n[前文已省略，如需回顾请重新提问]");
});

test("truncateAssistantHistory trims truncated prefix", () => {
  assert.equal(mod.truncateAssistantHistory("abc   def", 5, 6), "abc\n\n[前文已省略，如需回顾请重新提问]");
});

test("toModelMessages preserves user and system content", () => {
  assert.deepEqual(mod.toModelMessages([
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
  ]), [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
  ]);
});

test("toModelMessages strips assistant reasoning and keeps answer", () => {
  assert.deepEqual(mod.toModelMessages([
    { role: "assistant", content: "<think>secret</think> answer" },
  ]), [
    { role: "assistant", content: "answer" },
  ]);
});

test("toModelMessages filters empty assistant after stripping reasoning", () => {
  assert.deepEqual(mod.toModelMessages([
    { role: "assistant", content: "<think>secret</think>" },
    { role: "user", content: "next" },
  ]), [
    { role: "user", content: "next" },
  ]);
});

test("toModelMessages truncates long assistant after stripping reasoning", () => {
  const long = "x".repeat(1600);
  const result = mod.toModelMessages([{ role: "assistant", content: long }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].content.startsWith("x".repeat(300)), true);
  assert.equal(result[0].content.endsWith("[前文已省略，如需回顾请重新提问]"), true);
});

console.log("\nchat history transform regression tests passed");
process.exit(0);
