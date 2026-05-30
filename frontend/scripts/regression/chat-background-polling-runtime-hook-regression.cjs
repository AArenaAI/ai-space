#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "../..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-background-polling-runtime-hook-"));
const outFile = path.join(tempDir, "useChatBackgroundPollingRuntime.cjs");
const sourceFile = path.join(repoRoot, "hooks/useChatBackgroundPollingRuntime.ts");
const pollingFile = path.join(repoRoot, "lib/chatBackgroundPolling.ts");
const registrationFile = path.join(repoRoot, "lib/chatBackgroundTaskRegistration.ts");
const messagePatchFile = path.join(repoRoot, "lib/chatMessageStatePatch.ts");
let source = fs.readFileSync(sourceFile, "utf8");
source = source.replace(/import type[^;]+react[^;]+;\n/g, "");
source = source.replace(/import type[^;]+chatTypes[^;]+;\n/g, "");
source = source.replace(/import \{ useCallback, useRef \} from "react";\n/g, "const useCallback = (fn) => fn; const useRef = (current) => ({ current });\n");
source = source.replace(/import \{ getGuestId as defaultGetGuestId \} from "@\/lib\/guestId";\n/g, "const defaultGetGuestId = () => 'guest';\n");
source = source.replace(/import \{ emitTaskFinished as defaultEmitTaskFinished \} from "@\/lib\/taskNotifications";\n/g, "const defaultEmitTaskFinished = () => {};\n");
source = source.replace(/import \{ streamGet as defaultStreamGet, realtimeGet as defaultRealtimeGet \} from "@\/lib\/streaming";\n/g, "const defaultStreamGet = () => undefined; const defaultRealtimeGet = () => undefined;\n");
source = source.replace(
  /import \{ getNotificationConversationTitle \} from "@\/lib\/chatBackgroundTaskRegistration";\n/g,
  fs.readFileSync(registrationFile, "utf8").replace(/export /g, "") + "\n"
);
source = source.replace(
  /import \{\n  buildBackgroundPollingMessagePatch,\n  shouldKeepBackgroundLoading,\n\} from "@\/lib\/chatBackgroundPolling";\n/g,
  fs.readFileSync(pollingFile, "utf8").replace(/export /g, "") + "\n"
);
source = source.replace(/import \{\n  startBackgroundPollingRunner,\n\} from "@\/lib\/chatBackgroundPollingRunner";\n/g, "const startBackgroundPollingRunner = () => ({ timer: 1 });\n");
source = source.replace(
  /import \{ patchMessageById \} from "@\/lib\/chatMessageStatePatch";\n/g,
  fs.readFileSync(messagePatchFile, "utf8").replace(/export /g, "") + "\n"
);
source = source.replace(/import \{ createBusyGeneratingStatus \} from "@\/lib\/chatActivityStatus";\n/g, "const createBusyGeneratingStatus = (t) => ({ kind: 'generating', label: t('chat.status.generating') });\n");
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
  createStopBackgroundPollerAction,
  createStartBackgroundPollingAction,
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

test("createStopBackgroundPollerAction clears timer and removes ref", () => {
  const cleared = [];
  const ref = { current: { local: 42 } };
  const stop = createStopBackgroundPollerAction({ backgroundPollersRef: ref, clearIntervalImpl: (timer) => cleared.push(timer) });
  stop("local");
  assert.deepEqual(cleared, [42]);
  assert.deepEqual(ref.current, {});
});

test("createStartBackgroundPollingAction guards missing ids and duplicate pollers", () => {
  const calls = [];
  const action = createStartBackgroundPollingAction({
    apiBaseUrl: "",
    backgroundPollersRef: { current: { dup: 9 } },
    taskStreamsRef: { current: {} },
    setMessages: () => {},
    setIsLoading: () => {},
    getConversationTitle: () => "title",
    getSelectedModel: () => ({ id: "model", name: "Model" }),
    stopBackgroundPoller: () => {},
    stopTaskStream: () => {},
    runner: (...args) => {
      calls.push(args);
      return { timer: 1 };
    },
  });
  action(undefined, "a", 1);
  action(1, "a", undefined);
  action(1, "dup", 1);
  assert.equal(calls.length, 0);
});

