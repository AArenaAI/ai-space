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
];

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-sse-stream-runner-regression-"));
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
  return require(path.join(tmpDir, "chatSseStreamRunner.js"));
}

function makeReader(chunks, options = {}) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    async read() {
      if (options.throwAt === index) {
        const err = new Error("boom");
        err.name = options.throwName || "Error";
        throw err;
      }
      if (index >= chunks.length) return { done: true, value: undefined };
      const chunk = chunks[index++];
      return { done: false, value: typeof chunk === "string" ? encoder.encode(chunk) : chunk };
    },
  };
}

const mod = loadModule();

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
  await test("runSseStream dispatches complete events across chunks", async () => {
    const events = [];
    const result = await mod.runSseStream({
      reader: makeReader(["data: a\n", "\ndata: b\n\n"]),
      onEvent: (eventText) => events.push(eventText),
    });
    assert.deepEqual(events, ["data: a", "data: b"]);
    assert.deepEqual(result, { remaining: "", eventCount: 2 });
  });

  await test("runSseStream flushes decoder and trailing non-empty buffer", async () => {
    const events = [];
    const result = await mod.runSseStream({
      reader: makeReader(["data: tail"]),
      onEvent: (eventText) => events.push(eventText),
    });
    assert.deepEqual(events, ["data: tail"]);
    assert.deepEqual(result, { remaining: "", eventCount: 1 });
  });

  await test("runSseStream preserves initial buffer", async () => {
    const events = [];
    const result = await mod.runSseStream({
      reader: makeReader(["llo\n\n"]),
      initialBuffer: "data: he",
      onEvent: (eventText) => events.push(eventText),
    });
    assert.deepEqual(events, ["data: hello"]);
    assert.equal(result.eventCount, 1);
  });

  await test("runSseStream ignores whitespace-only trailing buffer", async () => {
    const events = [];
    const result = await mod.runSseStream({
      reader: makeReader(["data: a\n\n   "]),
      onEvent: (eventText) => events.push(eventText),
    });
    assert.deepEqual(events, ["data: a"]);
    assert.deepEqual(result, { remaining: "   ", eventCount: 1 });
  });

  await test("runSseStream propagates reader errors", async () => {
    const events = [];
    await assert.rejects(
      () => mod.runSseStream({
        reader: makeReader(["data: a\n\n", "data: b"], { throwAt: 1 }),
        onEvent: (eventText) => events.push(eventText),
      }),
      /boom/
    );
    assert.deepEqual(events, ["data: a"]);
  });

  console.log("\nchat SSE stream runner regression tests passed");
})().catch(() => process.exit(1));
