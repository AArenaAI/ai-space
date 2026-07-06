#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "../..");
const sourceFile = path.join(repoRoot, "lib/chatConversationCache.ts");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chat-conversation-cache-"));
const tmpFile = path.join(tmpRoot, "chatConversationCache.cjs");
const source = fs.readFileSync(sourceFile, "utf8");
const transformed = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
fs.writeFileSync(tmpFile, transformed);
const cache = require(tmpFile);

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

function reset(options = {}) {
  cache.clearConversationSnapshotCache();
  cache.resetConversationSnapshotCacheConfig();
  if (Object.keys(options).length > 0) cache.configureConversationSnapshotCache(options);
}

function testDefaultConfig() {
  reset();
  const config = cache.getConversationSnapshotCacheConfig();
  assert.equal(config.maxEntries, 50);
  assert.equal(config.ttlMs, 60 * 60 * 1000);
}

function testHitReturnsClone() {
  reset();
  cache.setConversationSnapshot(snapshot(1, "hello"));
  const first = cache.getConversationSnapshot(1);
  assert.equal(first.messages[0].content, "hello");
  first.messages[0].content = "mutated";
  first.groupViews.set(99, 1);
  const second = cache.getConversationSnapshot(1);
  assert.equal(second.messages[0].content, "hello");
  assert.equal(second.groupViews.has(99), false);
}

function testInvalidateAndClear() {
  reset();
  cache.setConversationSnapshot(snapshot(1));
  cache.setConversationSnapshot(snapshot(2));
  cache.invalidateConversationSnapshot(1);
  assert.equal(cache.getConversationSnapshot(1), undefined);
  assert.equal(cache.getConversationSnapshot(2).conversationId, 2);
  cache.clearConversationSnapshotCache();
  assert.equal(cache.getConversationSnapshotCacheSize(), 0);
}

async function testTtlExpiry() {
  reset({ ttlMs: 5 });
  cache.setConversationSnapshot(snapshot(2));
  await new Promise((resolve) => setTimeout(resolve, 8));
  assert.equal(cache.getConversationSnapshot(2), undefined);
}

async function testSlidingTtlTouchesUpdatedAt() {
  reset({ ttlMs: 20 });
  cache.setConversationSnapshot(snapshot(1));
  await new Promise((resolve) => setTimeout(resolve, 12));
  const hit = cache.getConversationSnapshot(1);
  assert.equal(hit.conversationId, 1);
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert.equal(cache.hasConversationSnapshot(1), true);
  await new Promise((resolve) => setTimeout(resolve, 24));
  assert.equal(cache.hasConversationSnapshot(1), false);
}

function testLruEvictionAndTouch() {
  reset({ maxEntries: 2, ttlMs: 60_000 });
  cache.setConversationSnapshot(snapshot(1));
  cache.setConversationSnapshot(snapshot(2));
  assert.equal(cache.getConversationSnapshot(1).conversationId, 1); // touch 1, so 2 is oldest
  cache.setConversationSnapshot(snapshot(3));
  assert.equal(cache.getConversationSnapshot(2), undefined);
  assert.equal(cache.getConversationSnapshot(1).conversationId, 1);
  assert.equal(cache.getConversationSnapshot(3).conversationId, 3);
}

function testPatchAndEquivalence() {
  reset();
  const base = snapshot(1, "same");
  cache.setConversationSnapshot(base);
  cache.patchConversationSnapshot(1, { totalMessages: 10, title: "patched" });
  const patched = cache.getConversationSnapshot(1);
  assert.equal(patched.totalMessages, 10);
  assert.equal(patched.title, "patched");
  assert.equal(cache.areConversationMessagesEquivalent(base.messages, patched.messages), true);
  assert.equal(
    cache.areConversationMessagesEquivalent(base.messages, [{ ...base.messages[0], content: "different" }]),
    false
  );
}

function testStaleSnapshotCannotOverwriteNewerCacheEntry() {
  reset();
  cache.setConversationSnapshot({ ...snapshot(7, "fresh"), snapshotVersion: "10", updatedAt: 10_000 });
  cache.setConversationSnapshot({ ...snapshot(7, "stale"), snapshotVersion: "9", updatedAt: 9_000 });
  assert.equal(cache.getConversationSnapshot(7).messages[0].content, "fresh");
}

function testStalePatchCannotOverwriteNewerCacheEntry() {
  reset();
  cache.setConversationSnapshot({ ...snapshot(8, "fresh"), snapshotVersion: "10", updatedAt: 10_000 });
  cache.patchConversationSnapshot(8, { messages: snapshot(8, "stale").messages, snapshotVersion: "9", updatedAt: 9_000 });
  assert.equal(cache.getConversationSnapshot(8).messages[0].content, "fresh");
}

(async () => {
  testDefaultConfig();
  testHitReturnsClone();
  testInvalidateAndClear();
  await testTtlExpiry();
  await testSlidingTtlTouchesUpdatedAt();
  testLruEvictionAndTouch();
  testPatchAndEquivalence();
  testStaleSnapshotCannotOverwriteNewerCacheEntry();
  testStalePatchCannotOverwriteNewerCacheEntry();
  reset();
  console.log("chat conversation cache regression passed");
})();
