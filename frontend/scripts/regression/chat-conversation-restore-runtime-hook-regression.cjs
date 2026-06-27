#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "../..");
const sourceFile = path.join(repoRoot, "hooks/useChatConversationRestoreRuntime.ts");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chat-restore-runtime-"));
const tmpFile = path.join(tmpRoot, "useChatConversationRestoreRuntime.cjs");
const source = fs.readFileSync(sourceFile, "utf8");
const transformed = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;

let effectCleanup;
let restoreImpl = async () => ({ title: "Restored", messages: [], model: "m1" });
let statusImpl = async () => undefined;
let countImpl = async () => undefined;
const snapshotCache = new Map();
const persistentSnapshotCache = new Map();

function makeController() {
  return { aborted: false, abort() { this.aborted = true; }, signal: { aborted: false } };
}

const moduleCache = new Map();
function loadModule(file) {
  if (moduleCache.has(file)) return moduleCache.get(file).exports;
  const code = fs.readFileSync(file, "utf8");
  const module = { exports: {} };
  moduleCache.set(file, module);
  const localRequire = (specifier) => {
    if (specifier === "react") {
      return { useEffect: (fn) => { effectCleanup = fn(); } };
    }
    if (specifier === "uuid") return { v4: () => "uuid" };
    if (specifier === "@/lib/chatNavigationResetCoordinator") {
      return {
        buildConversationNavigationPlan: ({ conversationId, shouldReset, justCreatedConversationId, skillKey, hasMainAbortController, compareAbortControllerCount }) => {
          if (!conversationId) return { kind: "reset", shouldSetLoadingHistory: true, loadingHistory: false, shouldResetMessages: shouldReset, isCompare: false, compareModels: [], effectiveSkillKey: skillKey };
          if (justCreatedConversationId === conversationId) return { kind: "just_created", shouldClearJustCreated: true, conversationId, loadingHistory: false, loadedPersistedMessages: 0, totalMessages: 0 };
          return { kind: "load_existing", conversationId, shouldSetLoadingHistory: true, loadingHistory: true, shouldSetCurrentConversation: true, abortPlan: { shouldAbortMain: hasMainAbortController, shouldAbortCompare: compareAbortControllerCount > 0, abortReason: (hasMainAbortController || compareAbortControllerCount > 0) ? "navigation" : null } };
        },
        shouldContinueConversationRestore: ({ token, loadAborted }) => Boolean(token) && !loadAborted,
      };
    }
    if (specifier === "@/lib/chatConversationRestoreCoordinator") {
      return {
        fetchConversationRestore: (...args) => restoreImpl(...args),
        fetchConversationMessageStatus: (...args) => statusImpl(...args),
        fetchConversationMessageCount: (...args) => countImpl(...args),
        buildConversationRestoreState: ({ data }) => {
          if (data.noState) return undefined;
          const loadedMessages = (data.messages || []).map((m) => ({
            ...m,
            serverMessageId: m.serverMessageId ?? (Number(m.id) || undefined),
            createdAt: m.createdAt ?? (m.created_at ? Date.parse(m.created_at) : undefined),
            completedAt: m.completedAt ?? (m.completed_at ? Date.parse(m.completed_at) : undefined),
          }));
          let mergedMessages = loadedMessages.map((m) => ({ ...m }));
          const activeByServerMessageId = new Map();
          const status = data.last_assistant_status?.background_task?.status || '';
          if (data.last_assistant_status?.background_task && status !== 'completed' && !String(data.last_assistant_status?.message?.content || '').trim()) {
            mergedMessages = [...mergedMessages, {
              id: 'pending-from-status',
              role: 'assistant',
              content: '',
              serverMessageId: data.last_assistant_status?.message?.id,
              generationTaskId: data.last_assistant_status?.background_task?.id,
              activityStatus: { kind: 'generating', label: 'busy' },
            }];
          }
          return { loadedMessages, mergedMessages, groupViews: new Map([[1, 0]]), activeByServerMessageId, isLoading: Boolean(data.isLoading || mergedMessages.some((m) => m.activityStatus)) };
        },
        findLastAssistantStatusTarget: (messages) => [...messages].reverse().find((m) => m.role === "assistant" && m.serverMessageId),
        hasCompletedLastAssistantStatus: (statusData) => statusData?.background_task?.status === 'completed' && String(statusData?.message?.content || '').trim().length > 0,
        buildConversationStatusDecision: ({ statusData, currentMessage, busyActivityStatus }) => {
          const bgTask = statusData?.background_task || {};
          const status = bgTask.status || '';
          const terminalStatus = status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'incomplete';
          const content = statusData.content || statusData.message?.content || currentMessage.content;
          const hasTask = Boolean(bgTask.id || bgTask.task_id || bgTask.status);
          const shouldResumePolling = Boolean(statusData.resume) || (hasTask && (!terminalStatus || !String(content || '').trim()));
          return {
            hasTask,
            patch: { content, activityStatus: shouldResumePolling ? busyActivityStatus : undefined, serverGenerationStatus: status || currentMessage.serverGenerationStatus },
            shouldResumePolling,
            resume: statusData.resume,
          };
        },
        parseConversationCompareModels: (value) => Array.isArray(value) ? value : (typeof value === "string" ? JSON.parse(value || "[]") : []),
        resolveConversationSkillKey: (historical, fallback) => historical || fallback,
      };
    }
    if (specifier === "@/lib/chatMessageStatePatch") return { patchMessageById: (messages, id, patch) => messages.map((m) => m.id === id ? { ...m, ...patch } : m) };
    if (specifier === "@/lib/chatForkCoordinator") return { buildGroupViewsFromMessages: () => new Map([[1, 0]]) };
    if (specifier === "@/lib/chatConversationCache") {
      return {
        getConversationSnapshot: (id) => snapshotCache.get(id),
        setConversationSnapshot: (snapshot) => snapshotCache.set(snapshot.conversationId, snapshot),
        patchConversationSnapshot: (id, patch) => {
          const existing = snapshotCache.get(id);
          if (existing) snapshotCache.set(id, { ...existing, ...patch });
        },
        invalidateConversationSnapshot: (id) => snapshotCache.delete(id),
        areConversationMessagesEquivalent: (left, right) =>
          left.length === right.length && left.every((message, index) => message.id === right[index].id && message.content === right[index].content),
      };
    }
    if (specifier === "@/lib/chatConversationPersistentCache") {
      return {
        getPersistentConversationSnapshot: async (id) => persistentSnapshotCache.get(id),
        setPersistentConversationSnapshot: async (snapshot) => persistentSnapshotCache.set(snapshot.conversationId, snapshot),
        deletePersistentConversationSnapshot: async (id) => persistentSnapshotCache.delete(id),
      };
    }
    if (specifier === "@/lib/chatActivityStatus") return { createBusyGeneratingStatus: () => ({ kind: "generating", label: "busy" }), createGeneratingStatus: () => ({ kind: "generating", label: "generating" }) };
    if (specifier.startsWith("@/")) return {};
    return require(specifier);
  };
  new Function("require", "module", "exports", code)(localRequire, module, module.exports);
  return module.exports;
}
fs.writeFileSync(tmpFile, transformed);
const { useChatConversationRestoreRuntime } = loadModule(tmpFile);

