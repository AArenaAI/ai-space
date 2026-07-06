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
source = source.replace(/import \{ readAuthState \} from "@\/lib\/auth\/state";\n/g, "const readAuthState = () => ({ token: null });\n");
const runtimeStoreCalls = [];
source = source.replace(/import \{ chatRuntimeStore, chatStreamOwnerRegistry as defaultChatStreamOwnerRegistry \} from "@\/lib\/chatRuntime";\n/g, "const chatRuntimeStore = { patchConversation: (...args) => globalThis.__runtimeStoreCalls.push(args) }; const defaultChatStreamOwnerRegistry = { register(){}, canFinalize(){ return true; }, finalize(){ return true; }, abortConversation(){} };\n");
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
globalThis.__runtimeStoreCalls = runtimeStoreCalls;

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
function resetRuntimeStoreCalls() {
  runtimeStoreCalls.length = 0;
}
function patchesForConversation(conversationId) {
  return runtimeStoreCalls.filter((entry) => entry[0] === conversationId).map((entry) => entry[1]);
}

test("createStopAllTaskStreamsAction aborts controllers, clears refs and aborts stream owners", () => {
  resetRuntimeStoreCalls();
  const c1 = makeController();
  const c2 = makeController();
  const ownerAborts = [];
  const taskStreamsRef = { current: { a: c1, b: c2 } };
  const activeTaskStreamsRef = { current: { a: { convId: 9, content: "x" }, b: { convId: 10, content: "y" } } };
  const stop = createStopAllTaskStreamsAction({
    taskStreamsRef,
    activeTaskStreamsRef,
    streamOwnerRegistry: { abortConversation: (...args) => ownerAborts.push(args) },
  });
  stop();
  assert.equal(c1.signal.aborted, true);
  assert.equal(c2.signal.aborted, true);
  assert.deepEqual(taskStreamsRef.current, {});
  assert.deepEqual(activeTaskStreamsRef.current, {});
  assert.deepEqual(ownerAborts, [[9, "stop"], [10, "stop"]]);
  assert.deepEqual(patchesForConversation(9).at(-1).activeStreams, {});
  assert.deepEqual(patchesForConversation(10).at(-1).activeStreams, {});
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
  resetRuntimeStoreCalls();
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
  assert.equal(activeTaskStreamsRef.current.local, undefined);
  const runtimePatches = patchesForConversation(9);
  assert.equal(runtimePatches[0].activeStreams.local.generationTaskId, 22);
  assert.equal(runtimePatches.some((patch) => Object.keys(patch.activeStreams).length === 0), true);
  assert.equal(runOptions.apiBaseUrl, "/api");
  assert.equal(runOptions.headers.Authorization, "Bearer tok");
  assert.deepEqual(events, ["event-1"]);
});

test("shared task sequence guard dedupes replay across restored message ids", async () => {
  const appliedTaskSequencesRef = { current: {} };
  const taskStreamsRef = { current: {} };
  const activeTaskStreamsRef = { current: {} };
  const callbacks = [];
  const controllers = [];
  const action = createStartTaskEventStreamAction({
    apiBaseUrl: "",
    taskStreamsRef,
    activeTaskStreamsRef,
    appliedTaskSequencesRef,
    setMessages: () => {},
    setIsLoading: () => {},
    startBackgroundPolling: () => {},
    translate: (key) => key,
    getToken: () => "tok",
    createAbortController: () => {
      const controller = makeController();
      controllers.push(controller);
      return controller;
    },
    createTaskStreamEventHandler: (opts) => {
      callbacks.push(opts.callbacks);
      return { processEvent(){}, getAccumulated(){ return ""; }, getLatestSequence(){ return 0; } };
    },
    runTaskEventStream: async () => {},
  });
  action(9, "optimistic-local", 11, 0, "", 22);
  await Promise.resolve();
  await Promise.resolve();
  activeTaskStreamsRef.current["optimistic-local"] = { generationTaskId: 22, serverMessageId: 11 };
  taskStreamsRef.current["optimistic-local"] = controllers[0];
  action(9, "server-11", 11, 0, "", 22);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(controllers[0].signal.aborted, true);
  assert.equal(taskStreamsRef.current["optimistic-local"], undefined);
  assert.equal(callbacks.length, 2);
  assert.equal(callbacks[0].shouldApplySequence(2), true);
  assert.equal(callbacks[1].shouldApplySequence(2), false);
  assert.equal(callbacks[1].shouldApplySequence(3), true);
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

test("finally preserves local content for server-backed task streams and waits for fallback polling", async () => {
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
  assert.equal(messages.get()[0].content, "old");
  assert.equal(messages.get()[0].lastSequence, 44);
  assert.equal(messages.get()[0].serverMessageId, 9);
  assert.equal(messages.get()[0].completedAt, undefined);
  assert.deepEqual(completed, []);
  assert.equal(taskStreamsRef.current.local, undefined);
  assert.deepEqual(started.at(-1), [5, "local", 9]);
});

test("stale task stream owner skips finally patching and fallback", async () => {
  const calls = [];
  const messages = createState([{ id: "local", content: "old" }]);
  const ownerRegistry = {
    register: (owner) => calls.push(["register", owner]),
    canFinalize: (owner) => { calls.push(["canFinalize", owner]); return false; },
    finalize: (owner) => calls.push(["finalize", owner]),
    abortConversation: () => {},
  };
  const action = createStartTaskEventStreamAction({
    apiBaseUrl: "",
    taskStreamsRef: { current: {} },
    activeTaskStreamsRef: { current: {} },
    setMessages: messages.set,
    setIsLoading: () => {},
    startBackgroundPolling: (...args) => calls.push(["poll", ...args]),
    translate: (key) => key,
    getToken: () => null,
    createAbortController: makeController,
    streamOwnerRegistry: ownerRegistry,
    createTaskStreamEventHandler: () => ({ processEvent(){}, getAccumulated(){ return "final"; }, getLatestSequence(){ return 99; } }),
    realtimeGet: () => ({ content: "rt" }),
    runTaskEventStream: async () => {},
  });
  action(5, "local", 9, 0, "", 22);
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(calls.some((call) => call[0] === "register" && call[1].conversationId === 5 && call[1].taskId === 22));
  assert.ok(calls.some((call) => call[0] === "canFinalize"));
  assert.deepEqual(messages.get(), [{ id: "local", content: "old" }]);
  assert.ok(!calls.some((call) => call[0] === "poll"));
  assert.ok(!calls.some((call) => call[0] === "finalize"));
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
