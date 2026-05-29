#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-conversation-restore-coordinator-regression-"));
  for (const name of ["chatForkCoordinator", "chatConversationRestoreCoordinator"]) {
    const source = fs.readFileSync(path.join(projectRoot, `lib/${name}.ts`), "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, strict: true },
      fileName: path.join(projectRoot, `lib/${name}.ts`),
    }).outputText;
    fs.writeFileSync(path.join(tmpDir, `${name}.js`), output);
  }
  return require(path.join(tmpDir, "chatConversationRestoreCoordinator.js"));
}

const {
  buildConversationRestoreUrl,
  buildConversationMessageStatusUrl,
  buildConversationMessageCountUrl,
  fetchConversationRestore,
  fetchConversationMessageStatus,
  fetchConversationMessageCount,
  mapConversationRestoreMessages,
  buildActiveTaskStreamsByServerMessageId,
  mergeActiveTaskStreamsIntoMessages,
  buildConversationRestoreState,
  findLastAssistantStatusTarget,
  buildConversationStatusDecision,
  parseConversationCompareModels,
  resolveConversationSkillKey,
} = loadModule();

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const response = (ok, data, status = ok ? 200 : 500) => ({ ok, status, json: async () => data });

(async () => {
  await test("build restore/status/count URLs", () => {
    assert.equal(buildConversationRestoreUrl({ apiBaseUrl: "http://api", conversationId: 7 }), "http://api/api/conversations/7?message_tail=50");
    assert.equal(buildConversationRestoreUrl({ conversationId: 7, tail: 10 }), "/api/conversations/7?message_tail=10");
    assert.equal(buildConversationMessageStatusUrl({ apiBaseUrl: "http://api", conversationId: 7, serverMessageId: 9 }), "http://api/api/conversations/7/messages/9");
    assert.equal(buildConversationMessageCountUrl({ apiBaseUrl: "http://api", conversationId: 7 }), "http://api/api/conversations/7/messages?limit=1");
  });

  await test("fetchConversationRestore uses bearer token and throws non-ok", async () => {
    const calls = [];
    const data = await fetchConversationRestore({
      apiBaseUrl: "http://api",
      conversationId: 3,
      token: "tok",
      fetchImpl: async (url, init) => {
        calls.push([url, init.headers.Authorization]);
        return response(true, { title: "T", messages: [] });
      },
    });
    assert.deepEqual(calls, [["http://api/api/conversations/3?message_tail=50", "Bearer tok"]]);
    assert.equal(data.title, "T");
    await assert.rejects(fetchConversationRestore({ conversationId: 3, token: "tok", fetchImpl: async () => response(false, {}, 503) }), /load conversation failed: 503/);
  });

  await test("fetch status and count helpers ignore invalid responses", async () => {
    const status = await fetchConversationMessageStatus({
      conversationId: 3,
      serverMessageId: 9,
      token: "tok",
      fetchImpl: async () => response(true, { background_task: { status: "running" } }),
    });
    assert.equal(status.background_task.status, "running");
    const missing = await fetchConversationMessageStatus({ conversationId: 3, serverMessageId: 9, token: "tok", fetchImpl: async () => response(false, {}) });
    assert.equal(missing, undefined);
    assert.equal(await fetchConversationMessageCount({ conversationId: 3, token: "tok", fetchImpl: async () => response(true, { total: 12 }) }), 12);
    assert.equal(await fetchConversationMessageCount({ conversationId: 3, token: "tok", fetchImpl: async () => response(true, { total: "12" }) }), undefined);
  });

  await test("mapConversationRestoreMessages filters empty group models and maps persisted fields", () => {
    const messages = mapConversationRestoreMessages([
      { id: 1, role: "assistant", content: "a", created_at: "t", group_models: ["m1", "", 3, "m2"], files: JSON.stringify([{ public_id: "p" }]) },
    ], { fallbackId: () => "fallback", parseTime: () => 123 });
    assert.equal(messages[0].id, "1");
    assert.equal(messages[0].createdAt, 123);
    assert.deepEqual(messages[0].groupModels, ["m1", "m2"]);
    assert.deepEqual(messages[0].files, [{ public_id: "p" }]);
  });

  await test("active stream map filters by conversation and server id", () => {
    const map = buildActiveTaskStreamsByServerMessageId([
      ["local-a", { convId: 7, serverMessageId: 11, content: "live" }],
      ["local-b", { convId: 8, serverMessageId: 12 }],
      ["local-c", { convId: 7 }],
    ], 7);
    assert.deepEqual(Array.from(map.keys()), ["11"]);
    assert.equal(map.get("11").localId, "local-a");
  });

  await test("mergeActiveTaskStreamsIntoMessages preserves active local id/content/task state", () => {
    const active = new Map([["11", { localId: "local-a", info: { serverMessageId: 11, generationTaskId: 5, lastSequence: 9, content: "live" } }]]);
    const merged = mergeActiveTaskStreamsIntoMessages([
      { id: "10", role: "user", content: "u", createdAt: 1, serverMessageId: 10 },
      { id: "11", role: "assistant", content: "old", createdAt: 2, serverMessageId: 11 },
    ], active, { kind: "generating" });
    assert.equal(merged[0].id, "10");
    assert.deepEqual(merged[1], {
      id: "local-a",
      role: "assistant",
      content: "live",
      createdAt: 2,
      serverMessageId: 11,
      generationTaskId: 5,
      lastSequence: 9,
      activityStatus: { kind: "generating" },
    });
  });

  await test("buildConversationRestoreState maps, merges, group views, loading state", () => {
    const state = buildConversationRestoreState({
      data: { messages: [
        { id: 10, role: "user", content: "u", group_id: 1 },
        { id: 11, role: "assistant", content: "old", group_id: 1 },
      ] },
      activeEntries: [["local-a", { convId: 7, serverMessageId: 11, content: "live" }]],
      conversationId: 7,
      fallbackId: () => "fallback",
      activeActivityStatus: { busy: true },
    });
    assert.equal(state.loadedMessages.length, 2);
    assert.equal(state.mergedMessages[1].id, "local-a");
    assert.deepEqual(Array.from(state.groupViews.entries()), [[1, 0]]);
    assert.equal(state.isLoading, true);
    assert.equal(buildConversationRestoreState({ data: {}, activeEntries: [], conversationId: 7, fallbackId: () => "fallback", activeActivityStatus: {} }), undefined);
  });

  await test("findLastAssistantStatusTarget skips active last assistant", () => {
    const messages = [
      { id: "1", role: "assistant", content: "a", createdAt: 1, serverMessageId: 1 },
      { id: "2", role: "assistant", content: "b", createdAt: 2, serverMessageId: 2 },
    ];
    assert.equal(findLastAssistantStatusTarget(messages, new Map()).id, "2");
    assert.equal(findLastAssistantStatusTarget(messages, new Map([["2", {}]])), undefined);
  });

  await test("buildConversationStatusDecision resumes non-terminal or empty terminal tasks", () => {
    const currentMessage = { id: "2", role: "assistant", content: "old", createdAt: 2, serverMessageId: 2, lastSequence: 1 };
    const running = buildConversationStatusDecision({
      statusData: { message: { content: "live" }, background_task: { id: 6, status: "running", last_sequence_number: 4 } },
      currentMessage,
      busyActivityStatus: { busy: true },
      now: 1000,
    });
    assert.equal(running.shouldResumePolling, true);
    assert.deepEqual(running.patch, { content: "live", generationTaskId: 6, lastSequence: 4, completedAt: undefined, activityStatus: { busy: true } });
    assert.deepEqual(running.resume, { generationTaskId: 6, lastSequence: 4, initialContent: "live" });

    const emptyCompleted = buildConversationStatusDecision({
      statusData: { message: { content: "" }, background_task: { id: 6, status: "completed" } },
      currentMessage,
      busyActivityStatus: { busy: true },
      now: 1000,
    });
    assert.equal(emptyCompleted.shouldResumePolling, true);
  });

  await test("buildConversationStatusDecision marks completed terminal task with content", () => {
    const currentMessage = { id: "2", role: "assistant", content: "old", createdAt: 2, serverMessageId: 2 };
    const done = buildConversationStatusDecision({
      statusData: { message: { content: "final" }, background_task: { task_id: 6, status: "completed", completed_at: "done-time" } },
      currentMessage,
      busyActivityStatus: { busy: true },
      parseTime: () => 1234,
      now: 999,
    });
    assert.equal(done.shouldResumePolling, false);
    assert.equal(done.patch.content, "final");
    assert.equal(done.patch.generationTaskId, 6);
    assert.equal(done.patch.completedAt, 1234);
    assert.equal(done.patch.activityStatus, undefined);
    assert.equal(done.resume, undefined);
  });

  await test("parse compare models and resolve skill key", () => {
    assert.deepEqual(parseConversationCompareModels('["a","b"]'), ["a", "b"]);
    assert.deepEqual(parseConversationCompareModels('{bad'), []);
    assert.deepEqual(parseConversationCompareModels(undefined), []);
    assert.equal(resolveConversationSkillKey("history", "url"), "history");
    assert.equal(resolveConversationSkillKey("", "url"), "url");
  });

  if (!process.exitCode) console.log("\nchat conversation restore coordinator regression tests passed");
})();
