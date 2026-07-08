#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true,
};
function compile(relativePath) {
  const sourcePath = path.join(projectRoot, relativePath);
  const source = fs.readFileSync(sourcePath, "utf8");
  return ts.transpileModule(source, { compilerOptions, fileName: sourcePath }).outputText;
}
const compiled = compile("lib/streaming.ts");
const compiledStatusTimeline = compile("lib/chatStatusTimeline.ts");
const compiledGenerationPhase = compile("lib/chatGenerationPhase.ts");

function withModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "streaming-regression-"));
  const tmpFile = path.join(tmpDir, "streaming.cjs");
  fs.writeFileSync(path.join(tmpDir, "chatGenerationPhase.js"), compiledGenerationPhase, "utf8");
  fs.writeFileSync(path.join(tmpDir, "chatStatusTimeline.js"), compiledStatusTimeline, "utf8");
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
  mod.realtimeAppend("m1", { answerDelta: "Hello", reasoning: false });
  mod.realtimeAppend("m1", { answerDelta: " world", reasoning: false });
  const data = mod.realtimeGet("m1");
  assert.equal(data.content, "Hello world");
  assert.equal(data.answerContent, "Hello world");
  assert.equal(data.reasoningContent, "");
  assert.equal(data.isReasoning, false);
});