function createState(initialMessages = []) {
  const calls = [];
  let messages = initialMessages;
  return {
    calls,
    get messages() { return messages; },
    setMessages: (updater) => { messages = typeof updater === "function" ? updater(messages) : updater; calls.push(["messages", messages]); },
    setter: (name) => (value) => calls.push([name, typeof value === "function" ? value(undefined) : value]),
  };
}

function runRuntime(overrides = {}) {
  effectCleanup = undefined;
  const state = overrides.state || createState();
  const mainController = overrides.mainController || makeController();
  const compareController = makeController();
  const refs = {
    conversationLoadSeqRef: overrides.conversationLoadSeqRef || { current: overrides.loadSeq || 0 },
    shouldResetRef: { current: overrides.shouldReset ?? true },
    justCreatedRef: { current: overrides.justCreated },
    abortControllerRef: { current: overrides.hasMain ? mainController : null },
    compareAbortControllersRef: { current: overrides.hasCompare ? [compareController] : [] },
    abortReasonRef: { current: null },
    activeTaskStreamsRef: { current: overrides.active || {} },
    pendingLocalAssistantsRef: { current: overrides.pendingLocalAssistants || {} },
  };
  const lifecycle = [];
  const starts = [];
  useChatConversationRestoreRuntime({
    apiBaseUrl: "",
    conversationId: overrides.conversationId,
    models: [{ id: "m1" }, { id: "m2" }],
    modelsKey: "m1|m2",
    skillKey: "fallback-skill",
    ...refs,
    setMessages: state.setMessages,
    setConversationTitle: state.setter("title"),
    setLoadedPersistedMessages: state.setter("loaded"),
    setGroupViews: state.setter("groups"),
    setIsLoading: state.setter("loading"),
    setIsLoadingHistory: state.setter("loadingHistory"),
    setTotalMessages: state.setter("total"),
    setSelectedModel: (model) => state.calls.push(["selectedModel", model.id]),
    setIsCompare: state.setter("isCompare"),
    setCompareModels: state.setter("compareModels"),
    setEffectiveSkillKey: state.setter("skill"),
    applyNavigationResetLifecycle: (plan) => lifecycle.push(["reset", plan]),
    applyJustCreatedNavigationLifecycle: (plan) => lifecycle.push(["just", plan]),
    applyLoadExistingNavigationLifecycle: (plan) => lifecycle.push(["load", plan]),
    startTaskEventStream: (...args) => starts.push(args),
    startBackgroundPolling: (...args) => starts.push(["poll", ...args]),
    translate: (key) => key,
    getToken: () => overrides.token ?? null,
    createId: () => "id",
  });
  return { state, refs, lifecycle, starts, mainController, compareController };
}
function flush() { return new Promise((resolve) => setTimeout(resolve, 0)); }

