#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "../..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-task-stream-runtime-hook-"));
const outFile = path.join(tempDir, "useChatTaskStreamRuntime.cjs");
const sourceFile = path.join(repoRoot, "hooks/useChatTaskStreamRuntime.ts");
const finalizerFile = path.join(repoRoot, "lib/chatTaskStreamFinalizer.ts");
const messagePatchFile = path.join(repoRoot, "lib/chatMessageStatePatch.ts");
let source = fs.readFileSync(sourceFile, "utf8");
let finalizerSource = fs.readFileSync(finalizerFile, "utf8");
finalizerSource = finalizerSource.replace(/import \{ buildFinalizingPatch, type ChatActivityStatus, type ChatCompletionPatch \} from "\.\/chatCompletionFinalizer";\n/g, "const buildFinalizingPatch = ({ hasContent, createFinalizingStatus }) => ({ activityStatus: createFinalizingStatus(hasContent) });\n");
source = source.replace(/import type[^;]+react[^;]+;\n/g, "");
source = source.replace(/import type[^;]+streaming[^;]+;\n/g, "");
source = source.replace(/import type[^;]+chatTypes[^;]+;\n/g, "");
source = source.replace(/import \{ getConversationSnapshot, patchConversationSnapshot \} from "@\/lib\/chatConversationCache";\n/g, "const getConversationSnapshot = () => undefined; const patchConversationSnapshot = () => {};\n");
source = source.replace(/import \{ useCallback, useRef \} from "react";\n/g, "const useCallback = (fn) => fn; const useRef = (current) => ({ current });\n");
source = source.replace(/import \{ getGuestId as defaultGetGuestId \} from "@\/lib\/guestId";\n/g, "const defaultGetGuestId = () => 'guest';\n");
source = source.replace(/import \{ realtimeAppend as defaultRealtimeAppend, realtimeGet as defaultRealtimeGet, realtimeUpdate as defaultRealtimeUpdate, realtimeMarkCompleted as defaultRealtimeMarkCompleted \} from "@\/lib\/streaming";\n/g, "const defaultRealtimeAppend = () => {}; const defaultRealtimeGet = () => undefined; const defaultRealtimeUpdate = () => {}; const defaultRealtimeMarkCompleted = () => {};\n");
source = source.replace(
  /import \{\n  shouldStartTaskStreamFallbackPolling,\n  shouldSyncTaskStreamFinalMessage,\n\} from "@\/lib\/chatTaskStreamFinalizer";\n/g,
  finalizerSource.replace(/export /g, "") + "\n"
);
source = source.replace(/import \{ createTaskStreamEventHandler as defaultCreateTaskStreamEventHandler \} from "@\/lib\/chatTaskStreamEventHandler";\n/g, "const defaultCreateTaskStreamEventHandler = () => ({ processEvent(){}, getAccumulated(){ return ''; }, getLatestSequence(){ return 0; } });\n");
source = source.replace(/import \{\n  runTaskEventStream as defaultRunTaskEventStream,\n  shouldFallbackToBackgroundPollingAfterTaskStreamError,\n\} from "@\/lib\/chatTaskStreamLifecycle";\n/g, "const defaultRunTaskEventStream = async () => {}; const shouldFallbackToBackgroundPollingAfterTaskStreamError = (signal) => !signal.aborted;\n");
source = source.replace(
  /import \{\n  applyFinalRealtimeDataToMessage,\n  patchMessageById,\n\} from "@\/lib\/chatMessageStatePatch";\n/g,
  fs.readFileSync(messagePatchFile, "utf8").replace(/export /g, "") + "\n"
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
    skipLibCheck: true,
  },
  fileName: sourceFile,
});
fs.writeFileSync(outFile, compiled.outputText);

const {
  createStopAllTaskStreamsAction,
  createStartTaskEventStreamAction,
} = require(outFile);

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}
function createState(initial) {
  let value = initial;
  return {
    get: () => value,
    set: (next) => {
      value = typeof next === "function" ? next(value) : next;
    },
  };
}
function makeController() {
  const signal = { aborted: false };
  return {
    signal,
    abort: () => {
      signal.aborted = true;
    },
  };
}

test("createStopAllTaskStreamsAction aborts controllers and clears refs", () => {
  const c1 = makeController();
  const c2 = makeController();
  const taskStreamsRef = { current: { a: c1, b: c2 } };
  const activeTaskStreamsRef = { current: { a: { content: "x" } } };
  const stop = createStopAllTaskStreamsAction({ taskStreamsRef, activeTaskStreamsRef });
  stop();
  assert.equal(c1.signal.aborted, true);
  assert.equal(c2.signal.aborted, true);
  assert.deepEqual(taskStreamsRef.current, {});
  assert.deepEqual(activeTaskStreamsRef.current, {});
});

test("createStartTaskEventStreamAction guards missing ids and duplicate streams", () => {
  const calls = [];
  const action = createStartTaskEventStreamAction({
    apiBaseUrl: "",
    taskStreamsRef: { current: { dup: makeController() } },
    activeTaskStreamsRef: { current: {} },
    setMessages: () => {},
    setIsLoading: () => {},
    startBackgroundPolling: () => {},
    translate: (key) => key,
    runTaskEventStream: (...args) => {
      calls.push(args);
      return Promise.resolve();
    },
  });
  action(undefined, "a", 1);
  action(1, "a");
  action(1, "dup", 1);
  assert.equal(calls.length, 0);
});

