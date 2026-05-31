#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(projectRoot, "lib/streaming.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: sourcePath,
}).outputText;

function withModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "streaming-regression-"));
  const tmpFile = path.join(tmpDir, "streaming.cjs");
  fs.writeFileSync(tmpFile, compiled, "utf8");

  let currentTime = 1_700_000_000_000;
  const realDateNow = Date.now;
  const realRaf = global.requestAnimationFrame;
  const realCancelRaf = global.cancelAnimationFrame;

  Date.now = () => currentTime;
  global.requestAnimationFrame = (cb) => {
    cb(currentTime);
    return 1;
  };
  global.cancelAnimationFrame = () => {};

  const mod = require(tmpFile);

  return {
    mod,
    advance(ms) {
      currentTime += ms;
    },
    cleanup() {
      try {
        const snapshot = mod.realtimeDebugSnapshot();
        for (const id of Object.keys(snapshot)) {
          mod.realtimeClear(id);
        }
      } finally {
        Date.now = realDateNow;
        if (realRaf === undefined) delete global.requestAnimationFrame;
        else global.requestAnimationFrame = realRaf;
        if (realCancelRaf === undefined) delete global.cancelAnimationFrame;
        else global.cancelAnimationFrame = realCancelRaf;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  };
}

function test(name, fn) {
  const env = withModule();
  try {
    fn(env);
    console.log(`✓ ${name}`);
  } finally {
    env.cleanup();
  }
}

test("answer-only structured delta updates answerContent and legacy content", ({ mod }) => {
  mod.streamAppend("m1", { answerDelta: "Hello", reasoning: false });
  mod.streamAppend("m1", { answerDelta: " world", reasoning: false });
  const data = mod.realtimeGet("m1");
  assert.equal(data.content, "Hello world");
  assert.equal(data.answerContent, "Hello world");
  assert.equal(data.reasoningContent, "");
  assert.equal(data.isReasoning, false);
});

test("reasoning delta then answer delta closes legacy think block", ({ mod }) => {
  mod.streamAppend("m2", { reasoningDelta: "plan", reasoning: true });
  let data = mod.realtimeGet("m2");
  assert.equal(data.content, "<think>plan");
  assert.equal(data.reasoningContent, "plan");
  assert.equal(data.answerContent, "");
  assert.equal(data.isReasoning, true);

  mod.streamAppend("m2", { answerDelta: "final", reasoning: false });
  data = mod.realtimeGet("m2");
  assert.equal(data.content, "<think>plan</think>final");
  assert.equal(data.reasoningContent, "plan");
  assert.equal(data.answerContent, "final");
  assert.equal(data.isReasoning, false);
});

test("legacy think-tag string append remains compatible", ({ mod }) => {
  mod.streamAppend("m3", "prefix ");
  mod.streamAppend("m3", "<think>why</think>");
  mod.streamAppend("m3", "answer");
  const data = mod.realtimeGet("m3");
  assert.equal(data.content, "prefix <think>why</think>answer");
  assert.equal(data.answerContent, "prefix answer");
  assert.equal(data.reasoningContent, "why");
  assert.equal(data.isReasoning, false);
});

test("realtimeUpdate creates immutable snapshot references", ({ mod }) => {
  mod.realtimeUpdate("m4", { content: "a" });
  const first = mod.realtimeGet("m4");
  mod.realtimeUpdate("m4", { searchStatus: "searching" });
  const second = mod.realtimeGet("m4");
  assert.notEqual(first, second);
  assert.equal(second.version, first.version + 1);
  assert.equal(Object.isFrozen(second), process.env.NODE_ENV !== "production");
});

test("explicit content, reasoning and phase APIs preserve legacy compatibility", ({ mod }) => {
  mod.realtimeAppendContent("api", "hello");
  mod.realtimeAppendReasoning("api", "plan");
  mod.realtimeSetPhase("api", "thinking");
  let data = mod.realtimeGet("api");
  assert.equal(data.answerContent, "hello");
  assert.equal(data.reasoningContent, "plan");
  assert.equal(data.content, "hello<think>plan");
  assert.equal(data.phase, "thinking");
  assert.equal(data.isReasoning, true);

  mod.realtimeSetReasoning("api", "new plan");
  data = mod.realtimeGet("api");
  assert.equal(data.reasoningContent, "new plan");
  assert.equal(data.answerContent, "hello");

  mod.realtimeSetContent("api", "final answer");
  data = mod.realtimeGet("api");
  assert.equal(data.content, "final answer");
  assert.equal(data.answerContent, "final answer");
  assert.equal(data.reasoningContent, "");
  assert.equal(data.isReasoning, false);
});

test("completed entries expire through explicit sweep and realtimeGet short TTL", ({ mod, advance }) => {
  mod.streamAppend("m5", { answerDelta: "done", reasoning: false });
  mod.realtimeUpdate("m5", { completedAt: Date.now() });
  assert.ok(mod.realtimeGet("m5"));
  advance(30_001);
  mod.realtimeSweepExpiredEntries(Date.now());
  assert.equal(mod.realtimeGet("m5"), undefined);
});

test("active entries expire through realtimeGet long TTL", ({ mod, advance }) => {
  mod.streamAppend("m6", { answerDelta: "active", reasoning: false });
  assert.ok(mod.realtimeGet("m6"));
  advance(10 * 60 * 1000 + 1);
  assert.equal(mod.realtimeGet("m6"), undefined);
});

test("max entries evicts oldest runtime data", ({ mod }) => {
  for (let i = 0; i < 205; i += 1) {
    mod.streamAppend(`entry-${i}`, { answerDelta: String(i), reasoning: false });
  }
  const snapshot = mod.realtimeDebugSnapshot();
  assert.equal(Object.keys(snapshot).length, 200);
  assert.equal(mod.realtimeGet("entry-0"), undefined);
  assert.ok(mod.realtimeGet("entry-204"));
});

test("unsubscribe removes listener and expired realtimeGet notifies subscribers once", ({ mod, advance }) => {
  let calls = 0;
  const unsubscribe = mod.realtimeSubscribe("listener-entry", () => { calls += 1; });
  mod.realtimeUpdate("listener-entry", { content: "active" });
  assert.equal(calls, 1);
  advance(10 * 60 * 1000 + 1);
  assert.equal(mod.realtimeGet("listener-entry"), undefined);
  assert.equal(calls, 1);
  unsubscribe();
  mod.realtimeUpdate("listener-entry", { content: "again" });
  assert.equal(calls, 1);
});

test("clear removes pending runtime data and listeners", ({ mod }) => {
  let calls = 0;
  const unsubscribe = mod.realtimeSubscribe("clear-entry", () => { calls += 1; });
  mod.realtimeUpdate("clear-entry", { content: "temporary" });
  assert.equal(calls, 1);
  mod.realtimeClear("clear-entry");
  assert.equal(mod.realtimeGet("clear-entry"), undefined);
  unsubscribe();
  mod.realtimeUpdate("clear-entry", { content: "again" });
  assert.equal(calls, 1);
});

console.log("\nstreaming regression tests passed");
process.exit(0);
