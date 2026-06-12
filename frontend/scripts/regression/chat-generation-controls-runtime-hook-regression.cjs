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
        buildCompareChatRequestBody: (body) => body,
      };
    }
    if (specifier === "@/lib/chatActivityStatus") {
      return { createGeneratingStatus: (t) => ({ kind: "generating", status: "running", label: t("chat.status.generating") }) };
    }
    if (specifier === "@/lib/chatInitialRealtime") {
      return { initializeAssistantRealtimeBatch: () => undefined };
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
    if (specifier === "@/lib/chatModelMessageTransform") return { toModelMessages: (messages) => messages };
    if (specifier === "@/lib/chatHistoryTransform") return { toModelMessages: (messages) => messages };
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

function makeSetters(initialMessages = []) {
  const calls = [];
  let messages = initialMessages;
  return {
    calls,
    get messages() { return messages; },
    setIsCompare: (value) => calls.push(["isCompare", value]),
    setCompareModels: (value) => calls.push(["compareModels", value]),
    setMessages: (value) => {
      messages = typeof value === "function" ? value(messages) : value;
      calls.push(["messages", messages]);
    },
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

async function testForkChatAddsGeneratingPlaceholderForForkedModel() {
  const initialMessages = [
    { id: "u1", role: "user", content: "hi", createdAt: 1000, serverMessageId: 10 },
    { id: "a1", role: "assistant", content: "old", createdAt: 1001, serverMessageId: 11, model: "m1" },
  ];
  const setters = makeSetters(initialMessages);
  let requestStarted = false;
  let releaseRequest;
  const requestGate = new Promise((resolve) => { releaseRequest = resolve; });
  const fork = createForkChatAction({
    apiBaseUrl: "",
    messages: initialMessages,
    currentConversation: 5,
    ...setters,
    getToken: () => "tok",
    getGuestId: () => "guest",
    fallbackId: () => "placeholder-id",
    now: () => 2000,
    translate: (key) => ({ "chat.status.generating": "生成中", "chat.status.failed": "生成失败" }[key] || key),
    runForkChatRequest: async () => {
      requestStarted = true;
      await requestGate;
      return { conversation_id: 5, models: ["m1", "m2"] };
    },
    fetchForkConversationRefresh: async () => ({ messages: [{ id: "fresh", role: "assistant", content: "new", serverMessageId: 22 }] }),
  });

  const promise = fork(11, ["m1", "m2"]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requestStarted, true);
  const optimistic = setters.calls.find((call) => call[0] === "messages")[1];
  assert.equal(optimistic.length, 3);
  assert.equal(optimistic[1].groupId, -11);
  assert.equal(optimistic[1].groupIndex, 0);
  assert.equal(optimistic[2].model, "m2");
  assert.equal(optimistic[2].activityStatus.label, "生成中");
  assert.equal(optimistic[2].groupId, -11);
  assert.equal(optimistic[2].groupIndex, 1);
  releaseRequest();
  await promise;
}

async function testForkChatMarksPlaceholderFailedOnRequestError() {
  const initialMessages = [
    { id: "u1", role: "user", content: "hi", createdAt: 1000, serverMessageId: 10 },
    { id: "a1", role: "assistant", content: "old", createdAt: 1001, serverMessageId: 11, model: "m1" },
  ];
  const setters = makeSetters(initialMessages);
  const fork = createForkChatAction({
    apiBaseUrl: "",
    messages: initialMessages,
    currentConversation: 5,
    ...setters,
    getToken: () => "tok",
    getGuestId: () => "guest",
    fallbackId: () => "placeholder-id",
    now: () => 2000,
    translate: (key) => ({ "chat.status.generating": "生成中", "chat.status.failed": "生成失败" }[key] || key),
    runForkChatRequest: async () => { throw new Error("boom"); },
  });

  await assert.rejects(() => fork(11, ["m1", "m2"]), /boom/);
  const latestMessages = setters.calls.filter((call) => call[0] === "messages").at(-1)[1];
  assert.equal(latestMessages[2].activityStatus.status, "failed");
  assert.equal(latestMessages[2].activityStatus.label, "生成失败");
}

async function testStreamingForkPassesSourceUserAttachments() {
  const initialMessages = [
    { id: "u1", role: "user", content: "分析一下", createdAt: 1000, serverMessageId: 10, files: [{ public_id: "file-public-1" }] },
    { id: "a1", role: "assistant", content: "old", createdAt: 1001, serverMessageId: 11, model: "m1" },
  ];
  const setters = makeSetters(initialMessages);
  const requests = [];
  const fork = createForkChatAction({
    apiBaseUrl: "",
    messages: initialMessages,
    currentConversation: 5,
    ...setters,
    getToken: () => "tok",
    getGuestId: () => "guest",
    fallbackId: () => "placeholder-id",
    now: () => 2000,
    translate: (key) => ({ "chat.status.generating": "生成中", "chat.status.failed": "生成失败" }[key] || key),
    streamResponse: async () => ({}),
    runForkChatRequest: async () => ({ conversation_id: 5, group_id: 77, user_message_id: 10, models: ["m1", "m2"] }),
  });
  const originalFetch = global.fetch;
  global.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return { ok: true };
  };
  try {
    await fork(11, ["m1", "m2"]);
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].message_file_ids || requests[0].messageFileIds, ["file-public-1"]);
  assert.equal(requests[0].messages.length, 1);
  const optimistic = setters.calls.find((call) => call[0] === "messages")[1];
  assert.notEqual(optimistic[2].createdAt, initialMessages[1].createdAt);
  assert.equal(optimistic[2].generationStartedAt, 2000);
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
  await testForkChatAddsGeneratingPlaceholderForForkedModel();
  await testForkChatMarksPlaceholderFailedOnRequestError();
  await testStreamingForkPassesSourceUserAttachments();
  await testForkChatSkipsRefreshWithoutTokenAndUsesFallbackConversation();
  await testForkChatLogsRefreshErrors();
  console.log("chat generation controls runtime hook regression passed");
})();