test("start action stores active state, headers and forwards events", async () => {
  const taskStreamsRef = { current: {} };
  const activeTaskStreamsRef = { current: {} };
  const loading = createState(false);
  const events = [];
  let runOptions;
  const handler = {
    processEvent: (event) => events.push(event),
    getAccumulated: () => "",
    getLatestSequence: () => 0,
  };
  const action = createStartTaskEventStreamAction({
    apiBaseUrl: "/api",
    taskStreamsRef,
    activeTaskStreamsRef,
    setMessages: () => {},
    setIsLoading: loading.set,
    startBackgroundPolling: () => {},
    translate: (key) => key,
    getToken: () => "tok",
    getGuestId: () => "guest",
    createAbortController: makeController,
    createTaskStreamEventHandler: (opts) => {
      assert.equal(opts.convId, 9);
      assert.equal(opts.serverMessageId, 11);
      assert.equal(opts.generationTaskId, 22);
      assert.equal(opts.after, 3);
      assert.equal(opts.initialContent, "seed");
      opts.callbacks.setActiveState({ content: "seed+" });
      return handler;
    },
    runTaskEventStream: async (opts) => {
      runOptions = opts;
      opts.onEvent("event-1");
    },
  });
  action(9, "local", 11, 3, "seed", 22);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(loading.get(), true);
  assert.equal(taskStreamsRef.current.local, undefined);
  assert.deepEqual(activeTaskStreamsRef.current.local, { content: "seed+" });
  assert.equal(runOptions.apiBaseUrl, "/api");
  assert.equal(runOptions.headers.Authorization, "Bearer tok");
  assert.deepEqual(events, ["event-1"]);
});

test("done handler callback can start background polling with resolved id", async () => {
  const started = [];
  let callbacks;
  const action = createStartTaskEventStreamAction({
    apiBaseUrl: "",
    taskStreamsRef: { current: {} },
    activeTaskStreamsRef: { current: {} },
    setMessages: () => {},
    setIsLoading: () => {},
    startBackgroundPolling: (...args) => started.push(args),
    translate: (key) => key,
    getToken: () => null,
    getGuestId: () => "guest-1",
    createAbortController: makeController,
    createTaskStreamEventHandler: (opts) => {
      callbacks = opts.callbacks;
      return { processEvent(){}, getAccumulated(){ return ""; }, getLatestSequence(){ return 0; } };
    },
    runTaskEventStream: async (opts) => {
      assert.equal(opts.headers["X-Guest-ID"], "guest-1");
    },
  });
  action(9, "local", undefined, 0, "", 22);
  await Promise.resolve();
  callbacks.startBackgroundPolling(33);
  assert.deepEqual(started[0], [9, "local", 33]);
});

test("finally syncs realtime data to message, marks realtime completed, removes stream and starts fallback polling", async () => {
  const taskStreamsRef = { current: {} };
  const messages = createState([{ id: "local", content: "old" }]);
  const completed = [];
  const started = [];
  const action = createStartTaskEventStreamAction({
    apiBaseUrl: "",
    taskStreamsRef,
    activeTaskStreamsRef: { current: {} },
    setMessages: messages.set,
    setIsLoading: () => {},
    startBackgroundPolling: (...args) => started.push(args),
    translate: (key) => key,
    getToken: () => null,
    getGuestId: () => "guest",
    createAbortController: makeController,
    createTaskStreamEventHandler: () => ({
      processEvent(){},
      getAccumulated(){ return "final"; },
      getLatestSequence(){ return 44; },
    }),
    realtimeGet: () => ({ content: "rt", completedAt: 123 }),
    realtimeMarkCompleted: (id) => completed.push(id),
    runTaskEventStream: async () => {},
  });
  action(5, "local", 9);
  assert.ok(taskStreamsRef.current.local);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(messages.get()[0].content, "rt");
  assert.equal(messages.get()[0].lastSequence, 44);
  assert.equal(messages.get()[0].completedAt, 123);
  assert.deepEqual(completed, ["local"]);
  assert.equal(taskStreamsRef.current.local, undefined);
  assert.deepEqual(started.at(-1), [5, "local", 9]);
});

test("non-aborted stream error starts catch fallback plus final fallback", async () => {
  const started = [];
  const action = createStartTaskEventStreamAction({
    apiBaseUrl: "",
    taskStreamsRef: { current: {} },
    activeTaskStreamsRef: { current: {} },
    setMessages: () => {},
    setIsLoading: () => {},
    startBackgroundPolling: (...args) => started.push(args),
    translate: (key) => key,
    getToken: () => null,
    getGuestId: () => "guest",
    createAbortController: makeController,
    createTaskStreamEventHandler: () => ({ processEvent(){}, getAccumulated(){ return ""; }, getLatestSequence(){ return 0; } }),
    runTaskEventStream: async () => { throw new Error("boom"); },
  });
  action(5, "local", 9);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(started, [[5, "local", 9], [5, "local", 9]]);
});

(async () => {
  try {
    for (const entry of tests) {
      await entry.fn();
      console.log(`✓ ${entry.name}`);
    }
    console.log(`chat task stream runtime hook regression passed (${tests.length} tests)`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
