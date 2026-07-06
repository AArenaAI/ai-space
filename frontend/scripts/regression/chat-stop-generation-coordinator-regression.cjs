#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-stop-generation-coordinator-regression-"));
  const source = fs.readFileSync(path.join(projectRoot, "lib/chatStopGenerationCoordinator.ts"), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, strict: true },
    fileName: path.join(projectRoot, "lib/chatStopGenerationCoordinator.ts"),
  }).outputText;
  const outPath = path.join(tmpDir, "chatStopGenerationCoordinator.js");
  fs.writeFileSync(outPath, output);
  return require(outPath);
}

const {
  collectRunningGenerationTaskIds,
  buildCancelGenerationTaskUrl,
  buildStopGenerationPlan,
  cancelGenerationTask,
  runStopGeneration,
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

(async () => {
  await test("collectRunningGenerationTaskIds dedupes active assistant task ids", () => {
    const messages = [
      { role: "user", generationTaskId: 1 },
      { role: "assistant", generationTaskId: 2 },
      { role: "assistant", generationTaskId: 2 },
      { role: "assistant", generationTaskId: 3, completedAt: 123 },
      { role: "assistant" },
      { role: "assistant", generationTaskId: 4 },
    ];
    assert.deepEqual(collectRunningGenerationTaskIds(messages), [2, 4]);
  });

  await test("buildCancelGenerationTaskUrl formats cancel endpoint", () => {
    assert.equal(buildCancelGenerationTaskUrl({ apiBaseUrl: "http://api", taskId: 9 }), "http://api/api/tasks/9/cancel");
    assert.equal(buildCancelGenerationTaskUrl({ taskId: 5 }), "/api/tasks/5/cancel");
  });

  await test("buildStopGenerationPlan summarizes tasks and controllers", () => {
    const plan = buildStopGenerationPlan({
      messages: [{ role: "assistant", generationTaskId: 8 }],
      mainController: { abort() {} },
      compareControllers: [{ abort() {} }, { abort() {} }],
    });
    assert.deepEqual(plan, {
      taskIds: [8],
      hasMainController: true,
      compareControllerCount: 2,
      shouldSetAbortReason: true,
    });
  });

  await test("buildStopGenerationPlan does not require abort reason without controllers", () => {
    const plan = buildStopGenerationPlan({
      messages: [{ role: "assistant", generationTaskId: 8 }],
      mainController: null,
      compareControllers: [],
    });
    assert.equal(plan.shouldSetAbortReason, false);
  });

  await test("cancelGenerationTask posts cancel request and swallows fetch errors", async () => {
    const calls = [];
    await cancelGenerationTask({
      apiBaseUrl: "http://api",
      taskId: 11,
      headers: { Authorization: "Bearer token" },
      fetchImpl: async (url, init) => {
        calls.push([url, init.method, init.headers.Authorization]);
        return { ok: true };
      },
    });
    assert.deepEqual(calls, [["http://api/api/tasks/11/cancel", "POST", "Bearer token"]]);

    await cancelGenerationTask({
      taskId: 12,
      headers: {},
      fetchImpl: async () => { throw new Error("network"); },
    });
  });

  await test("runStopGeneration cancels tasks, aborts streams and clears controllers", () => {
    const events = [];
    const main = { abort: () => events.push("main-abort") };
    const compareA = { abort: () => events.push("compare-a-abort") };
    const compareB = { abort: () => events.push("compare-b-abort") };

    const plan = runStopGeneration({
      messages: [
        { role: "assistant", generationTaskId: 1 },
        { role: "assistant", generationTaskId: 1 },
        { role: "assistant", generationTaskId: 2, completedAt: 10 },
        { role: "assistant", generationTaskId: 3 },
      ],
      callbacks: {
        cancelTask: (taskId) => events.push(["cancel", taskId]),
        abortTaskStreams: () => events.push("task-streams-abort"),
        abortStreamOwners: () => events.push("owners-abort"),
        getMainAbortController: () => main,
        clearMainAbortController: () => events.push("main-clear"),
        getCompareAbortControllers: () => [compareA, compareB],
        clearCompareAbortControllers: () => events.push("compare-clear"),
        setAbortReason: (reason) => events.push(["reason", reason]),
      },
    });

    assert.deepEqual(plan.taskIds, [1, 3]);
    assert.deepEqual(events, [
      ["cancel", 1],
      ["cancel", 3],
      "task-streams-abort",
      "owners-abort",
      ["reason", "user"],
      "main-abort",
      "main-clear",
      ["reason", "user"],
      "compare-a-abort",
      "compare-b-abort",
      "compare-clear",
    ]);
  });

  await test("runStopGeneration still aborts task streams when there are no controllers", () => {
    const events = [];
    const plan = runStopGeneration({
      messages: [],
      callbacks: {
        cancelTask: (taskId) => events.push(["cancel", taskId]),
        abortTaskStreams: () => events.push("task-streams-abort"),
        abortStreamOwners: () => events.push("owners-abort"),
        getMainAbortController: () => null,
        clearMainAbortController: () => events.push("main-clear"),
        getCompareAbortControllers: () => [],
        clearCompareAbortControllers: () => events.push("compare-clear"),
        setAbortReason: (reason) => events.push(["reason", reason]),
      },
    });
    assert.deepEqual(plan, {
      taskIds: [],
      hasMainController: false,
      compareControllerCount: 0,
      shouldSetAbortReason: false,
    });
    assert.deepEqual(events, ["task-streams-abort", "owners-abort"]);
  });

  if (!process.exitCode) console.log("\nchat stop generation coordinator regression tests passed");
})();
