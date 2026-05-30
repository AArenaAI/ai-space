#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "../..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-conversation-lifecycle-hook-"));
const outFile = path.join(tempDir, "useChatConversationLifecycle.cjs");
const sourceFile = path.join(repoRoot, "hooks/useChatConversationLifecycle.ts");
let source = fs.readFileSync(sourceFile, "utf8");
source = source.replace(/import type[^;]+chatTypes[^;]+;\n/g, "");
source = source.replace(
  /import \{\n  buildLoadMorePage,[\s\S]*?\} from "@\/lib\/chatLoadMoreCoordinator";/,
  `function buildLoadMorePage({ totalMessages, loadedPersistedMessages }) {
    const offset = Math.max(0, totalMessages - loadedPersistedMessages - 50);
    const expectedOlderCount = Math.max(0, totalMessages - loadedPersistedMessages - offset);
    return { offset, requestLimit: expectedOlderCount || 50 };
  }
  async function fetchLoadMoreMessages() { throw new Error("fetchLoadMoreMessages stub should be injected"); }
  function mapLoadMoreMessages(data, { fallbackId }) { return (data.messages || []).map((message) => ({ id: fallbackId(), ...message })); }
  function prependUniqueOlderMessages(prev, olderMessages) { return olderMessages.concat(prev); }
  function resolveLoadedPersistedMessages({ previousLoaded, olderMessagesCount, responseTotal, fallbackTotal }) { return Math.min(responseTotal ?? fallbackTotal, previousLoaded + olderMessagesCount); }
  function resolveTotalMessages(responseTotal, fallbackTotal) { return typeof responseTotal === "number" ? responseTotal : fallbackTotal; }
  function shouldStartLoadMore({ currentConversation, isLoadingMore, hasMoreMessages, token }) { return !!currentConversation && !!token && !isLoadingMore && hasMoreMessages; }`
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
fs.writeFileSync(
  outFile,
  compiled.outputText.replace(
    'require("react")',
    '{ useCallback: (fn) => fn, useMemo: (fn) => fn(), useRef: (initial) => ({ current: initial }), useState: (initial) => [initial, () => {}] }'
  )
);

const {
  hasMorePersistedMessages,
  markConversationCreated,
  createSetCreatedConversationAction,
  createResetConversationPaginationAction,
  createSetLoadedConversationAction,
  createApplyNavigationResetLifecycleAction,
  createApplyJustCreatedNavigationLifecycleAction,
  createApplyLoadExistingNavigationLifecycleAction,
  createLoadMoreMessagesAction,
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

test("hasMorePersistedMessages compares total and loaded counts", () => {
  assert.equal(hasMorePersistedMessages(51, 50), true);
  assert.equal(hasMorePersistedMessages(50, 50), false);
  assert.equal(hasMorePersistedMessages(10, 20), false);
});

test("markConversationCreated suppresses reset and records just-created id", () => {
  const shouldResetRef = { current: true };
  const justCreatedRef = { current: undefined };
  markConversationCreated({ shouldResetRef, justCreatedRef, conversationId: 42 });
  assert.equal(shouldResetRef.current, false);
  assert.equal(justCreatedRef.current, 42);
});

test("createSetCreatedConversationAction sets title/current and creation refs", () => {
  const title = createState("");
  const current = createState(undefined);
  const shouldResetRef = { current: true };
  const justCreatedRef = { current: undefined };
  const action = createSetCreatedConversationAction({
    setConversationTitle: title.set,
    setCurrentConversation: current.set,
    shouldResetRef,
    justCreatedRef,
  });
  action(7, "Hello");
  assert.equal(title.get(), "Hello");
  assert.equal(current.get(), 7);
  assert.equal(shouldResetRef.current, false);
  assert.equal(justCreatedRef.current, 7);
});

test("createResetConversationPaginationAction clears loaded and total counts", () => {
  const loaded = createState(50);
  const total = createState(120);
  const action = createResetConversationPaginationAction({
    setLoadedPersistedMessages: loaded.set,
    setTotalMessages: total.set,
  });
  action();
  assert.equal(loaded.get(), 0);
  assert.equal(total.get(), 0);
});

test("createSetLoadedConversationAction applies loaded conversation metadata", () => {
  const title = createState("");
  const current = createState(undefined);
  const loaded = createState(0);
  const total = createState(0);
  const action = createSetLoadedConversationAction({
    setConversationTitle: title.set,
    setCurrentConversation: current.set,
    setLoadedPersistedMessages: loaded.set,
    setTotalMessages: total.set,
  });
  action({ id: 9, title: "Loaded", loadedPersistedMessages: 30, totalMessages: 88 });
  assert.equal(title.get(), "Loaded");
  assert.equal(current.get(), 9);
  assert.equal(loaded.get(), 30);
  assert.equal(total.get(), 88);
});

test("navigation lifecycle reset action applies conversation metadata only when plan asks", () => {
  const title = createState("old");
  const current = createState(12);
  const loaded = createState(50);
  const total = createState(80);
  const action = createApplyNavigationResetLifecycleAction({
    setConversationTitle: title.set,
    setCurrentConversation: current.set,
    setLoadedPersistedMessages: loaded.set,
    setTotalMessages: total.set,
  });

  action({
    shouldClearConversationTitle: true,
    conversationTitle: "",
    shouldSetCurrentConversation: true,
    currentConversation: undefined,
    loadedPersistedMessages: 0,
    totalMessages: 0,
  });

  assert.equal(title.get(), "");
  assert.equal(current.get(), undefined);
  assert.equal(loaded.get(), 0);
  assert.equal(total.get(), 0);
});

test("just-created navigation lifecycle clears justCreated ref and pagination", () => {
  const current = createState(undefined);
  const loaded = createState(50);
  const total = createState(80);
  const justCreatedRef = { current: 9 };
  const action = createApplyJustCreatedNavigationLifecycleAction({
    setCurrentConversation: current.set,
    setLoadedPersistedMessages: loaded.set,
    setTotalMessages: total.set,
    justCreatedRef,
  });

  action({
    shouldClearJustCreated: true,
    conversationId: 9,
    loadedPersistedMessages: 0,
    totalMessages: 0,
  });

  assert.equal(justCreatedRef.current, undefined);
  assert.equal(current.get(), 9);
  assert.equal(loaded.get(), 0);
  assert.equal(total.get(), 0);
});

test("load-existing navigation lifecycle only sets current conversation when requested", () => {
  const current = createState(1);
  const action = createApplyLoadExistingNavigationLifecycleAction({ setCurrentConversation: current.set });
  action({ shouldSetCurrentConversation: false, conversationId: 2 });
  assert.equal(current.get(), 1);
  action({ shouldSetCurrentConversation: true, conversationId: 2 });
  assert.equal(current.get(), 2);
});

test("createLoadMoreMessagesAction loads, prepends and updates counters", async () => {
  const messages = createState([{ id: "existing", serverMessageId: 20 }]);
  const loading = createState(false);
  const loaded = createState(50);
  const total = createState(120);
  const fetchCalls = [];
  const action = createLoadMoreMessagesAction({
    apiBaseUrl: "",
    getCurrentConversation: () => 3,
    getIsLoadingMore: () => loading.get(),
    getHasMoreMessages: () => true,
    getTotalMessages: () => total.get(),
    getLoadedPersistedMessages: () => loaded.get(),
    getToken: () => "token",
    fallbackId: () => "older-local",
    setIsLoadingMore: loading.set,
    setMessages: messages.set,
    setLoadedPersistedMessages: loaded.set,
    setTotalMessages: total.set,
    fetchPage: async (request) => {
      fetchCalls.push(request);
      return { total: 120, messages: [{ serverMessageId: 10, content: "older" }] };
    },
  });

  await action();

  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(fetchCalls[0].page, { offset: 20, requestLimit: 50 });
  assert.equal(loading.get(), false);
  assert.equal(messages.get()[0].content, "older");
  assert.equal(messages.get()[1].id, "existing");
  assert.equal(loaded.get(), 51);
  assert.equal(total.get(), 120);
});

test("createLoadMoreMessagesAction no-ops when guard fails", async () => {
  const loading = createState(false);
  const messages = createState([]);
  const loaded = createState(0);
  const total = createState(0);
  let fetched = false;
  const action = createLoadMoreMessagesAction({
    apiBaseUrl: "",
    getCurrentConversation: () => undefined,
    getIsLoadingMore: () => false,
    getHasMoreMessages: () => true,
    getTotalMessages: () => 100,
    getLoadedPersistedMessages: () => 50,
    getToken: () => "token",
    fallbackId: () => "id",
    setIsLoadingMore: loading.set,
    setMessages: messages.set,
    setLoadedPersistedMessages: loaded.set,
    setTotalMessages: total.set,
    fetchPage: async () => {
      fetched = true;
      return { total: 100, messages: [] };
    },
  });

  await action();

  assert.equal(fetched, false);
  assert.equal(loading.get(), false);
});

test("createLoadMoreMessagesAction ignores thrown fetch and clears loading", async () => {
  const loading = createState(false);
  const messages = createState([]);
  const loaded = createState(50);
  const total = createState(100);
  const action = createLoadMoreMessagesAction({
    apiBaseUrl: "",
    getCurrentConversation: () => 1,
    getIsLoadingMore: () => false,
    getHasMoreMessages: () => true,
    getTotalMessages: () => 100,
    getLoadedPersistedMessages: () => 50,
    getToken: () => "token",
    fallbackId: () => "id",
    setIsLoadingMore: loading.set,
    setMessages: messages.set,
    setLoadedPersistedMessages: loaded.set,
    setTotalMessages: total.set,
    fetchPage: async () => {
      throw new Error("network");
    },
  });

  await action();

  assert.equal(loading.get(), false);
  assert.deepEqual(messages.get(), []);
  assert.equal(loaded.get(), 50);
  assert.equal(total.get(), 100);
});

(async () => {
  try {
    for (const entry of tests) {
      await entry.fn();
      console.log(`✓ ${entry.name}`);
    }
    console.log(`chat conversation lifecycle hook regression passed (${tests.length} tests)`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
