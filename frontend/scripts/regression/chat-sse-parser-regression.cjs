#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(projectRoot, "lib/chatSseParser.ts");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-sse-parser-regression-"));
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
  const outPath = path.join(tmpDir, "chatSseParser.cjs");
  fs.writeFileSync(outPath, transpiled);
  return require(outPath);
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

test("parseSseEvent parses id and single data line", () => {
  assert.deepEqual(mod.parseSseEvent("id: 42\ndata: hello"), {
    id: "42",
    data: "hello",
    event: undefined,
    retry: undefined,
    comments: [],
    raw: "id: 42\ndata: hello",
  });
});

test("parseSseEvent joins multi-line data with newline", () => {
  assert.equal(mod.parseSseEvent("data: one\ndata: two").data, "one\ntwo");
});

test("parseSseEvent supports comments, event and retry", () => {
  const parsed = mod.parseSseEvent(": heartbeat\nevent: message\nretry: 1500\ndata: {} ");
  assert.deepEqual(parsed.comments, ["heartbeat"]);
  assert.equal(parsed.event, "message");
  assert.equal(parsed.retry, 1500);
  assert.equal(parsed.data, "{} ");
});

test("parseSseEvent handles data lines without a space after colon", () => {
  assert.equal(mod.parseSseEvent("data:{\"ok\":true}").data, "{\"ok\":true}");
});

test("splitSseEvents returns complete events and remaining partial buffer", () => {
  assert.deepEqual(mod.splitSseEvents("data: a\n\nid: 2\ndata: b\n\npart"), {
    events: ["data: a", "id: 2\ndata: b"],
    remaining: "part",
  });
});

test("splitSseEvents normalizes CRLF boundaries", () => {
  assert.deepEqual(mod.splitSseEvents("data: a\r\n\r\ndata: b\r\n\r\n"), {
    events: ["data: a", "data: b"],
    remaining: "",
  });
});

test("isSseDone trims done marker", () => {
  assert.equal(mod.isSseDone("[DONE]"), true);
  assert.equal(mod.isSseDone(" [DONE] \n"), true);
  assert.equal(mod.isSseDone("done"), false);
});

console.log("\nchat SSE parser regression tests passed");
process.exit(0);