async function testResetPlanClearsUiWhenAllowed() {
  const { state, lifecycle } = runRuntime({ conversationId: undefined, shouldReset: true });
  assert.equal(lifecycle[0][0], "reset");
  assert.deepEqual(state.calls.find((c) => c[0] === "messages")?.[1], []);
  assert.deepEqual(state.calls.find((c) => c[0] === "compareModels")?.[1], []);
  assert.equal(state.calls.find((c) => c[0] === "skill")?.[1], "fallback-skill");
}
async function testJustCreatedSkipsFetch() {
  let fetched = false;
  restoreImpl = async () => { fetched = true; return {}; };
  const { lifecycle } = runRuntime({ conversationId: 7, justCreated: 7, token: "tok" });
  await flush();
  assert.equal(lifecycle[0][0], "just");
  assert.equal(fetched, false);
}
async function testLoadExistingRestoresStateAndCounts() {
  snapshotCache.clear();
  restoreImpl = async () => ({ title: "T", model: "m2", compare: true, compare_models: '["m1","m2"]', skill_key: "hist", messages: [{ id: "a", role: "assistant", content: "old", serverMessageId: 12 }] });
  statusImpl = async () => undefined;
  countImpl = async () => 88;
  const { state, lifecycle } = runRuntime({ conversationId: 9, token: "tok" });
  await flush();
  await flush();
  await flush();
  assert.equal(lifecycle[0][0], "load");
  assert.equal(state.calls.find((c) => c[0] === "title")?.[1], "T");
  assert.equal(state.messages[0].serverMessageId, 12);
  assert.equal(state.calls.find((c) => c[0] === "selectedModel")?.[1], "m2");
  assert.deepEqual(state.calls.find((c) => c[0] === "compareModels")?.[1], ["m1", "m2"]);
  assert.equal(state.calls.find((c) => c[0] === "skill")?.[1], "hist");
  assert.equal(state.calls.find((c) => c[0] === "total")?.[1], 88);
  assert.equal(snapshotCache.get(9).messages[0].serverMessageId, 12);
}
async function testCacheMissClearsStaleMessagesBeforeRestore() {
  snapshotCache.clear();
  let restoreResolved;
  restoreImpl = async () => new Promise((resolve) => { restoreResolved = resolve; });
  statusImpl = async () => undefined;
  countImpl = async () => undefined;
  const { state } = runRuntime({ conversationId: 9, token: "tok" });
  assert.deepEqual(state.calls.find((c) => c[0] === "messages")?.[1], []);
  await flush();
  restoreResolved({ title: "Fresh", messages: [{ id: "fresh", role: "assistant", content: "fresh" }] });
  await flush(); await flush();
  assert.equal(state.messages[0].content, "fresh");
}
async function testCacheHitShowsSnapshotImmediatelyAndRefreshes() {
  snapshotCache.clear();
  persistentSnapshotCache.clear();
  snapshotCache.set(9, {
    conversationId: 9,
    title: "Cached",
    messages: [{ id: "cached", role: "assistant", content: "cached" }],
    loadedPersistedMessages: 1,
    totalMessages: 1,
    groupViews: new Map([[1, 0]]),
    isLoading: false,
    isCompare: false,
    compareModels: [],
    model: "m1",
    skillKey: "cached-skill",
  });
  restoreImpl = async () => ({ title: "Fresh", model: "m2", messages: [{ id: "fresh", role: "assistant", content: "fresh" }] });
  statusImpl = async () => undefined;
  countImpl = async () => 2;
  const { state } = runRuntime({ conversationId: 9, token: "tok" });
  assert.equal(state.messages[0].content, "cached");
  assert.equal(state.calls.find((c) => c[0] === "loadingHistory" && c[1] === false)?.[1], false);
  await flush(); await flush();
  assert.equal(state.messages[0].content, "fresh");
  assert.equal(snapshotCache.get(9).messages[0].content, "fresh");
  assert.equal(persistentSnapshotCache.get(9).messages[0].content, "fresh");
}
async function testPersistentCacheHitShowsSnapshotBeforeRefresh() {
  snapshotCache.clear();
  persistentSnapshotCache.clear();
  persistentSnapshotCache.set(9, {
    conversationId: 9,
    title: "Persistent",
    messages: [{ id: "persistent", role: "assistant", content: "persistent" }],
    loadedPersistedMessages: 1,
    totalMessages: 1,
    groupViews: new Map([[1, 0]]),
    isLoading: false,
    isCompare: false,
    compareModels: [],
    model: "m1",
    skillKey: "persistent-skill",
  });
  let restoreResolved;
  restoreImpl = async () => new Promise((resolve) => { restoreResolved = resolve; });
  statusImpl = async () => undefined;
  countImpl = async () => 2;
  const { state } = runRuntime({ conversationId: 9, token: "tok" });
  assert.deepEqual(state.calls.find((c) => c[0] === "messages")?.[1], []);
  await flush();
  assert.equal(state.messages[0].content, "persistent");
  assert.equal(state.calls.find((c) => c[0] === "skill" && c[1] === "persistent-skill")?.[1], "persistent-skill");
  restoreResolved({ title: "Fresh", model: "m2", messages: [{ id: "fresh", role: "assistant", content: "fresh" }] });
  await flush(); await flush();
  assert.equal(state.messages[0].content, "fresh");
  assert.equal(snapshotCache.get(9).messages[0].content, "fresh");
  assert.equal(persistentSnapshotCache.get(9).messages[0].content, "fresh");
}
async function testSnapshotVersionSkipsUnchangedRestoreReconcile() {
  snapshotCache.clear();
  persistentSnapshotCache.clear();
  let restoreArgs;
  snapshotCache.set(9, {
    conversationId: 9,
    title: "Cached",
    messages: [{ id: "cached", role: "assistant", content: "cached" }],
    loadedPersistedMessages: 1,
    totalMessages: 1,
    groupViews: new Map([[1, 0]]),
    isLoading: false,
    isCompare: false,
    compareModels: [],
    model: "m1",
    skillKey: "cached-skill",
    snapshotVersion: "9:1:stable",
  });
  restoreImpl = async (args) => {
    restoreArgs = args;
    return { notModified: true, snapshot_version: "9:1:stable" };
  };
  statusImpl = async () => { throw new Error("status should not fetch when snapshot is unchanged"); };
  countImpl = async () => { throw new Error("count should not fetch when snapshot is unchanged"); };
  const { state } = runRuntime({ conversationId: 9, token: "tok" });
  assert.equal(state.messages[0].content, "cached");
  await flush(); await flush();
  assert.equal(restoreArgs.snapshotVersion, undefined);
  assert.equal(state.messages[0].content, "cached");
  assert.equal(persistentSnapshotCache.has(9), false);
}

