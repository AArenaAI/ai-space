#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");

function transpileModule(sourceFile, tmpDir) {
  const source = fs.readFileSync(path.join(projectRoot, sourceFile), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, strict: true },
    fileName: path.join(projectRoot, sourceFile),
  }).outputText;
  const outPath = path.join(tmpDir, sourceFile.replace(/^lib\//, "").replace(/\.ts$/, ".js"));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output);
}

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-background-polling-runner-regression-"));
  [
    "lib/chatCompletionFinalizer.ts",
    "lib/chatBackgroundPolling.ts",
    "lib/chatBackgroundPollingRunner.ts",
  ].forEach((file) => transpileModule(file, tmpDir));
  return require(path.join(tmpDir, "chatBackgroundPollingRunner.js"));
}

const {
  buildBackgroundPollingMessageUrl,
  normalizeBackgroundPollingResponse,
  createBackgroundPollingTick,
  startBackgroundPollingRunner,
} = loadModule();

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function response(ok, data) {
  return { ok, json: async () => data };
}

(async () => {
  await test("buildBackgroundPollingMessageUrl formats conversation message URL", () => {
    assert.equal(buildBackgroundPollingMessageUrl({ apiBaseUrl: "http://api", conversationId: 7, serverMessageId: 9 }), "http://api/api/conversations/7/messages/9");
    assert.equal(buildBackgroundPollingMessageUrl({ conversationId: 1, serverMessageId: 2 }), "/api/conversations/1/messages/2");
  });

  await test("normalizeBackgroundPollingResponse defaults missing content and status", () => {
    assert.deepEqual(normalizeBackgroundPollingResponse(undefined), { content: "", reasoningContent: "", status: "" });
    assert.deepEqual(normalizeBackgroundPollingResponse({ message: { content: "hi" }, background_task: { status: "completed" } }), { content: "hi", reasoningContent: "", status: "completed" });
  });

  await test("poll tick fetches state and keeps loading for empty content", async () => {
    const calls = [];
    const tick = createBackgroundPollingTick({
      apiBaseUrl: "http://api",
      conversationId: 3,
      serverMessageId: 4,
      headers: { Authorization: "Bearer token" },
      callbacks: {
        fetchImpl: async (url, init) => { calls.push(["fetch", url, init.headers.Authorization]); return response(true, { message: { content: "" }, background_task: { status: "running" } }); },
        onPollState: (state) => calls.push(["state", state.status, state.hasContent]),
        onFinished: () => calls.push(["finished"]),
        onKeepLoading: (state) => calls.push(["keep", state.status]),
        shouldKeepLoading: (state) => !state.hasContent,
        isStreamActive: () => false,
      },
    });
    await tick.poll();
    assert.deepEqual(calls, [
      ["fetch", "http://api/api/conversations/3/messages/4", "Bearer token"],
      ["state", "running", false],
      ["keep", "running"],
    ]);
  });

  await test("poll tick reports finished only when stream is inactive", async () => {
    const inactiveCalls = [];
    const inactive = createBackgroundPollingTick({
      conversationId: 1,
      serverMessageId: 2,
      headers: {},
      callbacks: {
        fetchImpl: async () => response(true, { message: { content: "done" }, background_task: { status: "completed" } }),
        onPollState: (state) => inactiveCalls.push(["state", state.isFinished]),
        onFinished: (state) => inactiveCalls.push(["finished", state.isCompleted]),
        onKeepLoading: () => inactiveCalls.push(["keep"]),
        shouldKeepLoading: () => true,
        isStreamActive: () => false,
      },
    });
    await inactive.poll();
    assert.deepEqual(inactiveCalls, [["state", true], ["finished", true]]);

    const activeCalls = [];
    const active = createBackgroundPollingTick({
      conversationId: 1,
      serverMessageId: 2,
      headers: {},
      callbacks: {
        fetchImpl: async () => response(true, { message: { content: "done" }, background_task: { status: "completed" } }),
        onPollState: (state) => activeCalls.push(["state", state.isFinished]),
        onFinished: () => activeCalls.push(["finished"]),
        onKeepLoading: (state) => activeCalls.push(["keep", state.status]),
        shouldKeepLoading: () => true,
        isStreamActive: () => true,
      },
    });
    await active.poll();
    assert.deepEqual(activeCalls, [["state", true], ["keep", "completed"]]);
  });

  await test("poll tick preserves stable soft-terminal count", async () => {
    let polls = 0;
    const finished = [];
    const tick = createBackgroundPollingTick({
      conversationId: 1,
      serverMessageId: 2,
      headers: {},
      callbacks: {
        fetchImpl: async () => { polls += 1; return response(true, { message: { content: "partial" }, background_task: { status: "failed" } }); },
        onPollState: () => {},
        onFinished: (state) => finished.push([polls, state.terminalStableCount]),
        onKeepLoading: () => {},
        shouldKeepLoading: () => false,
        isStreamActive: () => false,
      },
    });
    await tick.poll();
    await tick.poll();
    await tick.poll();
    await tick.poll();
    assert.deepEqual(finished, [[4, 3]]);
    assert.equal(tick.getTerminalStableCount(), 3);
    assert.equal(tick.getLastContent(), "partial");
  });

  await test("poll tick ignores non-ok and thrown fetch responses", async () => {
    const calls = [];
    const tick = createBackgroundPollingTick({
      conversationId: 1,
      serverMessageId: 2,
      headers: {},
      callbacks: {
        fetchImpl: async () => response(false, {}),
        onPollState: () => calls.push("state"),
        onFinished: () => calls.push("finished"),
        onKeepLoading: () => calls.push("keep"),
        shouldKeepLoading: () => true,
        isStreamActive: () => false,
      },
    });
    await tick.poll();
    assert.deepEqual(calls, []);

    const thrown = createBackgroundPollingTick({
      conversationId: 1,
      serverMessageId: 2,
      headers: {},
      callbacks: {
        fetchImpl: async () => { throw new Error("network"); },
        onPollState: () => calls.push("state"),
        onFinished: () => calls.push("finished"),
        onKeepLoading: () => calls.push("keep"),
        shouldKeepLoading: () => true,
        isStreamActive: () => false,
      },
    });
    await thrown.poll();
    assert.deepEqual(calls, []);
  });

  await test("startBackgroundPollingRunner polls immediately and registers interval", async () => {
    const calls = [];
    const runner = startBackgroundPollingRunner({
      conversationId: 1,
      serverMessageId: 2,
      headers: {},
      intervalMs: 123,
      callbacks: {
        fetchImpl: async () => { calls.push("fetch"); return response(true, { message: { content: "" }, background_task: { status: "running" } }); },
        setIntervalImpl: (handler, timeout) => { calls.push(["interval", timeout, typeof handler]); return 101; },
        onPollState: () => calls.push("state"),
        onFinished: () => calls.push("finished"),
        onKeepLoading: () => calls.push("keep"),
        shouldKeepLoading: () => true,
        isStreamActive: () => false,
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(runner.timer, 101);
    assert.deepEqual(calls, ["fetch", ["interval", 123, "function"], "state", "keep"]);
  });

  if (!process.exitCode) console.log("\nchat background polling runner regression tests passed");
})();
