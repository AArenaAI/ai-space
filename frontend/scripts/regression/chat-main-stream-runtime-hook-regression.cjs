#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "../..");
const sourceFile = path.join(repoRoot, "hooks/useChatMainStreamRuntime.ts");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chat-main-stream-runtime-"));
const tmpFile = path.join(tmpRoot, "useChatMainStreamRuntime.cjs");
const source = fs.readFileSync(sourceFile, "utf8");

const transformed = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;

const moduleCache = new Map();
function loadModule(file) {
  if (moduleCache.has(file)) return moduleCache.get(file).exports;
  const code = fs.readFileSync(file, "utf8");
  const module = { exports: {} };
  moduleCache.set(file, module);
  const localRequire = (specifier) => {
    if (specifier === "react") return { useCallback: (fn) => fn };
    if (specifier === "@/lib/taskNotifications") return { registerBackgroundTask: () => {} };
    if (specifier === "@/lib/streaming") {
      return {
        realtimeAppend: () => {},
        realtimeUpdate: () => {},
        realtimeGet: () => undefined,
        realtimeMarkCompleted: () => {},
      };
    }
    if (specifier === "@/lib/chatMainStreamEventHandler") return { createMainStreamEventHandler: () => { throw new Error("default handler should be injected"); } };
    if (specifier === "@/lib/chatStreamLifecycle") return { runChatStreamLifecycle: () => { throw new Error("default lifecycle should be injected"); } };
    if (specifier === "@/lib/chatFinalReconciliationCoordinator") {
      return {
        buildFinalStreamRunResult: ({ state, finalContent }) => ({
          content: finalContent,
          serverMessageId: state.serverMessageId,
          generationTaskId: state.generationTaskId,
          lastSequence: state.lastSequence,
          recoverable: state.recoverable,
          sawDone: state.sawDone,
        }),
        decideFinalStreamReconciliation: ({ state, abortReason, streamContent, hasRealtimeData }) => {
          if (state.finalAction) return state.finalAction;
          return {
            type: "complete",
            shouldSyncFinalData: hasRealtimeData || Boolean(streamContent),
            finalContent: streamContent || state.accumulated || "",
            shouldClearStores: true,
            shouldMarkCompleted: !abortReason && Boolean(streamContent || state.accumulated),
          };
        },
      };
    }
    if (specifier === "@/lib/chatCompletionFinalizer") return { buildCompletedPatch: (now) => ({ completedAt: now, status: "completed" }) };
    if (specifier === "@/lib/chatMessageStatePatch") {
      return {
        patchMessageById: (messages, id, patch) => messages.map((message) => {
          if (message.id !== id) return message;
          return typeof patch === "function" ? patch(message) : { ...message, ...patch };
        }),
        applyFinalRealtimeDataToMessage: (message, { finalContent, finalData }) => ({ ...message, content: finalContent, finalData }),
      };
    }
    if (specifier.startsWith("@/lib/")) return {};
    return require(specifier);
  };
  new Function("require", "module", "exports", code)(localRequire, module, module.exports);
  return module.exports;
}

fs.writeFileSync(tmpFile, transformed);
const { createStreamResponseAction } = loadModule(tmpFile);

function makeResponse() {
  return { body: {} };
}
function makeController(aborted = false) {
  return { signal: { aborted } };
}
function makeAssistant(overrides = {}) {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "",
    model: "Assistant Model",
    ...overrides,
  };
}
function makeHandler(stateOverrides = {}) {
  const calls = [];
  const state = {
    accumulated: "",
    serverMessageId: 11,
    generationTaskId: 22,
    lastSequence: 3,
    recoverable: false,
    sawDone: false,
    ...stateOverrides,
  };
  return {
    calls,
    handler: {
      processEvent: (event) => calls.push(["event", event]),
      getState: () => state,
      setRecoverable: (value) => { state.recoverable = value; calls.push(["recoverable", value]); },
      closeOpenReasoning: () => calls.push(["close"]),
    },
    state,
  };
}
async function runAction({ handlerState = {}, lifecycleResult = { action: "completed" }, streamContent = "streamed", realtimeData, currentConversation = 99, convId, abortReason = null, now = () => 1234 } = {}) {
  const handlerFixture = makeHandler(handlerState);
  const calls = [];
  const resolvedRealtimeData = realtimeData === undefined ? { content: streamContent } : realtimeData;
  let messages = [makeAssistant()];
  const action = createStreamResponseAction({
    selectedModelName: "Selected Model",
    conversationTitle: "Title",
    getCurrentConversation: () => currentConversation,
    abortReasonRef: { current: abortReason },
    setMessages: (updater) => {
      messages = typeof updater === "function" ? updater(messages) : updater;
      calls.push(["setMessages", messages]);
    },
    startTaskEventStream: (...args) => calls.push(["task", ...args]),
    startBackgroundPolling: (...args) => calls.push(["poll", ...args]),
    translate: (key) => key,
    createMainStreamEventHandler: (opts) => {
      calls.push(["handler", opts.assistantMessageId, opts.selectedModelName, opts.conversationTitle, opts.initialGroupMeta]);
      return handlerFixture.handler;
    },
    runChatStreamLifecycle: async (opts) => {
      calls.push(["lifecycle", opts.getAbortReason(), opts.getRecoveryIds()]);
      opts.onEvent("event-1");
      return lifecycleResult;
    },
    realtimeGet: () => resolvedRealtimeData,
    realtimeMarkCompleted: (id, completedAt) => calls.push(["realtimeMarkCompleted", id, completedAt]),
    now,
  });
  const result = await action(makeResponse(), makeAssistant({ groupId: "g", groupIndex: 1, groupModels: ["a", "b"], userMessageId: "u" }), makeController(), convId);
  return { result, calls, messages, handlerCalls: handlerFixture.calls, state: handlerFixture.state };
}

