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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-main-stream-handler-regression-"));
  [
    "lib/chatSseParser.ts",
    "lib/chatStreamMeta.ts",
    "lib/chatStreamDelta.ts",
    "lib/chatDeltaApplier.ts",
    "lib/chatCompletionFinalizer.ts",
    "lib/chatStreamEventDecision.ts",
    "lib/chatStreamEventProcessor.ts",
    "lib/chatStreamActionHandler.ts",
    "lib/chatTaskInfo.ts",
    "lib/chatBackgroundTaskRegistration.ts",
    "lib/chatActivityStatus.ts",
    "lib/chatMainStreamEventHandler.ts",
  ].forEach((file) => transpileModule(file, tmpDir));
  return require(path.join(tmpDir, "chatMainStreamEventHandler.js"));
}

const { createMainStreamEventHandler } = loadModule();

const t = (key) => ({
  "chat.status.generating": "生成中",
  "chat.status.busy": "后台生成中",
  "chat.status.webSearching": "联网搜索中",
  "chat.status.webSearchDone": "联网搜索完成",
  "chat.status.fileSearching": "文件检索中",
  "chat.status.toolCalling": "工具调用中",
}[key] || key);

function makeHarness(options = {}) {
  const calls = [];
  let streamContent = options.streamContent;
  let realtimeData = options.realtimeData;
  const groupContexts = [];
  const handler = createMainStreamEventHandler({
    assistantMessageId: "assistant-1",
    assistantModelName: options.assistantModelName || "model-a",
    selectedModelName: "selected-model",
    conversationId: options.conversationId ?? 7,
    conversationTitle: options.conversationTitle || "对话标题",
    initialGroupMeta: options.initialGroupMeta,
    t,
    callbacks: {
      streamAppend: (messageId, delta) => calls.push(["append", messageId, delta]),
      streamGet: () => streamContent,
      realtimeGet: () => realtimeData,
      realtimeUpdate: (patch) => { realtimeData = { ...(realtimeData || {}), ...patch }; calls.push(["realtime", patch]); },
      registerBackgroundTask: (task) => calls.push(["register", task]),
      onGroupContext: (context) => { groupContexts.push(context); calls.push(["group", context]); },
    },
  });
  return { handler, calls, getRealtime: () => realtimeData, groupContexts };
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

test("handles chat meta request id", () => {
  const h = makeHarness();
  h.handler.processEvent(sse({ _chat_meta: { request_id: "req-1" } }));
  assert.equal(h.getRealtime().requestId, "req-1");
});

test("appends invalid JSON text and tracks accumulated content", () => {
  const h = makeHarness();
  h.handler.processEvent(sse("hello"));
  assert.equal(h.handler.getState().accumulated, "hello");
  assert.deepEqual(h.calls.at(-1), ["append", "assistant-1", { contentDelta: "hello", reasoning: false }]);
});

test("handles generation task meta, group context and registration", () => {
  const h = makeHarness();
  h.handler.processEvent(sse({
    _generation_task: {
      id: 42,
      assistant_message_id: 99,
      group_id: 5,
      user_message_id: 6,
      group_models: ["a", "b"],
      use_background: true,
    },
  }, 8));
  const state = h.handler.getState();
  assert.equal(state.serverMessageId, 99);
  assert.equal(state.generationTaskId, 42);
  assert.equal(state.lastSequence, 8);
  assert.deepEqual(state.groupContext, { groupId: 5, userMessageId: 6, groupModels: ["a", "b"] });
  assert.equal(h.groupContexts.length, 1);
  const registration = h.calls.find((call) => call[0] === "register")[1];
  assert.equal(registration.key, "chat:99");
  assert.equal(registration.href, "/chat?id=7");
  assert.equal(registration.description, "对话标题");
});

test("handles background task meta and registration", () => {
  const h = makeHarness();
  h.handler.processEvent(sse({ _background_task: { id: "bg-1", assistant_message_id: 77 } }));
  const state = h.handler.getState();
  assert.equal(state.serverMessageId, 77);
  assert.equal(state.useBackground, true);
  assert.equal(h.getRealtime().backgroundTaskId, "bg-1");
  assert.equal(h.calls.find((call) => call[0] === "register")[1].key, "chat:77");
});

test("handles error payload with content patch", () => {
  const h = makeHarness({ realtimeData: { requestId: "req-1" } });
  h.handler.processEvent(sse({ _error: { code: "boom", message: "失败", retryable: true } }));
  assert.equal(h.handler.getState().accumulated, "失败");
  assert.equal(h.getRealtime().content, "失败");
  assert.equal(h.getRealtime().requestId, "req-1");
  assert.equal(h.getRealtime().errorCode, "boom");
});

test("handles search payload", () => {
  const h = makeHarness();
  h.handler.processEvent(sse({ _search_meta: { status: "completed", sources: [{ title: "A" }], sources_count: 1 } }));
  assert.equal(h.getRealtime().searchStatus, "completed");
  assert.equal(h.getRealtime().searchSourcesCount, 1);
  assert.equal(h.getRealtime().activityStatus.label, "联网搜索完成");
});

test("handles delta payload and content status", () => {
  const h = makeHarness();
  h.handler.processEvent(sse({ choices: [{ delta: { content: "answer" } }] }));
  assert.equal(h.handler.getState().accumulated, "answer");
  assert.deepEqual(h.calls.find((call) => call[0] === "append"), ["append", "assistant-1", { answerDelta: "answer", reasoning: false }]);
  assert.equal(h.getRealtime().activityStatus.label, "生成中");
});

test("handles done, closes open reasoning, clears search status, and marks sawDone", () => {
  const h = makeHarness({ streamContent: "answer", realtimeData: { searchStatus: "searching" } });
  h.handler.processEvent(sse({ choices: [{ delta: { reasoning_content: "hidden" } }] }));
  h.handler.processEvent(sse("[DONE]", 11));
  const state = h.handler.getState();
  assert.equal(state.sawDone, true);
  assert.equal(state.lastSequence, 11);
  assert.equal(state.accumulated, "<think>hidden</think>");
  assert.deepEqual(h.calls.filter((call) => call[0] === "append").at(-1), ["append", "assistant-1", { reasoning: false }]);
  assert.equal(h.getRealtime().completedAt !== undefined, true);
  assert.equal(h.getRealtime().searchStatus, undefined);
});

test("flushes pending mixed-delta answer on done", () => {
  const h = makeHarness();
  h.handler.processEvent(sse({ choices: [{ delta: { reasoning_content: "why", content: "OK 42" } }] }));
  h.handler.processEvent(sse("[DONE]", 12));
  assert.equal(h.handler.getState().accumulated, "<think>why</think>OK 42");
  assert.deepEqual(h.calls.filter((call) => call[0] === "append"), [
    ["append", "assistant-1", { reasoningDelta: "why", reasoning: true }],
    ["append", "assistant-1", { reasoning: false }],
    ["append", "assistant-1", { answerDelta: "OK 42", reasoning: false }],
  ]);
});

test("setRecoverable updates run state", () => {
  const h = makeHarness();
  h.handler.setRecoverable(true);
  assert.equal(h.handler.getState().recoverable, true);
});

console.log("\nchat main stream event handler regression tests passed");