test("createStartBackgroundPollingAction starts runner with auth header and stores timer", () => {
  const ref = { current: {} };
  const runnerCalls = [];
  const action = createStartBackgroundPollingAction({
    apiBaseUrl: "/api",
    backgroundPollersRef: ref,
    taskStreamsRef: { current: {} },
    setMessages: () => {},
    setIsLoading: () => {},
    getConversationTitle: () => "title",
    getSelectedModel: () => ({ id: "model", name: "Model" }),
    stopBackgroundPoller: () => {},
    stopTaskStream: () => {},
    getToken: () => "tok",
    runner: (opts) => {
      runnerCalls.push(opts);
      return { timer: 77 };
    },
  });
  action(5, "local", 9);
  assert.equal(ref.current.local, 77);
  assert.equal(runnerCalls[0].apiBaseUrl, "/api");
  assert.equal(runnerCalls[0].headers.Authorization, "Bearer tok");
});

test("poll state patches message without overriding live stream content", () => {
  const messages = createState([{ id: "local", content: "old", serverMessageId: 9 }]);
  let callbacks;
  const action = createStartBackgroundPollingAction({
    apiBaseUrl: "",
    backgroundPollersRef: { current: {} },
    taskStreamsRef: { current: { local: {} } },
    setMessages: messages.set,
    setIsLoading: () => {},
    getConversationTitle: () => "title",
    getSelectedModel: () => ({ id: "model", name: "Model" }),
    stopBackgroundPoller: () => {},
    stopTaskStream: () => {},
    getToken: () => null,
    getGuestId: () => "guest-1",
    streamGet: () => "live",
    runner: (opts) => {
      callbacks = opts.callbacks;
      assert.equal(opts.headers["X-Guest-ID"], "guest-1");
      return { timer: 7 };
    },
    now: () => 123,
    translate: (key) => `t:${key}`,
  });
  action(5, "local", 9);
  callbacks.onPollState({ content: "db-full", isFinished: true, isCompleted: true, status: "completed" });
  assert.equal(messages.get()[0].content, "live");
  assert.equal(messages.get()[0].serverMessageId, 9);
  assert.equal(messages.get()[0].completedAt, 123);
});

test("finished callback stops poller/stream, emits notification, and updates loading", () => {
  const backgroundPollersRef = { current: { local: 7, otherPoller: 8 } };
  const taskStreamsRef = { current: { local: {}, otherStream: {} } };
  const stopped = [];
  const emitted = [];
  const loading = createState(true);
  let callbacks;
  const action = createStartBackgroundPollingAction({
    apiBaseUrl: "",
    backgroundPollersRef: { current: {} },
    taskStreamsRef,
    setMessages: () => {},
    setIsLoading: loading.set,
    getConversationTitle: () => " My Chat ",
    getSelectedModel: () => ({ id: "model", name: "Model" }),
    getToken: () => null,
    getGuestId: () => "guest",
    stopBackgroundPoller: (id) => {
      stopped.push(`poll:${id}`);
      delete backgroundPollersRef.current[id];
    },
    stopTaskStream: (id) => {
      stopped.push(`stream:${id}`);
      delete taskStreamsRef.current[id];
    },
    emitTaskFinished: (payload) => emitted.push(payload),
    runner: (opts) => {
      callbacks = opts.callbacks;
      return { timer: 7 };
    },
  });
  action(5, "local", 9);
  callbacks.onFinished({ content: "done", isFinished: true, isCompleted: true, status: "completed" });
  assert.deepEqual(stopped, ["poll:local", "stream:local"]);
  assert.equal(emitted[0].key, "chat:9");
  assert.equal(emitted[0].href, "/chat?id=5");
  assert.equal(emitted[0].conversationTitle, "My Chat");
  assert.equal(loading.get(), true);
});

test("keep loading callback sets loading true", () => {
  const loading = createState(false);
  let callbacks;
  const action = createStartBackgroundPollingAction({
    apiBaseUrl: "",
    backgroundPollersRef: { current: {} },
    taskStreamsRef: { current: {} },
    setMessages: () => {},
    setIsLoading: loading.set,
    getConversationTitle: () => "title",
    getSelectedModel: () => ({ id: "model", name: "Model" }),
    getToken: () => null,
    getGuestId: () => "guest",
    stopBackgroundPoller: () => {},
    stopTaskStream: () => {},
    runner: (opts) => {
      callbacks = opts.callbacks;
      return { timer: 7 };
    },
  });
  action(5, "local", 9);
  callbacks.onKeepLoading();
  assert.equal(loading.get(), true);
});

(async () => {
  try {
    for (const entry of tests) {
      await entry.fn();
      console.log(`✓ ${entry.name}`);
    }
    console.log(`chat background polling runtime hook regression passed (${tests.length} tests)`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