test("reasoning delta then answer delta closes legacy think block", ({ mod }) => {
  mod.realtimeAppend("m2", { reasoningDelta: "plan", reasoning: true });
  let data = mod.realtimeGet("m2");
  assert.equal(data.content, "<think>plan");
  assert.equal(data.reasoningContent, "plan");
  assert.equal(data.answerContent, "");
  assert.equal(data.isReasoning, true);

  mod.realtimeAppend("m2", { answerDelta: "final", reasoning: false });
  data = mod.realtimeGet("m2");
  assert.equal(data.content, "<think>plan</think>final");
  assert.equal(data.reasoningContent, "plan");
  assert.equal(data.answerContent, "final");
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

test("explicit content, reasoning and phase APIs preserve structured runtime state", ({ mod }) => {
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
  mod.realtimeAppend("m5", { answerDelta: "done", reasoning: false });
  mod.realtimeUpdate("m5", { completedAt: Date.now() });
  assert.ok(mod.realtimeGet("m5"));
  advance(30_001);
  mod.realtimeSweepExpiredEntries(Date.now());
  assert.equal(mod.realtimeGet("m5"), undefined);
});

test("mark completed keeps realtime snapshot briefly then expires", ({ mod, advance }) => {
  mod.realtimeAppend("m-final", { reasoningDelta: "plan", reasoning: true });
  mod.realtimeAppend("m-final", { answerDelta: "answer", reasoning: false });
  mod.realtimeMarkCompleted("m-final", Date.now());
  let data = mod.realtimeGet("m-final");
  assert.ok(data);
  assert.equal(data.reasoningContent, "plan");
  assert.equal(data.answerContent, "answer");
  assert.equal(data.phase, "completed");
  assert.equal(data.activityStatus, undefined);
  assert.equal(data.searchStatus, undefined);
  assert.equal(data.isReasoning, false);
  assert.deepEqual((data.statusTimeline || []).map((step) => `${step.kind}:${step.status}`), [
    "reasoning:completed",
    "streaming_answer:completed",
  ]);
  advance(5_001);
  mod.realtimeSweepExpiredEntries(Date.now());
  assert.equal(mod.realtimeGet("m-final"), undefined);
});

test("status timeline keeps original startedAt when a running step completes", ({ mod, advance }) => {
  mod.realtimeUpdate("timeline-order", { phase: "waiting_provider", generationStartedAt: Date.now() });
  advance(80);
  mod.realtimeUpdate("timeline-order", {
    searchStatus: "searching",
    activityStatus: { kind: "web_search", status: "running", label: "正在联网搜索" },
    phase: "searching",
  });
  advance(120);
  mod.realtimeUpdate("timeline-order", {
    searchStatus: "completed",
    searchSourcesCount: 3,
    activityStatus: { kind: "web_search", status: "completed", label: "联网搜索完成" },
  });
  advance(120);
  mod.realtimeAppend("timeline-order", { reasoningDelta: "plan", reasoning: true });
  advance(120);
  mod.realtimeAppend("timeline-order", { answerDelta: "answer", reasoning: false });
  mod.realtimeMarkCompleted("timeline-order", Date.now());

  const data = mod.realtimeGet("timeline-order");
  const timeline = data.statusTimeline || [];
  const searchRunning = timeline.find((step) => step.id === "web_search:running");
  const searchCompleted = timeline.find((step) => step.id === "web_search:completed");
  const reasoning = timeline.find((step) => step.id === "reasoning:completed");
  const answer = timeline.find((step) => step.id === "streaming_answer:completed");

  assert.equal(searchRunning, undefined, "terminal timeline should not keep stale search running step");
  assert.ok(searchCompleted, "search completed step should be present");
  assert.ok((searchCompleted.endedAt || 0) > searchCompleted.startedAt, "search completed should end after it started");
  assert.ok(reasoning.startedAt > searchCompleted.startedAt, "reasoning should start after search starts");
  assert.ok(answer.startedAt > reasoning.startedAt, "answer should start after reasoning starts");
});

test("ordered timeline prefers semantic phase order over noisy timestamps", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "timeline-order-helper-"));
  try {
    fs.writeFileSync(path.join(tmpDir, "chatGenerationPhase.js"), compiledGenerationPhase, "utf8");
    fs.writeFileSync(path.join(tmpDir, "chatStatusTimeline.js"), compiledStatusTimeline, "utf8");
    const { getOrderedTimelineSteps } = require(path.join(tmpDir, "chatStatusTimeline.js"));
    const steps = getOrderedTimelineSteps([
      { id: "waiting_provider:running", kind: "waiting_provider", status: "running", startedAt: 0 },
      { id: "web_search:completed", kind: "web_search", status: "completed", startedAt: 1, endedAt: 8, count: 8 },
      { id: "streaming_answer:running", kind: "streaming_answer", status: "running", startedAt: 2, endedAt: 12 },
      { id: "reasoning:running", kind: "reasoning", status: "running", startedAt: 7, endedAt: 12 },
    ]);
    assert.deepEqual(
      steps.map((step) => step.id),
      ["waiting_provider:running", "web_search:completed", "reasoning:running", "streaming_answer:running"],
      "reasoning should display before answer generation even if its captured timestamp is later"
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("active entries expire through realtimeGet long TTL", ({ mod, advance }) => {
  mod.realtimeAppend("m6", { answerDelta: "active", reasoning: false });
  assert.ok(mod.realtimeGet("m6"));
  advance(10 * 60 * 1000 + 1);
  assert.equal(mod.realtimeGet("m6"), undefined);
});

test("max entries evicts oldest runtime data", ({ mod }) => {
  for (let i = 0; i < 205; i += 1) {
    mod.realtimeAppend(`entry-${i}`, { answerDelta: String(i), reasoning: false });
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

test("clear removes runtime data, notifies mounted subscribers, and unsubscribe still detaches", ({ mod }) => {
  let calls = 0;
  const unsubscribe = mod.realtimeSubscribe("clear-entry", () => { calls += 1; });
  mod.realtimeUpdate("clear-entry", { content: "temporary" });
  assert.equal(calls, 1);
  mod.realtimeClear("clear-entry");
  assert.equal(mod.realtimeGet("clear-entry"), undefined);
  assert.equal(calls, 2);
  unsubscribe();
  mod.realtimeUpdate("clear-entry", { content: "again" });
  assert.equal(calls, 2);
});

console.log("\nstreaming regression tests passed");
process.exit(0);
