#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-load-more-coordinator-regression-"));
  const modules = ["chatForkCoordinator", "chatLoadMoreCoordinator"];
  for (const name of modules) {
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
  return require(path.join(tmpDir, "chatLoadMoreCoordinator.js"));
}

const {
  shouldStartLoadMore,
  buildLoadMorePage,
  buildLoadMoreMessagesUrl,
  fetchLoadMoreMessages,
  mapLoadMoreMessages,
  prependUniqueOlderMessages,
  resolveLoadedPersistedMessages,
  resolveTotalMessages,
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
  await test("shouldStartLoadMore requires conversation, token, idle and has-more", () => {
    assert.equal(shouldStartLoadMore({ currentConversation: 1, isLoadingMore: false, hasMoreMessages: true, token: "t" }), true);
    assert.equal(shouldStartLoadMore({ currentConversation: undefined, isLoadingMore: false, hasMoreMessages: true, token: "t" }), false);
    assert.equal(shouldStartLoadMore({ currentConversation: 1, isLoadingMore: true, hasMoreMessages: true, token: "t" }), false);
    assert.equal(shouldStartLoadMore({ currentConversation: 1, isLoadingMore: false, hasMoreMessages: false, token: "t" }), false);
    assert.equal(shouldStartLoadMore({ currentConversation: 1, isLoadingMore: false, hasMoreMessages: true, token: null }), false);
  });

  await test("buildLoadMorePage preserves legacy offset and expected count math", () => {
    assert.deepEqual(buildLoadMorePage({ totalMessages: 120, loadedPersistedMessages: 50 }), {
      limit: 50,
      offset: 20,
      expectedOlderCount: 50,
      requestLimit: 50,
    });
    assert.deepEqual(buildLoadMorePage({ totalMessages: 40, loadedPersistedMessages: 10 }), {
      limit: 50,
      offset: 0,
      expectedOlderCount: 30,
      requestLimit: 30,
    });
    assert.deepEqual(buildLoadMorePage({ totalMessages: 10, loadedPersistedMessages: 10 }), {
      limit: 50,
      offset: 0,
      expectedOlderCount: 0,
      requestLimit: 50,
    });
  });

  await test("buildLoadMoreMessagesUrl formats paginated conversation URL", () => {
    assert.equal(
      buildLoadMoreMessagesUrl({ apiBaseUrl: "http://api", conversationId: 9, page: { requestLimit: 30, offset: 0 } }),
      "http://api/api/conversations/9/messages?limit=30&offset=0"
    );
  });

  await test("fetchLoadMoreMessages fetches page with bearer token and ignores non-ok", async () => {
    const calls = [];
    const data = await fetchLoadMoreMessages({
      apiBaseUrl: "http://api",
      conversationId: 7,
      token: "token",
      page: { requestLimit: 25, offset: 5 },
      fetchImpl: async (url, init) => {
        calls.push([url, init.headers.Authorization]);
        return response(true, { messages: [{ id: 1, role: "user", content: "hi" }], total: 8 });
      },
    });
    assert.deepEqual(calls, [["http://api/api/conversations/7/messages?limit=25&offset=5", "Bearer token"]]);
    assert.equal(data.total, 8);

    const missing = await fetchLoadMoreMessages({
      conversationId: 7,
      token: "token",
      page: { requestLimit: 25, offset: 5 },
      fetchImpl: async () => response(false, {}),
    });
    assert.equal(missing, undefined);
  });

  await test("mapLoadMoreMessages reuses persisted message mapping", () => {
    const messages = mapLoadMoreMessages({
      messages: [
        {
          id: 3,
          role: "assistant",
          content: "old",
          created_at: "2026-01-01T00:00:00Z",
          search_sources_count: 1,
          group_id: 4,
        },
      ],
      total: 10,
    }, {
      fallbackId: () => "fallback",
      parseTime: () => 123,
    });
    assert.equal(messages[0].id, "3");
    assert.equal(messages[0].createdAt, 123);
    assert.equal(messages[0].searchStatus, "completed");
    assert.equal(messages[0].groupId, 4);
    assert.deepEqual(mapLoadMoreMessages(undefined, { fallbackId: () => "fallback" }), []);
  });

  await test("prependUniqueOlderMessages prepends only older messages with new server ids", () => {
    const current = [
      { id: "2", serverMessageId: 2 },
      { id: "3", serverMessageId: 3 },
    ];
    const older = [
      { id: "1", serverMessageId: 1 },
      { id: "dup", serverMessageId: 2 },
      { id: "local" },
      { id: "also-1", serverMessageId: 1 },
    ];
    assert.deepEqual(prependUniqueOlderMessages(current, older).map((m) => m.id), ["1", "2", "3"]);
  });

  await test("resolveLoadedPersistedMessages clamps by response or fallback total", () => {
    assert.equal(resolveLoadedPersistedMessages({ previousLoaded: 50, olderMessagesCount: 50, responseTotal: 80, fallbackTotal: 120 }), 80);
    assert.equal(resolveLoadedPersistedMessages({ previousLoaded: 50, olderMessagesCount: 10, fallbackTotal: 120 }), 60);
    assert.equal(resolveLoadedPersistedMessages({ previousLoaded: 115, olderMessagesCount: 10, fallbackTotal: 120 }), 120);
  });

  await test("resolveTotalMessages prefers numeric response total", () => {
    assert.equal(resolveTotalMessages(80, 120), 80);
    assert.equal(resolveTotalMessages(undefined, 120), 120);
    assert.equal(resolveTotalMessages("80", 120), 120);
  });

  if (!process.exitCode) console.log("\nchat load more coordinator regression tests passed");
})();
