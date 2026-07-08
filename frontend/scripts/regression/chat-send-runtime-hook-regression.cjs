#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "../..");
const sourceFile = path.join(repoRoot, "hooks/useChatSendRuntime.ts");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chat-send-runtime-"));
const compiledFiles = new Map();
function compileHook(filename) {
  const sourcePath = path.join(repoRoot, "hooks", filename);
  const source = fs.readFileSync(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const tmpPath = path.join(tmpRoot, filename.replace(/\.ts$/, ".cjs"));
  fs.writeFileSync(tmpPath, output);
  compiledFiles.set(`@/hooks/${filename.replace(/\.ts$/, "")}`, tmpPath);
  return tmpPath;
}
compileHook("useChatConversationCreateRuntime.ts");
compileHook("useChatSingleSendRuntime.ts");
compileHook("useChatCompareSendRuntime.ts");
const tmpFile = compileHook("useChatSendRuntime.ts");

let singleRequestImpl = async () => {};
let singleInitImpl = async () => ({
  conversation_id: 42,
  user_message_id: 501,
  assistant_message_id: 502,
  task_id: 900,
  mappedAssistantMessage: { id: "502", role: "assistant", content: "", model: "m1", createdAt: 1000, serverMessageId: 502, generationTaskId: 900, serverGenerationStatus: "running" },
});
let compareRunImpl = async () => {};
let compareInitImpl = async () => ({
  conversation_id: 10,
  user_message: { id: 501, conversation_id: 10, role: "user", content: "compare" },
  group: { id: 601, conversation_id: 10, user_message_id: 501, group_models: ["m1", "m2"] },
  compare_models: ["m1", "m2"],
});
let createConversationRequestImpl = async () => ({ id: 42, title: "created" });
let realtimeGetImpl = () => undefined;
let uuidCounter = 0;
const events = [];
const chatRuntimeStoreCalls = [];
const chatRuntimeStoreState = new Map();
const chatRuntimeStoreMock = {
  getConversation: (conversationId) => chatRuntimeStoreState.get(conversationId) || { messages: [], pendingOptimisticMessages: [], activeStreams: {}, generationTasks: {}, compareModels: [] },
  patchConversation: (conversationId, patch) => {
    const existing = chatRuntimeStoreMock.getConversation(conversationId);
    chatRuntimeStoreState.set(conversationId, { ...existing, ...patch });
    chatRuntimeStoreCalls.push(["patchConversation", conversationId, patch]);
  },
  deleteConversation: (...args) => chatRuntimeStoreCalls.push(["deleteConversation", ...args]),
  setActiveConversation: (...args) => chatRuntimeStoreCalls.push(["setActiveConversation", ...args]),
};
global.fetch = async () => ({ ok: true, body: null });

const moduleCache = new Map();
function loadModule(file) {
  if (moduleCache.has(file)) return moduleCache.get(file).exports;
  const code = fs.readFileSync(file, "utf8");
  const module = { exports: {} };
  moduleCache.set(file, module);
  const localRequire = (specifier) => {
    if (specifier === "react") return { useCallback: (fn) => fn, useRef: (initialValue) => ({ current: initialValue }) };
    if (specifier === "uuid") return { v4: () => `uuid-${++uuidCounter}` };
    if (specifier === "@/lib/guestId") return { getGuestId: () => "guest-id" };
    if (specifier === "@/lib/streaming") return { realtimeGet: (...args) => realtimeGetImpl(...args) };
    if (specifier === "@/lib/chatRuntime") return { chatRuntimeStore: chatRuntimeStoreMock };
    if (specifier === "@/lib/chatCompareRunCoordinator") return { runCompareModels: (...args) => compareRunImpl(...args) };
    if (specifier === "@/lib/chatCompareInitCoordinator") return { initCompareRun: (...args) => compareInitImpl(...args) };
    if (specifier === "@/lib/chatSingleSendCoordinator") {
      return {
        shouldStartSingleSend: ({ content, isRegenerate, attachments }) => Boolean((content || "").trim() || isRegenerate || (attachments && attachments.length)),
        buildNewConversationTitle: (content) => content.trim().slice(0, 20) + (content.trim().length > 20 ? "..." : ""),
        prepareSingleSendMessages: ({ content, messages, modelId, isRegenerate, skipUserMessage, attachments, search, createId, now }) => {
          if (isRegenerate && !messages.some((m) => m.role === "user")) return undefined;
          const localRunId = createId();
          const assistant = { id: createId(), role: "assistant", content: "", model: modelId, createdAt: now(), searchStatus: search ? "searching" : undefined, localRunId, generationStatus: "pending" };
          assistant.clientMessageId = assistant.id;
          const user = skipUserMessage
            ? { id: createId(), role: "user", content, createdAt: now(), localRunId, sendStatus: "submitting" }
            : { id: createId(), role: "user", content: content.trim(), files: attachments || [], createdAt: now(), localRunId, sendStatus: "submitting" };
          user.clientMessageId = user.id;
          return {
            mode: skipUserMessage ? "skip-user" : "normal",
            assistantMessage: assistant,
            userMessage: skipUserMessage ? undefined : user,
            contextMessages: [...messages, user],
          };
        },
        applySingleSendMessagePlan: (prev, plan) => [...prev, ...(plan.userMessage ? [plan.userMessage] : []), plan.assistantMessage],
        runSingleChatInit: (...args) => singleInitImpl(...args),
        runSingleChatRequest: (...args) => singleRequestImpl(...args),
      };
    }
    if (specifier === "@/lib/chatMessageIdentity") return {
      sameChatMessage: (a, b) => Boolean((a.serverMessageId && b.serverMessageId && a.serverMessageId === b.serverMessageId) || (a.clientMessageId && b.clientMessageId && a.clientMessageId === b.clientMessageId) || (a.localRunId && b.localRunId && a.role === b.role && a.localRunId === b.localRunId) || (a.id && b.id && a.id === b.id)),
      bindServerMessage: (local, patch) => ({ ...local, ...patch, id: local.id, clientMessageId: local.clientMessageId, localRunId: local.localRunId }),
    };
    if (specifier === "@/lib/chatConversationCreateCoordinator") {
      return {
        shouldCreateConversation: ({ token }) => Boolean(token),
        buildCreateConversationBody: ({ title, model, skillKey, workspaceId }) => ({ title, model, skill_key: skillKey || undefined, workspace_id: workspaceId ? Number(workspaceId) : undefined }),
        runCreateConversationRequest: (...args) => createConversationRequestImpl(...args),
        resolveCreatedConversationTitle: (data, fallback) => data.title || fallback,
        buildCreatedConversationUrl: ({ currentHref, conversationId, skillKey }) => `${currentHref.split("?")[0]}?id=${conversationId}${skillKey ? `&key=${skillKey}` : ""}`,
      };
    }
    if (specifier === "@/lib/chatRunUiCoordinator") {
      return {
        buildConversationUpdatedEventDetail: (conversationId, updatedAt) => ({ id: conversationId, updated_at: updatedAt }),
        buildRecoverableResultPatch: ({ serverMessageId, generationTaskId, busyActivityStatus }) => ({ serverMessageId, generationTaskId, activityStatus: busyActivityStatus }),
        buildUserAbortStoppedPatch: (now) => ({ completedAt: now, stopped: true }),
        decideCompareRunError: ({ realtime, existingServerMessageId, busyActivityStatus }) => ({
          type: "recoverable_busy",
          shouldStartBackgroundPolling: true,
          serverMessageId: realtime?.serverMessageId || existingServerMessageId || 101,
          patch: { activityStatus: busyActivityStatus },
        }),
        decideCompareRunFinally: ({ abortReason, hasActiveTaskStream, hasActivePoller, conversationId }) => ({
          shouldUpdateLoading: true,
          isLoading: hasActiveTaskStream || hasActivePoller,
          shouldClearCompareControllers: !abortReason,
          shouldClearMainController: !abortReason,
          shouldClearAbortReason: !abortReason,
          shouldDispatchConversationUpdated: !abortReason && Boolean(conversationId),
          conversationId,
        }),
        decideSingleSendError: ({ error, abortReason, busyActivityStatus }) => abortReason ? { type: "none" } : { type: "display_error", patch: { error: error?.message || "err", activityStatus: busyActivityStatus } },
        decideSingleSendFinally: ({ abortReason, hasActiveTaskStream, conversationId }) => ({
          shouldUpdateLoading: true,
          isLoading: hasActiveTaskStream,
          shouldClearMainController: !abortReason,
          shouldClearAbortReason: !abortReason,
          shouldDispatchConversationUpdated: !abortReason && Boolean(conversationId),
          conversationId,
        }),
      };
    }
    if (specifier === "@/lib/chatLocalActionCoordinator") {
      return {
        buildCreateConversationFailureMessage: ({ id, modelId, createdAt }) => ({ id, role: "assistant", model: modelId, content: "创建对话失败", createdAt, error: "create failed" }),
        appendCreateConversationFailureMessage: (prev, msg) => [...prev, msg],
      };
    }
    if (specifier === "@/lib/chatMessageStatePatch") {
      return {
        patchMessageById: (messages, id, patch) => messages.map((m) => m.id === id ? (typeof patch === "function" ? patch(m) : { ...m, ...patch }) : m),
        applyCompareGroupContextToMessages: (messages, { context }) => messages.map((m) => ({ ...m, groupId: context.groupId || m.groupId, userMessageId: context.userMessageId || m.userMessageId })),
      };
    }
    if (specifier === "@/lib/chatRequestBuilder") return { buildChatRequestHeaders: ({ token, guestId }) => token ? { Authorization: `Bearer ${token}` } : { "X-Guest-ID": guestId } };
    if (specifier === "@/lib/chatHistoryTransform") return { toModelMessages: (messages) => messages.map((m) => ({ role: m.role, content: m.content })) };
    if (specifier === "@/lib/chatInitialRealtime") return { initializeAssistantRealtime: () => {}, initializeAssistantRealtimeBatch: () => {} };
    if (specifier === "@/lib/chatConversationCache") return { setConversationSnapshot: () => {} };
    if (specifier === "@/lib/chatConversationPersistentCache") return { setPersistentConversationSnapshot: async () => {} };
    if (specifier === "@/lib/chatMessageFactory") {
      return {
        buildMessageFiles: (attachments) => (attachments || []).filter((a) => a.public_id).map((a) => ({ public_id: a.public_id, filename: a.filename, type: a.type || "file" })),
        createUserChatMessage: ({ id, content, createdAt, files }) => ({ id, role: "user", content: content.trim(), files, createdAt }),
        createCompareAssistantMessages: ({ modelIds, ids, createdAt, search }) => modelIds.map((modelId, i) => ({ id: ids[i], role: "assistant", content: "", model: modelId, createdAt, searchStatus: search ? "searching" : undefined })),
      };
    }
    if (specifier === "@/lib/chatCompareCoordinator") return { selectCompareModelIds: (ids, models) => ids.filter((id) => models.some((m) => m.id === id)).slice(0, 4), shouldStartCompare: (ids) => ids.length >= 2 };
    if (specifier === "@/lib/chatActivityStatus") return { createBusyGeneratingStatus: () => ({ kind: "generating", label: "busy" }) };
    if (compiledFiles.has(specifier)) return loadModule(compiledFiles.get(specifier));
    if (specifier.startsWith("@/lib/")) return {};
    return require(specifier);
  };
  new Function("require", "module", "exports", code)(localRequire, module, module.exports);
  return module.exports;
}
const { useChatSendRuntime } = loadModule(tmpFile);

function resetRuntimeStore() {
  chatRuntimeStoreCalls.length = 0;
  chatRuntimeStoreState.clear();
}
function runtimePatches(conversationId) {
  return chatRuntimeStoreCalls.filter((call) => call[0] === "patchConversation" && call[1] === conversationId).map((call) => call[2]);
}
function stateHarness(initial = []) {
  let messages = initial;
  let isLoading = false;
  let isCompare = false;
  let compareModels = [];
  const calls = [];
  return {
    get messages() { return messages; },
    get isLoading() { return isLoading; },
    get isCompare() { return isCompare; },
    get compareModels() { return compareModels; },
    calls,
    setMessages: (updater) => { messages = typeof updater === "function" ? updater(messages) : updater; calls.push(["messages", messages]); },
    setIsLoading: (value) => { isLoading = typeof value === "function" ? value(isLoading) : value; calls.push(["loading", isLoading]); },
    setIsCompare: (value) => { isCompare = value; calls.push(["compare", value]); },
    setCompareModels: (value) => { compareModels = value; calls.push(["models", value]); },
  };
}
function makeRuntime(overrides = {}) {
  const state = stateHarness(overrides.messages || []);
  const refs = {
    abortControllerRef: { current: null },
    compareAbortControllersRef: { current: [] },
    abortReasonRef: { current: null },
    taskStreamsRef: { current: {} },
    pendingLocalAssistantsRef: { current: {} },
    backgroundPollersRef: { current: {} },
    lastReasoningRef: { current: { enabled: false, effort: "high" } },
    lastSearchRef: { current: false },
  };
  const startPolls = [];
  const runtime = useChatSendRuntime({
    apiBaseUrl: "",
    messages: state.messages,
    models: [{ id: "m1", name: "M1" }, { id: "m2", name: "M2" }, { id: "m3", name: "M3" }],
    selectedModel: { id: "m1", name: "M1" },
    currentConversation: overrides.currentConversation,
    effectiveSkillKey: "skill",
    setCreatedConversation: (id, title) => events.push(["created", id, title]),
    setMessages: state.setMessages,
    setIsLoading: state.setIsLoading,
    setIsCompare: state.setIsCompare,
    setCompareModels: state.setCompareModels,
    ...refs,
    streamResponse: async () => overrides.streamResult,
    startBackgroundPolling: (...args) => startPolls.push(args),
    translate: (key) => key,
    now: () => 1000,
    createId: (() => { let i = 0; return () => `id-${++i}`; })(),
    getToken: () => overrides.token ?? null,
    getWorkspaceId: () => "7",
    getCurrentHref: () => "http://local/chat/",
    replaceHistory: (url) => events.push(["replace", url]),
    dispatchWindowEvent: (event) => events.push(["event", event.type, event.detail]),
  });
  return { runtime, state, refs, startPolls };
}

async function testSingleSendCreatesConversationAndRunsRequest() {
  events.length = 0;
  resetRuntimeStore();
  let request;
  singleInitImpl = async (opts) => { request = opts; return {
    conversation_id: 42,
    user_message_id: 501,
    assistant_message_id: 502,
    task_id: 900,
    mappedAssistantMessage: { id: "502", role: "assistant", content: "", model: "m1", createdAt: 1000, serverMessageId: 502, generationTaskId: 900, serverGenerationStatus: "running" },
  }; };
  createConversationRequestImpl = async ({ body }) => ({ id: 42, title: body.title });
  const { runtime, state, refs } = makeRuntime({ token: "tok" });
  const accepted = await runtime.sendMessage("hello world", { enabled: true, effort: "low" }, false, true, 3, false, [{ filename: "a", content: "", type: "file", public_id: "p" }], ["f1"], "tpl");
  await accepted.completion;
  assert.equal(accepted.accepted, true);
  assert.equal(events.find((e) => e[0] === "created")?.[1], 42);
  assert.equal(state.messages.length, 2);
  assert.equal(state.messages[1].role, "assistant");
  assert.notEqual(state.messages[1].id, "502");
  assert.equal(state.messages[1].id, state.messages[1].clientMessageId);
  assert.equal(state.messages[1].serverMessageId, 502);
  assert.equal(state.messages[1].generationTaskId, 900);
  assert.equal(state.messages[0].id, state.messages[0].clientMessageId);
  assert.equal(state.messages[0].serverMessageId, 501);
  assert.equal(state.messages[0].sendStatus, "server_bound");
  assert.equal(state.messages[0].localRunId, state.messages[1].localRunId);
  assert.equal(request.conversationId, 42);
  assert.equal(request.modelId, "m1");
  assert.deepEqual(request.messageFileIds, ["f1"]);
  assert.equal(refs.abortControllerRef.current, null);
  assert.equal(refs.abortReasonRef.current, null);
  const patches = runtimePatches(42);
  assert.ok(patches.some((patch) => patch.messages?.some((message) => message.role === "user" && message.content === "hello world")));
  assert.ok(patches.some((patch) => patch.pendingOptimisticMessages?.some((message) => message.serverMessageId === 502 && message.id === state.messages[1].id)));
  assert.deepEqual(patches.at(-1).pendingOptimisticMessages, []);
  assert.equal(Object.prototype.hasOwnProperty.call(patches.at(-1), "messages"), false, "clearing pending optimistic assistants must not overwrite fresher streamed messages");
  assert.ok(events.some((e) => e[0] === "event" && e[1] === "conversation-updated"));
}

async function testSingleSendCreateFailureAppendsPlaceholder() {
  createConversationRequestImpl = async () => undefined;
  const { runtime, state } = makeRuntime({ token: "tok" });
  const accepted = await runtime.sendMessage("hello");
  assert.equal(accepted.accepted, false);
  assert.match(accepted.notice, /创建对话失败/);
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].error, "create failed");
  assert.equal(state.isLoading, false);
}

