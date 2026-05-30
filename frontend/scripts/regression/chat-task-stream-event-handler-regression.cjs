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
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      strict: true,
    },
    fileName: path.join(projectRoot, sourceFile),
  }).outputText;
  const outPath = path.join(tmpDir, sourceFile.replace(/^lib\//, "").replace(/\.ts$/, ".js"));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output);
}

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-task-stream-handler-regression-"));
  [
    "lib/chatSseParser.ts",
    "lib/chatStreamMeta.ts",
    "lib/chatStreamDelta.ts",
    "lib/chatDeltaApplier.ts",
    "lib/chatCompletionFinalizer.ts",
    "lib/chatStreamEventDecision.ts",
    "lib/chatStreamEventProcessor.ts",
    "lib/chatStreamActionHandler.ts",
    "lib/chatTaskEventDecision.ts",
    "lib/chatTaskInfo.ts",
    "lib/chatTaskStreamFinalizer.ts",
    "lib/chatActivityStatus.ts",
    "lib/chatTaskStreamEventHandler.ts",
  ].forEach((file) => transpileModule(file, tmpDir));
  return require(path.join(tmpDir, "chatTaskStreamEventHandler.js"));
}

const { createTaskStreamEventHandler } = loadModule();

const t = (key) => ({
  "chat.status.generating": "生成中",
  "chat.status.finalizing": "正在整理最终内容",
  "chat.status.finalizingEmpty": "正在等待内容",
  "chat.status.webSearching": "联网搜索中",
  "chat.status.webSearchDone": "联网搜索完成",
  "chat.status.fileSearching": "文件检索中",
  "chat.status.toolCalling": "工具调用中",
}[key] || key);

function makeHarness(options = {}) {
  const calls = [];
  let activeState = options.activeState;
  let streamContent = options.streamContent;
  let realtimeData = options.realtimeData;
  const handler = createTaskStreamEventHandler({
    convId: options.convId ?? 7,
    localMessageId: "local-1",
    serverMessageId: options.serverMessageId ?? 10,
    generationTaskId: options.generationTaskId ?? 20,
    after: options.after ?? 0,
    initialContent: options.initialContent ?? "",
    t,
    callbacks: {
      getActiveState: () => activeState,
      setActiveState: (state) => { activeState = state; calls.push(["setActive", state]); },
      deleteActiveState: () => { activeState = undefined; calls.push(["deleteActive"]); },
      streamAppend: (messageId, delta) => calls.push(["append", messageId, delta]),
      streamGet: () => streamContent,
      realtimeGet: () => realtimeData,
      realtimeUpdate: (patch) => { realtimeData = { ...(realtimeData || {}), ...patch }; calls.push(["realtime", patch]); },
      startBackgroundPolling: (serverMessageId) => calls.push(["poll", serverMessageId]),
    },
  });
  return { handler, calls, getActiveState: () => activeState, getRealtime: () => realtimeData };
}

function sse(data, id) {
  return `${id !== undefined ? `id: ${id}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
}

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

test("updates sequence and active state for empty events", () => {
  const h = makeHarness({ initialContent: "seed" });
  h.handler.processEvent("id: 5\n\n");
  assert.equal(h.handler.getLatestSequence(), 5);
  assert.deepEqual(h.getActiveState(), {
    convId: 7,
    serverMessageId: 10,
    generationTaskId: 20,
    lastSequence: 5,
    content: "seed",
  });
});

test("appends invalid JSON text and updates accumulated", () => {
  const h = makeHarness({ initialContent: "A" });
  h.handler.processEvent(sse("B", 1));
  assert.equal(h.handler.getAccumulated(), "AB");
  assert.deepEqual(h.calls.at(-1), ["append", "local-1", "B"]);
});

test("handles generation task payload with active state and realtime patch", () => {
  const h = makeHarness();
  h.handler.processEvent(sse({ _generation_task: { task_id: 42, server_message_id: 99, use_background: true } }, 3));
  assert.equal(h.getActiveState().generationTaskId, 42);
  assert.equal(h.getActiveState().serverMessageId, 10);
  assert.equal(h.getActiveState().lastSequence, 3);
  const realtime = h.calls.find((call) => call[0] === "realtime")[1];
  assert.equal(realtime.serverMessageId, 10);
  assert.equal(realtime.generationTaskId, 42);
  assert.equal(realtime.useBackground, true);
  assert.equal(realtime.activityStatus.label, "生成中");
});

test("handles error payload with fallback request id", () => {
  const h = makeHarness({ realtimeData: { requestId: "req-1" } });
  h.handler.processEvent(sse({ _error: { code: "boom", message: "失败", retryable: true } }));
  assert.equal(h.handler.getAccumulated(), "失败");
  assert.deepEqual(h.getRealtime(), {
    requestId: "req-1",
    errorCode: "boom",
    retryable: true,
    activityStatus: undefined,
    searchStatus: undefined,
    searchSources: undefined,
  });
});

test("handles search payload", () => {
  const h = makeHarness();
  h.handler.processEvent(sse({ _search_meta: { status: "completed", sources: [{ title: "A" }], sources_count: 1 } }));
  const patch = h.calls.find((call) => call[0] === "realtime")[1];
  assert.equal(patch.searchStatus, "completed");
  assert.equal(patch.searchSourcesCount, 1);
  assert.equal(patch.activityStatus.label, "联网搜索完成");
});

test("handles delta payload and refreshes active content", () => {
  const h = makeHarness({ initialContent: "Hi " });
  h.handler.processEvent(sse({ choices: [{ delta: { content: "there" } }] }, 8));
  assert.equal(h.handler.getAccumulated(), "Hi there");
  assert.deepEqual(h.calls.find((call) => call[0] === "append"), ["append", "local-1", { answerDelta: "there", reasoning: false }]);
  assert.equal(h.getActiveState().content, "Hi there");
  assert.equal(h.getActiveState().lastSequence, 8);
});

test("handles done, closes open reasoning and starts polling when content exists", () => {
  const h = makeHarness({ initialContent: "<think>hidden", streamContent: "answer" });
  h.handler.processEvent(sse("[DONE]", 9));
  assert.equal(h.handler.hasSeenDone(), true);
  assert.equal(h.handler.getAccumulated(), "<think>hidden</think>");
  assert.deepEqual(h.calls[1], ["append", "local-1", { reasoning: false }]);
  assert.equal(h.calls.some((call) => call[0] === "deleteActive"), true);
  assert.deepEqual(h.calls.at(-1), ["poll", 10]);
});

test("flushes pending mixed-delta answer on done", () => {
  const h = makeHarness();
  h.handler.processEvent(sse({ choices: [{ delta: { reasoning_content: "why", content: "OK 42" } }] }, 8));
  h.handler.processEvent(sse("[DONE]", 9));
  assert.equal(h.handler.getAccumulated(), "<think>why</think>OK 42");
  assert.deepEqual(h.calls.filter((call) => call[0] === "append"), [
    ["append", "local-1", { reasoningDelta: "why", reasoning: true }],
    ["append", "local-1", { reasoning: false }],
    ["append", "local-1", { answerDelta: "OK 42", reasoning: false }],
  ]);
});

console.log("\nchat task stream event handler regression tests passed");
