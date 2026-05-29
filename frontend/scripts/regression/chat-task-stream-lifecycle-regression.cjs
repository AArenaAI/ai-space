#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const sourcePaths = [
  path.join(projectRoot, "lib/chatSseParser.ts"),
  path.join(projectRoot, "lib/chatSseStreamRunner.ts"),
  path.join(projectRoot, "lib/chatTaskStreamLifecycle.ts"),
];

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-task-stream-lifecycle-regression-"));
  for (const sourcePath of sourcePaths) {
    const source = fs.readFileSync(sourcePath, "utf8");
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        strict: true,
      },
      fileName: sourcePath,
    }).outputText;
    fs.writeFileSync(path.join(tmpDir, path.basename(sourcePath).replace(/\.ts$/, ".js")), transpiled);
  }
  return require(path.join(tmpDir, "chatTaskStreamLifecycle.js"));
}

const mod = loadModule();

function makeResponse({ ok = true, body = true, reader } = {}) {
  return {
    ok,
    body: body ? { getReader: () => reader } : null,
  };
}

function makeReader() {
  return {
    released: false,
    async read() {
      return { done: true, value: undefined };
    },
    releaseLock() {
      this.released = true;
    },
  };
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

(async () => {
  await test("buildTaskStreamUrl prefers generation task stream", async () => {
    assert.equal(
      mod.buildTaskStreamUrl({ apiBaseUrl: "", serverMessageId: 10, generationTaskId: 20, after: 7 }),
      "/api/tasks/20/stream?after=7"
    );
  });

  await test("buildTaskStreamUrl falls back to server message event stream", async () => {
    assert.equal(
      mod.buildTaskStreamUrl({ apiBaseUrl: "/base", serverMessageId: 10, after: 3 }),
      "/base/api/chat/tasks/10/events?after=3"
    );
  });

  await test("buildTaskStreamUrl throws when ids are missing", async () => {
    assert.throws(() => mod.buildTaskStreamUrl({}), /missing task stream id/);
  });

  await test("runTaskEventStream fetches URL and forwards events", async () => {
    const reader = makeReader();
    const calls = [];
    const events = [];
    const result = await mod.runTaskEventStream({
      serverMessageId: 5,
      after: 2,
      headers: { Authorization: "Bearer token" },
      signal: new AbortController().signal,
      onEvent: (eventText) => events.push(eventText),
      fetchImpl: async (input, init) => {
        calls.push({ input, init });
        return makeResponse({ reader });
      },
      streamRunner: async ({ onEvent }) => {
        onEvent("data: ok");
        return { remaining: "", eventCount: 1 };
      },
    });
    assert.equal(calls[0].input, "/api/chat/tasks/5/events?after=2");
    assert.deepEqual(calls[0].init.headers, { Authorization: "Bearer token" });
    assert.deepEqual(events, ["data: ok"]);
    assert.deepEqual(result, { remaining: "", eventCount: 1 });
    assert.equal(reader.released, true);
  });

  await test("runTaskEventStream releases reader when stream runner throws", async () => {
    const reader = makeReader();
    await assert.rejects(
      () => mod.runTaskEventStream({
        generationTaskId: 9,
        headers: {},
        signal: new AbortController().signal,
        onEvent: () => {},
        fetchImpl: async () => makeResponse({ reader }),
        streamRunner: async () => {
          throw new Error("stream failed");
        },
      }),
      /stream failed/
    );
    assert.equal(reader.released, true);
  });

  await test("runTaskEventStream rejects unavailable response", async () => {
    await assert.rejects(
      () => mod.runTaskEventStream({
        serverMessageId: 5,
        headers: {},
        signal: new AbortController().signal,
        onEvent: () => {},
        fetchImpl: async () => makeResponse({ ok: false, body: true, reader: makeReader() }),
      }),
      /task stream unavailable/
    );
  });

  await test("shouldFallbackToBackgroundPollingAfterTaskStreamError skips aborted streams", async () => {
    assert.equal(mod.shouldFallbackToBackgroundPollingAfterTaskStreamError({ aborted: false }), true);
    assert.equal(mod.shouldFallbackToBackgroundPollingAfterTaskStreamError({ aborted: true }), false);
  });

  console.log("\nchat task stream lifecycle regression tests passed");
})().catch(() => process.exit(1));