async function testCompletedSyncClearAndMark() {
  const { result, calls, messages, handlerCalls } = await runAction({ handlerState: { accumulated: "acc" }, streamContent: "streamed", realtimeData: { content: "streamed", serverMessageId: 11 } });
  assert.equal(result.content, "streamed");
  assert.ok(calls.some((call) => call[0] === "setMessages"));
  assert.deepEqual(messages[0].finalData, { content: "streamed", serverMessageId: 11 });
  assert.equal(messages[0].completedAt, 1234);
  assert.ok(calls.some((call) => call[0] === "realtimeMarkCompleted" && call[1] === "assistant-1" && call[2] === 1234));
  assert.deepEqual(handlerCalls[0], ["event", "event-1"]);
  assert.ok(handlerCalls.some((call) => call[0] === "close"));
}

async function testLifecycleResumeStartsTaskAndReturnsUndefined() {
  const { result, calls, state } = await runAction({ lifecycleResult: { action: "resume" }, currentConversation: 77 });
  assert.equal(result, undefined);
  assert.equal(state.recoverable, true);
  assert.ok(calls.some((call) => call[0] === "task" && call[1] === 77 && call[2] === "assistant-1" && call[3] === 11 && call[4] === 3 && call[6] === 22));
}

async function testRecoverFinalActionStartsTaskAndPollingWithExplicitConversation() {
  const finalAction = {
    type: "recover",
    shouldSyncFinalData: false,
    finalContent: "partial",
    shouldClearStores: false,
    shouldMarkCompleted: false,
    serverMessageId: 111,
    generationTaskId: 222,
    lastSequence: 7,
    shouldStartBackgroundPolling: true,
    result: { recoverable: true, serverMessageId: 111 },
  };
  const { result, calls, state } = await runAction({ handlerState: { finalAction }, convId: 55 });
  assert.deepEqual(result, finalAction.result);
  assert.equal(state.recoverable, true);
  assert.ok(calls.some((call) => call[0] === "task" && call[1] === 55 && call[3] === 111 && call[4] === 7 && call[5] === "partial" && call[6] === 222));
  assert.ok(calls.some((call) => call[0] === "poll" && call[1] === 55 && call[2] === "assistant-1" && call[3] === 111));
}

async function testReconcileAfterDoneStartsOnlyPolling() {
  const finalAction = {
    type: "reconcile_after_done",
    shouldSyncFinalData: false,
    finalContent: "done",
    shouldClearStores: false,
    shouldMarkCompleted: false,
    serverMessageId: 333,
    generationTaskId: 444,
    shouldStartBackgroundPolling: true,
    result: { sawDone: true, serverMessageId: 333 },
  };
  const { result, calls, state } = await runAction({ handlerState: { finalAction }, currentConversation: 88 });
  assert.deepEqual(result, finalAction.result);
  assert.equal(state.recoverable, true);
  assert.ok(!calls.some((call) => call[0] === "task"));
  assert.ok(calls.some((call) => call[0] === "poll" && call[1] === 88 && call[3] === 333));
}

async function testNavigationAbortStartsTaskStreamContinuation() {
  const finalAction = {
    type: "recover",
    shouldSyncFinalData: true,
    finalContent: "front half",
    shouldClearStores: false,
    shouldMarkCompleted: false,
    serverMessageId: 111,
    generationTaskId: 222,
    lastSequence: 7,
    shouldStartBackgroundPolling: false,
    result: { recoverable: true, serverMessageId: 111, content: "front half" },
  };
  const { result, calls, state, messages } = await runAction({
    handlerState: { finalAction, accumulated: "front half" },
    convId: 55,
    abortReason: "navigation",
    streamContent: "front half",
    realtimeData: { content: "front half", serverMessageId: 111, generationTaskId: 222 },
  });
  assert.deepEqual(result, finalAction.result);
  assert.equal(state.recoverable, true);
  assert.equal(messages[0].content, "front half");
  assert.ok(calls.some((call) => call[0] === "task" && call[1] === 55 && call[2] === "assistant-1" && call[3] === 111 && call[4] === 7 && call[5] === "front half" && call[6] === 222));
}

async function testIgnoredLifecycleStillRunsFinallyButNoCompletionWhenAborted() {
  const { result, calls, messages } = await runAction({ lifecycleResult: { action: "ignored" }, streamContent: "", abortReason: "user" });
  assert.equal(result, undefined);
  assert.ok(calls.some((call) => call[0] === "realtimeMarkCompleted"));
  assert.equal(messages[0].completedAt, undefined);
}

(async () => {
  await testCompletedSyncClearAndMark();
  await testLifecycleResumeStartsTaskAndReturnsUndefined();
  await testRecoverFinalActionStartsTaskAndPollingWithExplicitConversation();
  await testReconcileAfterDoneStartsOnlyPolling();
  await testNavigationAbortStartsTaskStreamContinuation();
  await testIgnoredLifecycleStillRunsFinallyButNoCompletionWhenAborted();
  console.log("chat main stream runtime hook regression passed");
})();