async function testSingleSendRequestErrorPatchesAssistant() {
  singleInitImpl = async () => { throw new Error("boom"); };
  const { runtime, state } = makeRuntime({ currentConversation: 9 });
  const accepted = await runtime.sendMessage("hello");
  await accepted.completion;
  assert.equal(accepted.accepted, true);
  assert.equal(state.messages.length, 2);
  assert.equal(state.messages[0].sendStatus, "failed");
  assert.equal(state.messages[1].error, "boom");
  assert.equal(state.messages[1].generationStatus, "failed");
}

async function testCompareSendStartsCompareAndRunCoordinator() {
  resetRuntimeStore();
  let compareOpts;
  let initOpts;
  compareInitImpl = async (opts) => {
    initOpts = opts;
    return {
      conversation_id: 10,
      user_message: { id: 501, conversation_id: 10, role: "user", content: opts.content },
      group: { id: 601, conversation_id: 10, user_message_id: 501, group_models: ["m1", "m2"] },
      compare_models: ["m1", "m2"],
    };
  };
  compareRunImpl = async (opts) => {
    compareOpts = opts;
    opts.callbacks.onGroupContextResolved({ groupId: "g", userMessageId: "u", groupModels: ["m1", "m2"] });
    opts.assistantMessages.forEach((assistant, index) => {
      assistant.id = `assistant-task:${700 + index}`;
      assistant.serverMessageId = 600 + index;
      assistant.generationTaskId = 700 + index;
      opts.callbacks.onRecoverableResult(assistant, { serverMessageId: 600 + index, generationTaskId: 700 + index, lastSequence: 0, content: "" });
    });
    opts.callbacks.onRunError(opts.assistantMessages[0], new Error("recover"));
  };
  realtimeGetImpl = () => ({ serverMessageId: 202 });
  const { runtime, state, refs, startPolls } = makeRuntime({ currentConversation: 10, token: "tok" });
  await runtime.sendCompareMessages("compare", ["m1", "missing", "m2"], { enabled: false }, true);
  assert.equal(state.isCompare, true);
  assert.deepEqual(state.compareModels, ["m1", "m2"]);
  assert.deepEqual(initOpts.compareModelIds, ["m1", "m2"]);
  assert.equal(initOpts.workspaceId, "7");
  assert.equal(compareOpts.conversationId, 10);
  assert.deepEqual(compareOpts.explicitGroupContext, { groupId: 601, userMessageId: 501, groupModels: ["m1", "m2"] });
  assert.equal(compareOpts.assistantMessages.length, 2);
  assert.deepEqual(compareOpts.assistantMessages.map((message) => message.groupId), [601, 601]);
  assert.deepEqual(compareOpts.assistantMessages.map((message) => message.groupIndex), [0, 1]);
  assert.deepEqual(state.messages.filter((message) => message.role === "assistant").map((message) => message.id), ["assistant-task:700", "assistant-task:701"]);
  assert.deepEqual(state.messages.filter((message) => message.role === "assistant").map((message) => message.serverMessageId), [600, 601]);
  assert.deepEqual(state.messages.filter((message) => message.role === "assistant").map((message) => message.generationTaskId), [700, 701]);
  assert.equal(refs.compareAbortControllersRef.current.length, 0);
  const patches = runtimePatches(10);
  assert.ok(patches.some((patch) => patch.messages?.some((message) => message.role === "user" && message.content === "compare")));
  assert.ok(patches.some((patch) => patch.messages?.filter((message) => message.role === "assistant").length === 2));
  assert.deepEqual(patches.at(-1).compareModels, ["m1", "m2"]);
  assert.deepEqual(startPolls[0], [10, compareOpts.assistantMessages[0].id, 202]);
}

