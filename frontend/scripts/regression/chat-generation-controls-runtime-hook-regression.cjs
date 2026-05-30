#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "../..");
const sourceFile = path.join(repoRoot, "hooks/useChatGenerationControlsRuntime.ts");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chat-generation-controls-runtime-"));
const tmpFile = path.join(tmpRoot, "useChatGenerationControlsRuntime.cjs");
const source = fs.readFileSync(sourceFile, "utf8");
const transformed = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;

const moduleCache = new Map();
function loadModule(file) {
  if (moduleCache.has(file)) return moduleCache.get(file).exports;
  const code = fs.readFileSync(file, "utf8");
  const module = { exports: {} };
  moduleCache.set(file, module);
  const localRequire = (specifier) => {
    if (specifier === "react") return { useCallback: (fn) => fn };
    if (specifier === "uuid") return { v4: () => "uuid" };
    if (specifier === "@/lib/guestId") return { getGuestId: () => "guest-default" };
    if (specifier === "@/lib/chatRequestBuilder") {
      return {
        buildChatRequestHeaders: ({ token, guestId }) => {
          const headers = { "Content-Type": "application/json" };
          if (token) headers.Authorization = `Bearer ${token}`;
          else headers["X-Guest-ID"] = guestId;
          return headers;
        },
      };
    }
    if (specifier === "@/lib/chatStopGenerationCoordinator") {
      return {
        runStopGeneration: () => undefined,
        cancelGenerationTask: () => undefined,
      };
    }
    if (specifier === "@/lib/chatForkCoordinator") {
      return {
        runForkChatRequest: () => ({}),
        fetchForkConversationRefresh: () => undefined,
        resolveForkedModels: (data, fallback) => data.models || fallback,
        resolveForkConversationId: (data, fallback) => data.conversation_id || fallback,
        buildForkRefreshState: (data, { fallbackId }) => {
          if (!data) return undefined;
          const messages = (data.messages || []).map((m) => ({ id: m.id || fallbackId(), role: m.role, content: m.content, serverMessageId: m.serverMessageId }));
          const groupViews = new Map([[1, 0]]);
          return { messages, groupViews };
        },
      };
    }
    if (specifier.startsWith("@/")) return {};
    return require(specifier);
  };
  new Function("require", "module", "exports", code)(localRequire, module, module.exports);
  return module.exports;
}
fs.writeFileSync(tmpFile, transformed);
const { createStopGenerationAction, createForkChatAction } = loadModule(tmpFile);

function makeController(name, calls) {
  return { name, aborted: false, abort() { this.aborted = true; calls.push(["abort", name]); } };
}

function makeSetters() {
  const calls = [];
  return {
    calls,
    setIsCompare: (value) => calls.push(["isCompare", value]),
    setCompareModels: (value) => calls.push(["compareModels", value]),
    setMessages: (value) => calls.push(["messages", typeof value === "function" ? value([]) : value]),
    setLoadedPersistedMessages: (value) => calls.push(["loaded", value]),
    setGroupViews: (value) => calls.push(["groups", value]),
  };
}

function testStopGenerationUsesBearerAndClearsRefs() {
  const calls = [];
  const taskController = makeController("task", calls);
  const mainController = makeController("main", calls);
  const compareController = makeController("compare", calls);
  const refs = {
    taskStreamsRef: { current: { a: taskController } },
    abortControllerRef: { current: mainController },
    compareAbortControllersRef: { current: [compareController] },
    abortReasonRef: { current: null },
  };
  let captured;
  const stop = createStopGenerationAction({
    apiBaseUrl: "",
    messages: [{ role: "assistant", generationTaskId: 3 }],
    ...refs,
    getToken: () => "tok",
    getGuestId: () => "guest",
    cancelGenerationTask: (args) => calls.push(["cancel", args]),
    runStopGeneration: ({ messages, callbacks }) => {
      captured = messages;
      callbacks.cancelTask(3);
      callbacks.abortTaskStreams();
      callbacks.setAbortReason("user");
      callbacks.getMainAbortController().abort();
      callbacks.clearMainAbortController();
      callbacks.getCompareAbortControllers()[0].abort();
      callbacks.clearCompareAbortControllers();
    },
  });
  stop();
  assert.equal(captured.length, 1);
  assert.equal(calls.find((c) => c[0] === "cancel")[1].headers.Authorization, "Bearer tok");
  assert.deepEqual(refs.taskStreamsRef.current, {});
  assert.equal(refs.abortControllerRef.current, null);
  assert.deepEqual(refs.compareAbortControllersRef.current, []);
  assert.equal(refs.abortReasonRef.current, "user");
  assert.ok(taskController.aborted);
  assert.ok(mainController.aborted);
  assert.ok(compareController.aborted);
}

