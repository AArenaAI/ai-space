#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "../..");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chat-conversation-prefetch-"));
const moduleCache = new Map();
let uuidCounter = 0;
const persistentSnapshots = new Map();

function transpileSource(relativePath) {
  const sourcePath = path.join(repoRoot, relativePath);
  const tmpFile = path.join(tmpRoot, relativePath.replace(/[\\/]/g, "__") + ".cjs");
  const source = fs.readFileSync(sourcePath, "utf8");
  const transformed = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  fs.writeFileSync(tmpFile, transformed);
  return tmpFile;
}

const cacheFile = transpileSource("lib/chatConversationCache.ts");
const prefetchFile = transpileSource("lib/chatConversationPrefetch.ts");

function loadModule(file) {
  if (moduleCache.has(file)) return moduleCache.get(file).exports;
  const code = fs.readFileSync(file, "utf8");
  const module = { exports: {} };
  moduleCache.set(file, module);
  const localRequire = (specifier) => {
    if (specifier === "uuid") return { v4: () => `uuid-${++uuidCounter}` };
    if (specifier === "@/lib/chatConversationCache") return loadModule(cacheFile);
    if (specifier === "@/lib/chatConversationPersistentCache") {
      return { setPersistentConversationSnapshot: async (snapshot) => persistentSnapshots.set(snapshot.conversationId, snapshot) };
    }
    if (specifier === "@/lib/chatConversationRestoreCoordinator") {
      return {
        fetchConversationRestore: async () => ({ title: "unused", messages: [] }),
        fetchConversationMessageCount: async () => undefined,
        parseConversationCompareModels: (value) => Array.isArray(value) ? value : (typeof value === "string" ? JSON.parse(value || "[]") : []),
        resolveConversationSkillKey: (historical, fallback) => historical || fallback,
        buildConversationRestoreState: ({ data }) => {
          if (!data.messages) return undefined;
          const loadedMessages = data.messages.map((message) => ({
            id: `m-${message.id}`,
            serverMessageId: message.id,
            role: message.role,
            content: message.content,
            createdAt: 1,
          }));
          return { loadedMessages, mergedMessages: loadedMessages, groupViews: new Map([[1, 0]]), activeByServerMessageId: new Map(), isLoading: false };
        },
      };
    }
    if (specifier.startsWith("@/")) return {};
    return require(specifier);
  };
  new Function("require", "module", "exports", code)(localRequire, module, module.exports);
  return module.exports;
}

const cache = loadModule(cacheFile);
const prefetch = loadModule(prefetchFile);

function reset() {
  cache.clearConversationSnapshotCache();
  cache.resetConversationSnapshotCacheConfig();
  prefetch.clearConversationPrefetchInFlight();
  prefetch.resetConversationPrefetchConfig();
  persistentSnapshots.clear();
}

function restoreResponse(id) {
  return {
    title: `Conversation ${id}`,
    model: "m1",
    compare: false,
    compare_models: "[]",
    skill_key: "chat",
    total: 2,
    messages: [
      { id: id * 10 + 1, role: "user", content: `u-${id}` },
      { id: id * 10 + 2, role: "assistant", content: `a-${id}` },
    ],
  };
}

async function testPrefetchWritesSnapshot() {
  reset();
  let restoreCalls = 0;
  let countCalls = 0;
  const ok = await prefetch.prefetchConversationSnapshot({
    conversationId: 7,
    token: "token",
    skillKey: "fallback",
    fetchRestore: async ({ conversationId }) => {
      restoreCalls += 1;
      return restoreResponse(conversationId);
    },
    fetchCount: async () => {
      countCalls += 1;
      return 2;
    },
  });
  assert.equal(ok, true);
  assert.equal(restoreCalls, 1);
  assert.equal(countCalls, 0, "restore total should avoid prefetch count request");
  const snap = cache.getConversationSnapshot(7);
  assert.equal(snap.title, "Conversation 7");
  assert.equal(snap.messages.length, 2);
  assert.equal(snap.totalMessages, 2);
  assert.equal(persistentSnapshots.get(7).messages.length, 2);
}

async function testSkipWhenCachedUnlessForced() {
  reset();
  cache.setConversationSnapshot({
    conversationId: 1,
    title: "cached",
    messages: [{ id: "m1", role: "assistant", content: "cached", createdAt: 1 }],
    loadedPersistedMessages: 1,
    totalMessages: 1,
    groupViews: new Map([[1, 0]]),
    isLoading: false,
    isCompare: false,
    compareModels: [],
    fetchedAt: Date.now(),
    updatedAt: Date.now(),
  });
  let calls = 0;
  const ok = await prefetch.prefetchConversationSnapshot({
    conversationId: 1,
    token: "token",
    fetchRestore: async () => {
      calls += 1;
      return restoreResponse(1);
    },
    fetchCount: async () => 2,
  });
  assert.equal(ok, true);
  assert.equal(calls, 0);

  const forced = await prefetch.prefetchConversationSnapshot({
    conversationId: 1,
    token: "token",
    force: true,
    fetchRestore: async () => {
      calls += 1;
      return restoreResponse(1);
    },
    fetchCount: async () => 2,
  });
  assert.equal(forced, true);
  assert.equal(calls, 1);
}

async function testInFlightDedupes() {
  reset();
  let calls = 0;
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const fetchRestore = async ({ conversationId }) => {
    calls += 1;
    await blocker;
    return restoreResponse(conversationId);
  };
  const first = prefetch.prefetchConversationSnapshot({ conversationId: 3, token: "token", fetchRestore, fetchCount: async () => 2 });
  const second = prefetch.prefetchConversationSnapshot({ conversationId: 3, token: "token", fetchRestore, fetchCount: async () => 2 });
  assert.equal(prefetch.isConversationPrefetchInFlight(3), true);
  release();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results, [true, true]);
  assert.equal(calls, 1);
  assert.equal(prefetch.isConversationPrefetchInFlight(3), false);
}

async function testConcurrentLimit() {
  reset();
  prefetch.configureConversationPrefetch({ maxConcurrent: 1 });
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const first = prefetch.prefetchConversationSnapshot({
    conversationId: 10,
    token: "token",
    fetchRestore: async ({ conversationId }) => {
      await blocker;
      return restoreResponse(conversationId);
    },
    fetchCount: async () => 2,
  });
  assert.equal(prefetch.getConversationPrefetchInFlightCount(), 1);
  const second = await prefetch.prefetchConversationSnapshot({
    conversationId: 11,
    token: "token",
    fetchRestore: async ({ conversationId }) => restoreResponse(conversationId),
    fetchCount: async () => 2,
  });
  assert.equal(second, false);
  release();
  assert.equal(await first, true);
}

(async () => {
  await testPrefetchWritesSnapshot();
  await testSkipWhenCachedUnlessForced();
  await testInFlightDedupes();
  await testConcurrentLimit();
  reset();
  console.log("chat conversation prefetch regression passed");
})();
