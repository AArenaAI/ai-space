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
  path.join(projectRoot, "lib/chatErrorRecovery.ts"),
  path.join(projectRoot, "lib/chatStreamLifecycle.ts"),
];

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-stream-lifecycle-regression-"));
  for (const sourcePath of sourcePaths) {
    let source = fs.readFileSync(sourcePath, "utf8");
    source = source.replace(
      /import \{ normalizeError \} from "@\/lib\/errors";\n/g,
      "const normalizeError = (error) => error instanceof Error ? error : new Error(String(error));\n"
    );
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
  return require(path.join(tmpDir, "chatStreamLifecycle.js"));
}

const mod = loadModule();

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

function makeResponse(reader) {
  return { body: reader ? { getReader: () => reader } : null };
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
  await test("decideChatStreamError ignores user aborts but resumes navigation with ids", async () => {
    assert.deepEqual(mod.decideChatStreamError({
      error: Object.assign(new Error("abort"), { name: "AbortError" }),
      abortReason: "user",
      serverMessageId: 1,
    }), { action: "ignore" });
    assert.deepEqual(mod.decideChatStreamError({
      error: new Error("anything"),
      signalAborted: true,
      abortReason: "navigation",
      generationTaskId: 2,
    }), { action: "resume" });
  });

  await test("decideChatStreamError resumes when recoverable ids exist", async () => {
    assert.deepEqual(mod.decideChatStreamError({
      error: new Error("network"),
      abortReason: undefined,
      serverMessageId: 1,
    }), { action: "resume" });
    assert.deepEqual(mod.decideChatStreamError({
      error: new Error("network"),
      abortReason: "network",
      generationTaskId: 2,
    }), { action: "resume" });
  });

  await test("decideChatStreamError rethrows unrecoverable errors", async () => {
    const error = new Error("fatal");
    assert.deepEqual(mod.decideChatStreamError({
      error,
      abortReason: undefined,
    }), { action: "throw", error });
  });

  await test("runChatStreamLifecycle returns completed and releases reader", async () => {
    const reader = makeReader();
    const events = [];
    const result = await mod.runChatStreamLifecycle({
      response: makeResponse(reader),
      signal: { aborted: false },
      getAbortReason: () => undefined,
      getRecoveryIds: () => ({}),
      onEvent: (eventText) => events.push(eventText),
      streamRunner: async ({ onEvent }) => {
        onEvent("data: ok");
        return { remaining: "", eventCount: 1 };
      },
    });
    assert.deepEqual(events, ["data: ok"]);
    assert.deepEqual(result, { action: "completed", streamResult: { remaining: "", eventCount: 1 } });
    assert.equal(reader.released, true);
  });

  await test("runChatStreamLifecycle returns ignored for user abort", async () => {
    const reader = makeReader();
    const result = await mod.runChatStreamLifecycle({
      response: makeResponse(reader),
      signal: { aborted: true },
      getAbortReason: () => "user",
      getRecoveryIds: () => ({ serverMessageId: 1 }),
      onEvent: () => {},
      streamRunner: async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      },
    });
    assert.deepEqual(result, { action: "ignored" });
    assert.equal(reader.released, true);
  });

  await test("runChatStreamLifecycle returns resume for recoverable error", async () => {
    const reader = makeReader();
    const result = await mod.runChatStreamLifecycle({
      response: makeResponse(reader),
      signal: { aborted: false },
      getAbortReason: () => undefined,
      getRecoveryIds: () => ({ generationTaskId: 9 }),
      onEvent: () => {},
      streamRunner: async () => {
        throw new Error("network");
      },
    });
    assert.deepEqual(result, { action: "resume" });
    assert.equal(reader.released, true);
  });

  await test("runChatStreamLifecycle rejects missing body and fatal errors", async () => {
    await assert.rejects(() => mod.runChatStreamLifecycle({
      response: makeResponse(null),
      signal: { aborted: false },
      getAbortReason: () => undefined,
      getRecoveryIds: () => ({}),
      onEvent: () => {},
    }), /无法读取流/);

    const reader = makeReader();
    await assert.rejects(() => mod.runChatStreamLifecycle({
      response: makeResponse(reader),
      signal: { aborted: false },
      getAbortReason: () => undefined,
      getRecoveryIds: () => ({}),
      onEvent: () => {},
      streamRunner: async () => {
        throw new Error("fatal");
      },
    }), /fatal/);
    assert.equal(reader.released, true);
  });

  console.log("\nchat stream lifecycle regression tests passed");
})().catch(() => process.exit(1));