async function testTerminalStatusDoesNotStartPolling() {
  snapshotCache.clear();
  persistentSnapshotCache.clear();
  restoreImpl = async () => ({
    title: "Done",
    model: "m1",
    messages: [{ id: "a", role: "assistant", content: "done", serverMessageId: 12, generationTaskId: 99, activityStatus: { status: "running" } }],
    last_assistant_status: {
      message: { content: "done" },
      background_task: { id: 99, status: "completed", completed_at: "2026-01-01T00:00:00Z" },
    },
  });
  statusImpl = async () => { throw new Error("status should not fetch when terminal status is present"); };
  countImpl = async () => undefined;
  const { starts, state } = runRuntime({ conversationId: 9, token: "tok" });
  await flush(); await flush();
  assert.equal(starts.some((entry) => entry[0] === "poll"), false);
  assert.equal(state.messages[0].serverGenerationStatus, "completed");
  assert.equal(state.messages[0].activityStatus, undefined);
}

async function testRestoreMetaSkipsCountAndStatusFetches() {
  snapshotCache.clear();
  persistentSnapshotCache.clear();
  let countCalls = 0;
  let statusCalls = 0;
  restoreImpl = async () => ({
    title: "Meta",
    model: "m1",
    total: 123,
    has_more: true,
    snapshot_version: "9:123:12",
    messages: [{ id: "a", role: "assistant", content: "done", serverMessageId: 12 }],
    last_assistant_status: {
      message: { content: "done" },
      background_task: { status: "completed", completed_at: "2026-01-01T00:00:00Z" },
    },
  });
  countImpl = async () => { countCalls += 1; return 999; };
  statusImpl = async () => { statusCalls += 1; return { content: "should-not-fetch" }; };
  const { state } = runRuntime({ conversationId: 9, token: "tok" });
  await flush(); await flush();
  assert.equal(countCalls, 0);
  assert.equal(statusCalls, 0);
  assert.equal(state.calls.find((c) => c[0] === "total")?.[1], 123);
  assert.equal(snapshotCache.get(9).totalMessages, 123);
}
async function testStatusResumeStartsTaskStream() {
  snapshotCache.clear();
  restoreImpl = async () => ({ title: "T", messages: [{ id: "a", role: "assistant", content: "", serverMessageId: 12 }] });
  statusImpl = async () => ({ content: "partial", resume: { lastSequence: 5, initialContent: "partial", generationTaskId: 99 } });
  countImpl = async () => undefined;
  const { starts, state } = runRuntime({ conversationId: 9, token: "tok" });
  await flush(); await flush();
  assert.deepEqual(starts.find((entry) => entry[0] === "poll"), ["poll", 9, "a", 12]);
  assert.ok(state.messages[0].activityStatus);
}
async function testLateRestoreResponseCannotOverwriteLatestConversation() {
  snapshotCache.clear();
  persistentSnapshotCache.clear();
  const sharedSeqRef = { current: 0 };
  const state = createState();
  const resolvers = new Map();
  restoreImpl = async ({ conversationId }) => new Promise((resolve) => resolvers.set(conversationId, resolve));
  statusImpl = async () => undefined;
  countImpl = async () => undefined;

  const first = runRuntime({ conversationId: 101, token: "tok", conversationLoadSeqRef: sharedSeqRef, state });
  await flush();
  const firstCleanup = effectCleanup;
  const second = runRuntime({ conversationId: 202, token: "tok", conversationLoadSeqRef: sharedSeqRef, state });
  await flush();
  firstCleanup?.();

  resolvers.get(202)({ title: "B", model: "m1", messages: [{ id: "b", role: "assistant", content: "B" }] });
  await flush(); await flush();
  assert.equal(state.messages[0].content, "B");
  assert.equal(state.calls.filter((c) => c[0] === "title").at(-1)?.[1], "B");

  resolvers.get(101)({ title: "A", model: "m1", messages: [{ id: "a", role: "assistant", content: "A" }] });
  await flush(); await flush();
  assert.equal(state.messages[0].content, "B");
  assert.equal(state.calls.filter((c) => c[0] === "title").at(-1)?.[1], "B");
  assert.equal(snapshotCache.has(101), false);
  assert.equal(snapshotCache.get(202).messages[0].content, "B");
  second.refs.conversationLoadSeqRef.current = sharedSeqRef.current;
}