async function testCompareGuardSkipsInvalidWidth() {
  let ran = false;
  compareRunImpl = async () => { ran = true; };
  const { runtime, state } = makeRuntime({ currentConversation: 10 });
  await runtime.sendCompareMessages("compare", ["m1"]);
  assert.equal(ran, false);
  assert.equal(state.messages.length, 0);
}

async function testCompareInitFailureLeavesNoLocalMessages() {
  let ran = false;
  compareInitImpl = async () => { throw new Error("compare init boom"); };
  compareRunImpl = async () => { ran = true; };
  const { runtime, state } = makeRuntime({ currentConversation: 10, token: "tok" });
  await assert.rejects(
    () => runtime.sendCompareMessages("compare draft", ["m1", "m2"]),
    /compare init boom/
  );
  assert.equal(ran, false);
  assert.equal(state.messages.length, 0);
  assert.equal(state.isCompare, false);
  assert.equal(state.isLoading, false);
}

(async () => {
  await testSingleSendCreatesConversationAndRunsRequest();
  await testSingleSendCreateFailureAppendsPlaceholder();
  await testSingleSendRequestErrorPatchesAssistant();
  await testCompareSendStartsCompareAndRunCoordinator();
  await testCompareGuardSkipsInvalidWidth();
  await testCompareInitFailureLeavesNoLocalMessages();
  console.log("chat send runtime hook regression passed");
})();
