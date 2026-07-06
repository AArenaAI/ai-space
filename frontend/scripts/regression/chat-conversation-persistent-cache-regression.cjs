#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "../..");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chat-conversation-persistent-cache-"));
const moduleCache = new Map();
const memorySnapshots = new Map();

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

const persistentFile = transpileSource("lib/chatConversationPersistentCache.ts");

function loadModule(file) {
  if (moduleCache.has(file)) return moduleCache.get(file).exports;
  const code = fs.readFileSync(file, "utf8");
  const module = { exports: {} };
  moduleCache.set(file, module);
  const localRequire = (specifier) => {
    if (specifier === "@/lib/chatConversationCache") {
      return { setConversationSnapshot: (snapshot) => memorySnapshots.set(snapshot.conversationId, snapshot) };
    }
    if (specifier.startsWith("@/")) return {};
    return require(specifier);
  };
  new Function("require", "module", "exports", code)(localRequire, module, module.exports);
  return module.exports;
}

const persistent = loadModule(persistentFile);
const ownerPrefix = "user:42:conversation:";

let currentUser = { id: 42, email: "user42@example.test" };

global.window = {
  localStorage: {
    getItem(key) {
      if (key === "user") return currentUser ? JSON.stringify(currentUser) : null;
      return null;
    },
  },
};

function createStorage() {
  const rows = new Map();
  return {
    rows,
    async get(id) { return rows.get(id); },
    async set(record) { rows.set(record.cacheKey, record); },
    async delete(id) { rows.delete(id); },
    async clear() { rows.clear(); },
    async list() { return [...rows.values()]; },
  };
}

function snapshot(id, content = `message-${id}`) {
  return {
    conversationId: id,
    title: `Conversation ${id}`,
    messages: [{ id: `m-${id}`, role: "assistant", content, createdAt: id, serverMessageId: id }],
    loadedPersistedMessages: 1,
    totalMessages: 1,
    groupViews: new Map([[id, 0]]),
    isLoading: false,
    isCompare: false,
    compareModels: [],
    model: "m1",
    skillKey: "chat",
    fetchedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function reset(storage, options = {}) {
  currentUser = { id: 42, email: "user42@example.test" };
  storage.rows.clear();
  memorySnapshots.clear();
  persistent.resetPersistentConversationSnapshotCacheConfig();
  persistent.configurePersistentConversationSnapshotStorageForTests(storage);
  if (Object.keys(options).length > 0) persistent.configurePersistentConversationSnapshotCache(options);
}

async function testSetGetRehydratesMemoryAndClones() {
  const storage = createStorage();
  reset(storage);
  await persistent.setPersistentConversationSnapshot(snapshot(1, "hello"));
  assert.equal(storage.rows.size, 1);
  const hit = await persistent.getPersistentConversationSnapshot(1);
  assert.equal(hit.messages[0].content, "hello");
  assert.equal(hit.groupViews.get(1), 0);
  assert.equal(memorySnapshots.get(1).messages[0].content, "hello");
  hit.messages[0].content = "mutated";
  const second = await persistent.getPersistentConversationSnapshot(1);
  assert.equal(second.messages[0].content, "hello");
}

async function testExpiryDeletesRecord() {
  const storage = createStorage();
  reset(storage, { ttlMs: 5 });
  await persistent.setPersistentConversationSnapshot(snapshot(2));
  await new Promise((resolve) => setTimeout(resolve, 8));
  const hit = await persistent.getPersistentConversationSnapshot(2);
  assert.equal(hit, undefined);
  assert.equal(storage.rows.has(`${ownerPrefix}2`), false);
}

async function testLruPrune() {
  const storage = createStorage();
  reset(storage, { maxEntries: 2, ttlMs: 60_000 });
  await persistent.setPersistentConversationSnapshot(snapshot(1));
  await new Promise((resolve) => setTimeout(resolve, 2));
  await persistent.setPersistentConversationSnapshot(snapshot(2));
  await new Promise((resolve) => setTimeout(resolve, 2));
  await persistent.setPersistentConversationSnapshot(snapshot(3));
  assert.equal(storage.rows.has(`${ownerPrefix}1`), false);
  assert.equal(storage.rows.has(`${ownerPrefix}2`), true);
  assert.equal(storage.rows.has(`${ownerPrefix}3`), true);
}

async function testDeleteAndClear() {
  const storage = createStorage();
  reset(storage);
  await persistent.setPersistentConversationSnapshot(snapshot(1));
  await persistent.setPersistentConversationSnapshot(snapshot(2));
  await persistent.deletePersistentConversationSnapshot(1);
  assert.equal(storage.rows.has(`${ownerPrefix}1`), false);
  assert.equal(storage.rows.has(`${ownerPrefix}2`), true);
  await persistent.clearPersistentConversationSnapshotCache();
  assert.equal(storage.rows.size, 0);
}

async function testUserScopeIsolation() {
  const storage = createStorage();
  reset(storage);
  await persistent.setPersistentConversationSnapshot(snapshot(5, "user-42-secret"));
  assert.equal(storage.rows.has(`${ownerPrefix}5`), true);
  currentUser = { id: 99, email: "user99@example.test" };
  const miss = await persistent.getPersistentConversationSnapshot(5);
  assert.equal(miss, undefined);
  assert.equal(memorySnapshots.has(5), false);
  await persistent.setPersistentConversationSnapshot(snapshot(5, "user-99-message"));
  assert.equal(storage.rows.has("user:99:conversation:5"), true);
  assert.equal(storage.rows.size, 2);
}

async function testMissingUserDisablesPersistentCache() {
  const storage = createStorage();
  reset(storage);
  currentUser = null;
  await persistent.setPersistentConversationSnapshot(snapshot(6));
  assert.equal(storage.rows.size, 0);
  const miss = await persistent.getPersistentConversationSnapshot(6);
  assert.equal(miss, undefined);
}

async function testPersistentStaleSnapshotCannotOverwriteFreshRecord() {
  const storage = createStorage();
  reset(storage);
  await persistent.setPersistentConversationSnapshot({ ...snapshot(7, "fresh"), snapshotVersion: "10", updatedAt: 10_000 });
  await persistent.setPersistentConversationSnapshot({ ...snapshot(7, "stale"), snapshotVersion: "9", updatedAt: 9_000 });
  const hit = await persistent.getPersistentConversationSnapshot(7);
  assert.equal(hit.messages[0].content, "fresh");
}

(async () => {
  await testSetGetRehydratesMemoryAndClones();
  await testExpiryDeletesRecord();
  await testLruPrune();
  await testDeleteAndClear();
  await testUserScopeIsolation();
  await testMissingUserDisablesPersistentCache();
  await testPersistentStaleSnapshotCannotOverwriteFreshRecord();
  persistent.configurePersistentConversationSnapshotStorageForTests(undefined);
  console.log("chat conversation persistent cache regression passed");
})();