async function testPendingLocalAssistantIsPreservedBeforeServerContent() {
  snapshotCache.clear();
  persistentSnapshotCache.clear();
  restoreImpl = async () => ({
    title: "Pending",
    model: "m1",
    messages: [{ id: "u1", role: "user", content: "waiting" }],
  });
  statusImpl = async () => undefined;
  countImpl = async () => undefined;
  const pendingMessage = {
    id: "local-a1",
    role: "assistant",
    content: "",
    model: "m1",
    createdAt: 123,
    activityStatus: { kind: "generating", label: "busy" },
    generationStartedAt: 123,
  };
  const { state } = runRuntime({
    conversationId: 9,
    token: "tok",
    pendingLocalAssistants: { "local-a1": { convId: 9, message: pendingMessage } },
  });
  await flush(); await flush();
  assert.equal(state.messages.length, 2);
  assert.equal(state.messages[1].id, "local-a1");
  assert.equal(state.messages[1].role, "assistant");
  assert.equal(state.messages[1].activityStatus.kind, "generating");
}

async function testVisiblePendingAssistantSurvivesRestoreWhenBackendHasNoAnswerYet() {
  snapshotCache.clear();
  persistentSnapshotCache.clear();
  restoreImpl = async () => ({
    title: "Waiting",
    model: "m1",
    messages: [{ id: "u1", role: "user", content: "waiting" }],
    last_assistant_status: {
      message: { content: "" },
      background_task: { id: 9, status: "running" },
    },
  });
  statusImpl = async () => undefined;
  countImpl = async () => undefined;
  const visiblePending = {
    id: "local-visible",
    role: "assistant",
    content: "",
    model: "m1",
    createdAt: Date.parse("2026-01-01T00:00:02Z"),
    activityStatus: { kind: "generating", label: "busy" },
    generationStartedAt: Date.parse("2026-01-01T00:00:02Z"),
  };
  const state = createState([
    { id: "local-user", role: "user", content: "waiting" },
    visiblePending,
  ]);
  runRuntime({ conversationId: 9, token: "tok", state, pendingLocalAssistants: {} });
  await flush(); await flush();
  assert.equal(state.messages.some((message) => message.role === "assistant" && message.activityStatus?.kind === "generating"), true);
  assert.equal(state.messages.at(-1).role, "assistant");
  assert.equal(state.messages.at(-1).activityStatus.kind, "generating");
}

