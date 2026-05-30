#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-fork-coordinator-regression-"));
  const source = fs.readFileSync(path.join(projectRoot, "lib/chatForkCoordinator.ts"), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, strict: true },
    fileName: path.join(projectRoot, "lib/chatForkCoordinator.ts"),
  }).outputText;
  const outPath = path.join(tmpDir, "chatForkCoordinator.js");
  fs.writeFileSync(outPath, output);
  return require(outPath);
}

const {
  parsePersistedMessageFiles,
  parsePersistedMessageSearchSources,
  mapPersistedChatMessage,
  mapPersistedChatMessages,
  buildGroupViewsFromMessages,
  resolveForkedModels,
  resolveForkConversationId,
  runForkChatRequest,
  fetchForkConversationRefresh,
  buildForkRefreshState,
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

function response(ok, data) {
  return { ok, json: async () => data };
}

(async () => {
  await test("parsePersistedMessageFiles accepts arrays and JSON arrays", () => {
    const arr = [{ public_id: "p1" }];
    assert.equal(parsePersistedMessageFiles(arr), arr);
    assert.deepEqual(parsePersistedMessageFiles(JSON.stringify(arr)), arr);
    assert.equal(parsePersistedMessageFiles("not json"), undefined);
    assert.equal(parsePersistedMessageFiles(JSON.stringify({ public_id: "p1" })), undefined);
  });

  await test("parsePersistedMessageSearchSources accepts snake or camel sources", () => {
    const sources = [{ title: "A" }];
    assert.equal(parsePersistedMessageSearchSources({ search_sources: sources }), sources);
    assert.deepEqual(parsePersistedMessageSearchSources({ searchSources: JSON.stringify(sources) }), sources);
    assert.equal(parsePersistedMessageSearchSources({}), undefined);
  });

  await test("mapPersistedChatMessage preserves persisted metadata", () => {
    const message = mapPersistedChatMessage({
      id: 42,
      role: "assistant",
      content: "hello",
      model: "m1",
      created_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T00:00:01Z",
      files: JSON.stringify([{ public_id: "file" }]),
      search_sources: JSON.stringify([{ title: "src" }]),
      search_sources_count: 1,
      group_id: 7,
      group_index: 2,
      group_models: ["a", "b"],
    }, {
      fallbackId: () => "fallback",
      parseTime: (value) => value.endsWith("01Z") ? 1000 : 0,
    });
    assert.deepEqual(message, {
      id: "42",
      role: "assistant",
      content: "hello",
      model: "m1",
      createdAt: 0,
      completedAt: 1000,
      files: [{ public_id: "file" }],
      searchSources: [{ title: "src" }],
      searchSourcesCount: 1,
      searchStatus: "completed",
      serverMessageId: 42,
      groupId: 7,
      groupIndex: 2,
      groupModels: ["a", "b"],
    });
  });

  await test("mapPersistedChatMessage folds persisted reasoning into legacy think content", () => {
    const message = mapPersistedChatMessage({
      id: 43,
      role: "assistant",
      content: "OK 42",
      reasoning_content: "简短思考",
    }, {
      fallbackId: () => "fallback",
    });
    assert.equal(message.content, "<think>简短思考</think>\n\nOK 42");

    const legacy = mapPersistedChatMessage({
      id: 44,
      role: "assistant",
      content: "<think>已有</think>\n\nOK",
      reasoning_content: "不要重复",
    }, {
      fallbackId: () => "fallback",
    });
    assert.equal(legacy.content, "<think>已有</think>\n\nOK");
  });

  await test("mapPersistedChatMessage uses fallback id and defaults optional fields", () => {
    const message = mapPersistedChatMessage({
      role: "user",
      content: "hi",
    }, {
      fallbackId: () => "fallback-id",
      parseTime: () => 123,
    });
    assert.equal(message.id, "fallback-id");
    assert.equal(message.createdAt, 0);
    assert.equal(message.serverMessageId, undefined);
    assert.equal(message.searchStatus, undefined);
  });

  await test("mapPersistedChatMessages maps all messages", () => {
    const messages = mapPersistedChatMessages([
      { id: 1, role: "user", content: "u" },
      { id: 2, role: "assistant", content: "a" },
    ], { fallbackId: () => "fallback" });
    assert.deepEqual(messages.map((m) => m.id), ["1", "2"]);
  });

  await test("buildGroupViewsFromMessages initializes each group once", () => {
    const groupViews = buildGroupViewsFromMessages([
      { groupId: 7 },
      { groupId: 7 },
      { groupId: 8 },
      {},
    ]);
    assert.deepEqual(Array.from(groupViews.entries()), [[7, 0], [8, 0]]);
  });

  await test("resolve fork models and conversation id", () => {
    assert.deepEqual(resolveForkedModels({ models: ["x"] }, ["a"]), ["x"]);
    assert.deepEqual(resolveForkedModels({}, ["a"]), ["a"]);
    assert.equal(resolveForkConversationId({ conversation_id: 3 }, 9), 3);
    assert.equal(resolveForkConversationId({}, 9), 9);
  });

  await test("runForkChatRequest posts model ids and returns data", async () => {
    const calls = [];
    const data = await runForkChatRequest({
      apiBaseUrl: "http://api",
      messageId: 55,
      modelIds: ["a", "b"],
      headers: { Authorization: "Bearer token" },
      fetchImpl: async (url, init) => {
        calls.push([url, init.method, init.headers.Authorization, JSON.parse(init.body).models]);
        return response(true, { conversation_id: 12, models: ["a", "b"] });
      },
    });
    assert.deepEqual(calls, [["http://api/api/chat/55/fork", "POST", "Bearer token", ["a", "b"]]]);
    assert.deepEqual(data, { conversation_id: 12, models: ["a", "b"] });
  });

  await test("runForkChatRequest throws normalized fork error", async () => {
    await assert.rejects(
      runForkChatRequest({
        messageId: 1,
        modelIds: [],
        headers: {},
        fetchImpl: async () => response(false, { error: "bad fork" }),
      }),
      /bad fork/
    );
    await assert.rejects(
      runForkChatRequest({
        messageId: 1,
        modelIds: [],
        headers: {},
        fetchImpl: async () => ({ ok: false, json: async () => { throw new Error("bad json"); } }),
      }),
      /Fork 对比失败/
    );
  });

  await test("fetchForkConversationRefresh returns undefined for non-ok", async () => {
    const calls = [];
    const ok = await fetchForkConversationRefresh({
      apiBaseUrl: "http://api",
      conversationId: 9,
      token: "token",
      fetchImpl: async (url, init) => {
        calls.push([url, init.headers.Authorization]);
        return response(true, { messages: [] });
      },
    });
    assert.deepEqual(calls, [["http://api/api/conversations/9", "Bearer token"]]);
    assert.deepEqual(ok, { messages: [] });

    const missing = await fetchForkConversationRefresh({
      conversationId: 9,
      token: "token",
      fetchImpl: async () => response(false, {}),
    });
    assert.equal(missing, undefined);
  });

  await test("buildForkRefreshState maps messages and group views", () => {
    const state = buildForkRefreshState({
      messages: [
        { id: 1, role: "user", content: "u", group_id: 10 },
        { id: 2, role: "assistant", content: "a", group_id: 10 },
        { id: 3, role: "assistant", content: "b", group_id: 11 },
      ],
    }, { fallbackId: () => "fallback" });
    assert.deepEqual(state.messages.map((m) => m.id), ["1", "2", "3"]);
    assert.deepEqual(Array.from(state.groupViews.entries()), [[10, 0], [11, 0]]);
    assert.equal(buildForkRefreshState(undefined, { fallbackId: () => "fallback" }), undefined);
  });

  if (!process.exitCode) console.log("\nchat fork coordinator regression tests passed");
})();