function testStopGenerationUsesGuestFallback() {
  const calls = [];
  const stop = createStopGenerationAction({
    apiBaseUrl: "/api",
    messages: [],
    taskStreamsRef: { current: {} },
    abortControllerRef: { current: null },
    compareAbortControllersRef: { current: [] },
    abortReasonRef: { current: null },
    getToken: () => null,
    getGuestId: () => "guest-1",
    cancelGenerationTask: (args) => calls.push(args),
    runStopGeneration: ({ callbacks }) => callbacks.cancelTask(8),
  });
  stop();
  assert.equal(calls[0].headers["X-Guest-ID"], "guest-1");
  assert.equal(calls[0].apiBaseUrl, "/api");
}

async function testForkChatRequestsAndRefreshes() {
  const setters = makeSetters();
  const calls = [];
  const fork = createForkChatAction({
    apiBaseUrl: "",
    currentConversation: 5,
    ...setters,
    getToken: () => "tok",
    getGuestId: () => "guest",
    fallbackId: () => "fallback-id",
    runForkChatRequest: async (args) => {
      calls.push(["request", args]);
      return { conversation_id: 9, models: ["m2", "m3"] };
    },
    fetchForkConversationRefresh: async (args) => {
      calls.push(["refresh", args]);
      return { messages: [{ role: "assistant", content: "new", serverMessageId: 12 }] };
    },
  });
  const data = await fork(11, ["m1", "m2"]);
  assert.equal(data.conversation_id, 9);
  assert.equal(calls[0][1].headers.Authorization, "Bearer tok");
  assert.deepEqual(setters.calls.find((c) => c[0] === "compareModels")[1], ["m2", "m3"]);
  assert.deepEqual(calls[1][1], { apiBaseUrl: "", conversationId: 9, token: "tok" });
  assert.equal(setters.calls.find((c) => c[0] === "messages")[1][0].id, "fallback-id");
  assert.equal(setters.calls.find((c) => c[0] === "loaded")[1], 1);
  assert.ok(setters.calls.find((c) => c[0] === "groups")[1] instanceof Map);
}

async function testForkChatSkipsRefreshWithoutTokenAndUsesFallbackConversation() {
  const setters = makeSetters();
  let refreshed = false;
  const fork = createForkChatAction({
    apiBaseUrl: "",
    currentConversation: 7,
    ...setters,
    getToken: () => null,
    getGuestId: () => "guest",
    runForkChatRequest: async () => ({ models: undefined }),
    fetchForkConversationRefresh: async () => { refreshed = true; },
  });
  await fork(1, ["a", "b"]);
  assert.deepEqual(setters.calls.find((c) => c[0] === "compareModels")[1], ["a", "b"]);
  assert.equal(refreshed, false);
}

async function testForkChatLogsRefreshErrors() {
  const setters = makeSetters();
  const logs = [];
  const fork = createForkChatAction({
    apiBaseUrl: "",
    currentConversation: undefined,
    ...setters,
    getToken: () => "tok",
    getGuestId: () => "guest",
    runForkChatRequest: async () => ({ conversation_id: 2 }),
    fetchForkConversationRefresh: async () => { throw new Error("boom"); },
    logError: (...args) => logs.push(args),
  });
  await fork(1, ["a", "b"]);
  assert.equal(logs[0][0], "fork refresh failed:");
}

(async () => {
  testStopGenerationUsesBearerAndClearsRefs();
  testStopGenerationUsesGuestFallback();
  await testForkChatRequestsAndRefreshes();
  await testForkChatSkipsRefreshWithoutTokenAndUsesFallbackConversation();
  await testForkChatLogsRefreshErrors();
  console.log("chat generation controls runtime hook regression passed");
})();
