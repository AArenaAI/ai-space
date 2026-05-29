#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");

function transpileModule(sourceFile, tmpDir) {
  const source = fs.readFileSync(path.join(projectRoot, sourceFile), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      strict: true,
    },
    fileName: path.join(projectRoot, sourceFile),
  }).outputText;
  const outPath = path.join(tmpDir, sourceFile.replace(/^lib\//, "").replace(/\.ts$/, ".js"));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output);
}

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-stream-event-processor-regression-"));
  transpileModule("lib/chatSseParser.ts", tmpDir);
  transpileModule("lib/chatStreamMeta.ts", tmpDir);
  transpileModule("lib/chatStreamEventProcessor.ts", tmpDir);
  return require(path.join(tmpDir, "chatStreamEventProcessor.js"));
}

const mod = loadModule();

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

test("resolveSseEventSequence parses numeric ids and preserves previous on invalid ids", () => {
  assert.equal(mod.resolveSseEventSequence("12", 3), 12);
  assert.equal(mod.resolveSseEventSequence("bad", 3), 3);
  assert.equal(mod.resolveSseEventSequence(undefined, 3), 3);
});

test("processChatStreamEvent returns empty for events without data", () => {
  assert.deepEqual(mod.processChatStreamEvent({ eventText: "id: 9\nevent: ping\n\n", previousSequence: 2 }), {
    type: "empty",
    sequence: 9,
  });
});

test("processChatStreamEvent detects done marker", () => {
  assert.deepEqual(mod.processChatStreamEvent({ eventText: "id: 4\ndata: [DONE]\n\n", previousSequence: 1 }), {
    type: "done",
    sequence: 4,
  });
});

test("processChatStreamEvent parses chat meta payload", () => {
  const result = mod.processChatStreamEvent({
    eventText: 'id: 5\ndata: {"_chat_meta":{"request_id":"req_1"}}\n\n',
    previousSequence: 1,
  });
  assert.equal(result.type, "payload");
  assert.equal(result.sequence, 5);
  assert.deepEqual(result.payload, { type: "chat_meta", meta: { request_id: "req_1" }, requestId: "req_1" });
});

test("processChatStreamEvent normalizes generation task payload", () => {
  const result = mod.processChatStreamEvent({
    eventText: 'data: {"_generation_task":{"id":42,"assistant_message_id":7}}\n\n',
    previousSequence: 6,
  });
  assert.equal(result.type, "payload");
  assert.equal(result.sequence, 6);
  assert.deepEqual(result.payload, { type: "generation_task", task: { id: 42, assistant_message_id: 7 } });
});

test("processChatStreamEvent falls back to delta payload for choices", () => {
  const result = mod.processChatStreamEvent({
    eventText: 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
  });
  assert.deepEqual(result, {
    type: "payload",
    sequence: undefined,
    payload: { type: "delta", rawDelta: { content: "hi" } },
  });
});

test("processChatStreamEvent returns text for invalid JSON", () => {
  assert.deepEqual(mod.processChatStreamEvent({ eventText: "id: 8\ndata: plain text\n\n", previousSequence: 3 }), {
    type: "text",
    sequence: 8,
    data: "plain text",
  });
});

console.log("\nchat stream event processor regression tests passed");
