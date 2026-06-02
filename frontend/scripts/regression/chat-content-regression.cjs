#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(projectRoot, "lib/chatContent.ts");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-content-regression-"));
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
  const outPath = path.join(tmpDir, "chatContent.cjs");
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

test("parseThinkContent returns plain answer when no think tag", () => {
  assert.deepEqual(mod.parseThinkContent("hello"), {
    reasoning: null,
    answer: "hello",
    isThinking: false,
  });
});

test("parseThinkContent handles open reasoning block", () => {
  assert.deepEqual(mod.parseThinkContent("prefix <think>plan"), {
    reasoning: "plan",
    answer: "prefix ",
    isThinking: true,
  });
});

test("parseThinkContent handles closed reasoning block and trims final answer", () => {
  assert.deepEqual(mod.parseThinkContent("intro <think> plan </think> final "), {
    reasoning: "plan",
    answer: "intro  final",
    isThinking: false,
  });
});

test("extractCitations de-duplicates and sorts citation numbers", () => {
  assert.deepEqual(mod.extractCitations("see [3] and [1] and [3]"), [1, 3]);
});

test("getCitedSources maps one-based citations to source list", () => {
  const sources = [
    { title: "A", url: "https://a.example", description: "a" },
    { title: "B", url: "https://b.example", description: "b" },
  ];
  assert.deepEqual(mod.getCitedSources("answer [2] [9]", sources), [sources[1]]);
});

test("sanitizeContent removes trailing reference block and inline citation markers", () => {
  const input = "答案 [1] 保留正文\n\n引用来源：\n[1] Source - https://example.com";
  assert.equal(mod.sanitizeContent(input), "答案  保留正文");
});

test("sanitizeContent preserves numbered list-like bracket markers", () => {
  assert.equal(mod.sanitizeContent("步骤 [1]. 做 A\n步骤 [2). 做 B"), "步骤 [1]. 做 A\n步骤 [2). 做 B");
});

test("sanitizeContent converts bracket math line to block math", () => {
  assert.equal(mod.sanitizeContent("[ a^2 + b^2 = c^2 ]"), "$$a^2 + b^2 = c^2$$");
});

test("isMessageGenerating respects streaming override", () => {
  assert.equal(mod.isMessageGenerating({ completedAt: Date.now() }, true), true);
});

test("isMessageGenerating stops for completed or stopped messages", () => {
  assert.equal(mod.isMessageGenerating({ completedAt: Date.now(), activityStatus: { status: "running" } }, false), false);
  assert.equal(mod.isMessageGenerating({ stopped: true, generationTaskId: 1 }, false), false);
});

test("isMessageGenerating detects running activity, searching status and recovery hints", () => {
  assert.equal(mod.isMessageGenerating({ activityStatus: { status: "searching" } }, false), true);
  assert.equal(mod.isMessageGenerating({ searchStatus: "searching" }, false), true);
  assert.equal(mod.isMessageGenerating({ serverMessageId: 123 }, false), true);
  assert.equal(mod.isMessageGenerating({ backgroundTaskId: "task" }, false), true);
  assert.equal(mod.isMessageGenerating({ content: "", createdAt: Date.now() }, false), true);
  assert.equal(mod.isMessageGenerating({ content: "", createdAt: Date.now() - 20_000 }, false), false);
  assert.equal(mod.isMessageGenerating({}, false), false);
});

console.log("\nchat content regression tests passed");
process.exit(0);
