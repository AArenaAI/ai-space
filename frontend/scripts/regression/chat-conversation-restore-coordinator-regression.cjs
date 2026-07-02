#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-conversation-restore-coordinator-regression-"));
  for (const name of ["chatForkCoordinator", "chatBootstrapCoordinator", "chatConversationRestoreCoordinator"]) {
    let source = fs.readFileSync(path.join(projectRoot, `lib/${name}.ts`), "utf8");
    source = source.replace(
      /import \{ normalizeError, readApiError \} from "@\/lib\/errors";\n/g,
      "const normalizeError = (error, options = {}) => error instanceof Error ? error : new Error(options.fallbackMessage || String(error));\nconst readApiError = async (response, fallback) => { try { const data = await response.json(); return data && (data.error || data.message) || fallback; } catch { return fallback; } };\n"
    );
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, strict: true },
      fileName: path.join(projectRoot, `lib/${name}.ts`),
    }).outputText;
    fs.writeFileSync(path.join(tmpDir, `${name}.js`), output);
  }
  const restorePath = path.join(tmpDir, "chatConversationRestoreCoordinator.js");
  const bootstrapPath = path.join(tmpDir, "chatBootstrapCoordinator.js");
  const forkPath = path.join(tmpDir, "chatForkCoordinator.js");
  const Module = require("module");
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === "@/lib/chatBootstrapCoordinator") return originalLoad(bootstrapPath, parent, isMain);
    if (request === "./chatForkCoordinator") return originalLoad(forkPath, parent, isMain);
    if (request.startsWith("@/")) return {};
    return originalLoad(request, parent, isMain);
  };
  try {
    return require(restorePath);
  } finally {
    Module._load = originalLoad;
  }
}

const {
  DEFAULT_CONVERSATION_RESTORE_TAIL,
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

const response = (ok, data, status = ok ? 200 : 500, headers = {}) => ({
  ok,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] || headers[name] || null },
  json: async () => data,
});

(async () => {
  await test("build restore/status/count URLs", () => {
    assert.equal(DEFAULT_CONVERSATION_RESTORE_TAIL, 32);
    assert.equal(buildConversationRestoreUrl({ apiBaseUrl: "http://api", conversationId: 7 }), "http://api/api/conversations/7?message_tail=32");
    assert.equal(buildConversationRestoreUrl({ conversationId: 7, tail: 10 }), "/api/conversations/7?message_tail=10");
    assert.equal(buildConversationMessageStatusUrl({ apiBaseUrl: "http://api", conversationId: 7, serverMessageId: 9 }), "http://api/api/conversations/7/messages/9");
    assert.equal(buildConversationMessageCountUrl({ apiBaseUrl: "http://api", conversationId: 7 }), "http://api/api/conversations/7/messages?limit=1");
  });

  await test("fetchConversationRestore uses bootstrap payload by default", async () => {
    const calls = [];
    const data = await fetchConversationRestore({
      apiBaseUrl: "http://api",
      conversationId: 3,
      token: "tok",
      fetchImpl: async (url, init) => {
        calls.push([url, init.headers.Authorization]);
        return response(true, {
          conversation: { id: 3, title: "Boot", model: "m2", compare: true, compare_models: ["m1", "m2"], skill_key: "s" },
          snapshot: { total: 2, has_more: false, snapshot_version: "v1", messages: [{ id: 31, role: "user", content: "u" }] },
        });
      },
    });
    assert.deepEqual(calls, [["http://api/api/chat/bootstrap?id=3&message_tail=32&conversation_limit=30", "Bearer tok"]]);
    assert.equal(data.title, "Boot");
    assert.equal(data.model, "m2");
    assert.equal(data.compare, true);
    assert.equal(data.compare_models, '["m1","m2"]');
    assert.equal(data.skill_key, "s");
    assert.equal(data.total, 2);
    assert.equal(data.snapshot_version, "v1");
    assert.equal(data.messages.length, 1);
    await assert.rejects(fetchConversationRestore({ conversationId: 3, token: "tok", fetchImpl: async () => response(false, {}, 503) }), /chat bootstrap failed: 503/);
  });

  await test("fetchConversationRestore retries 429 bootstrap responses", async () => {
    let calls = 0;
    const sleeps = [];
    const data = await fetchConversationRestore({
      apiBaseUrl: "http://api",
      conversationId: 4,
      token: "tok",
      sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); },
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return response(false, { error: "too many" }, 429, { "retry-after": "0.05" });
        return response(true, {
          conversation: { id: 4, title: "Retried", model: "m1", compare: false },
          snapshot: { total: 0, messages: [] },
        });
      },
    });
    assert.equal(calls, 2);
    assert.ok(sleeps[0] >= 50, `expected retry sleep >=50ms, got ${sleeps[0]}`);
    assert.equal(data.title, "Retried");
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

  await test("buildConversationRestoreState synthesizes pending assistant from running status", () => {
    const state = buildConversationRestoreState({
      data: {
        model: "deepseek-v4-pro",
        messages: [{ id: 20, role: "user", content: "u" }],
        last_assistant_status: {
          message: { id: 21, content: "", model: "deepseek-v4-pro" },
          background_task: { id: 99, assistant_message_id: 21, status: "running", last_sequence_number: 3 },
        },
      },
      activeEntries: [],
      conversationId: 7,
      fallbackId: () => "pending-id",
      activeActivityStatus: { kind: "generating" },
    });
    assert.equal(state.isLoading, true);
    assert.equal(state.mergedMessages.length, 2);
    assert.equal(state.mergedMessages[1].id, "pending-id");
    assert.equal(state.mergedMessages[1].serverMessageId, 21);
    assert.equal(state.mergedMessages[1].generationTaskId, 99);
    assert.equal(state.mergedMessages[1].activityStatus.kind, "generating");
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
    assert.deepEqual(running.patch, { content: "live", generationTaskId: 6, lastSequence: 4, completedAt: undefined, activityStatus: { busy: true }, serverGenerationStatus: "running", statusTimeline: undefined });
    assert.deepEqual(running.resume, { generationTaskId: 6, lastSequence: 4, initialContent: "live" });

    const emptyRunning = buildConversationStatusDecision({
      statusData: { message: { content: "" }, background_task: { id: 6, status: "running", last_sequence_number: 8 } },
      currentMessage: { ...currentMessage, content: "", lastSequence: undefined },
      busyActivityStatus: { busy: true },
      now: 1000,
    });
    assert.equal(emptyRunning.shouldResumePolling, true);
    assert.deepEqual(emptyRunning.patch, { content: "", generationTaskId: 6, lastSequence: 8, completedAt: undefined, activityStatus: { busy: true }, serverGenerationStatus: "running", statusTimeline: undefined });
    assert.deepEqual(emptyRunning.resume, { generationTaskId: 6, lastSequence: 0, initialContent: "" });

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