async function testCompletedServerAssistantDropsPendingLocalPlaceholder() {
  snapshotCache.clear();
  persistentSnapshotCache.clear();
  restoreImpl = async () => ({
    title: "Done",
    model: "m1",
    messages: [
      { id: "u1", role: "user", content: "waiting", created_at: "2026-01-01T00:00:00Z" },
      { id: "srv-a1", role: "assistant", content: "final answer", completed_at: "2026-01-01T00:00:08Z", created_at: "2026-01-01T00:00:02Z" },
    ],
    last_assistant_status: {
      message: { content: "final answer" },
      background_task: { id: 9, status: "completed", completed_at: "2026-01-01T00:00:08Z" },
    },
  });
  statusImpl = async () => undefined;
  countImpl = async () => undefined;
  const pendingMessage = {
    id: "local-a1",
    role: "assistant",
    content: "",
    model: "m1",
    createdAt: Date.parse("2026-01-01T00:00:02Z"),
    activityStatus: { kind: "generating", label: "busy" },
    generationStartedAt: Date.parse("2026-01-01T00:00:02Z"),
  };
  const { state, refs } = runRuntime({
    conversationId: 9,
    token: "tok",
    pendingLocalAssistants: { "local-a1": { convId: 9, message: pendingMessage } },
  });
  await flush(); await flush();
  assert.equal(state.messages.some((message) => message.id === "local-a1"), false);
  assert.equal(state.messages.some((message) => message.id === "srv-a1" && message.content === "final answer"), true);
  assert.equal(refs.pendingLocalAssistantsRef.current["local-a1"], undefined);
}

async function testNavigationAbortsControllers() {
  const { refs, mainController, compareController } = runRuntime({ conversationId: 9, token: null, hasMain: true, hasCompare: true });
  assert.equal(mainController.aborted, true);
  assert.equal(compareController.aborted, true);
  assert.equal(refs.abortReasonRef.current, "navigation");
  assert.equal(refs.abortControllerRef.current, null);
  assert.deepEqual(refs.compareAbortControllersRef.current, []);
}

(async () => {
  await testResetPlanClearsUiWhenAllowed();
  await testJustCreatedSkipsFetch();
  await testLoadExistingRestoresStateAndCounts();
  await testCacheMissClearsStaleMessagesBeforeRestore();
  await testCacheHitShowsSnapshotImmediatelyAndRefreshes();
  await testPersistentCacheHitShowsSnapshotBeforeRefresh();
  await testSnapshotVersionSkipsUnchangedRestoreReconcile();
  await testTerminalStatusDoesNotStartPolling();
  await testRestoreMetaSkipsCountAndStatusFetches();
  await testStatusResumeStartsTaskStream();
  await testLateRestoreResponseCannotOverwriteLatestConversation();
  await testPendingLocalAssistantIsPreservedBeforeServerContent();
  await testVisiblePendingAssistantSurvivesRestoreWhenBackendHasNoAnswerYet();
  await testCompletedServerAssistantDropsPendingLocalPlaceholder();
  await testNavigationAbortsControllers();
  console.log("chat conversation restore runtime hook regression passed");
})();
