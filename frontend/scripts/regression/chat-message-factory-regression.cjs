#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(projectRoot, "lib/chatMessageFactory.ts");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-message-factory-regression-"));
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
  const outPath = path.join(tmpDir, "chatMessageFactory.cjs");
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

test("buildMessageFiles keeps only attachments with public ids", () => {
  assert.deepEqual(mod.buildMessageFiles([
    { filename: "a.txt", public_id: "pub-a", type: "text" },
    { filename: "skip.txt" },
    { filename: "b.bin", public_id: "pub-b" },
  ], { defaultType: "file" }), [
    { public_id: "pub-a", type: "text", filename: "a.txt" },
    { public_id: "pub-b", type: "file", filename: "b.bin" },
  ]);
});

test("buildMessageFiles defaults missing type to file", () => {
  assert.deepEqual(mod.buildMessageFiles([{ filename: "a", public_id: "p" }]), [
    { public_id: "p", type: "file", filename: "a" },
  ]);
});

test("createUserChatMessage trims content and preserves files", () => {
  const files = [{ public_id: "p", type: "file", filename: "a" }];
  assert.deepEqual(mod.createUserChatMessage({ id: "u1", content: "  hello  ", createdAt: 123, files }), {
    id: "u1",
    role: "user",
    content: "hello",
    createdAt: 123,
    files,
  });
});

test("createUserChatMessage defaults files to empty array", () => {
  assert.deepEqual(mod.createUserChatMessage({ id: "u1", content: "hello", createdAt: 123 }), {
    id: "u1",
    role: "user",
    content: "hello",
    createdAt: 123,
    files: [],
  });
});

test("createAssistantChatMessage creates searchable assistant state", () => {
  assert.deepEqual(mod.createAssistantChatMessage({ id: "a1", model: "m1", createdAt: 456, search: true }), {
    id: "a1",
    role: "assistant",
    content: "",
    model: "m1",
    createdAt: 456,
    search: true,
    searchStatus: "searching",
  });
});

test("createAssistantChatMessage omits search status when search disabled", () => {
  assert.deepEqual(mod.createAssistantChatMessage({ id: "a1", model: "m1", createdAt: 456, search: false }), {
    id: "a1",
    role: "assistant",
    content: "",
    model: "m1",
    createdAt: 456,
    search: false,
    searchStatus: undefined,
  });
});

test("createCompareAssistantMessages maps model ids to supplied ids", () => {
  assert.deepEqual(mod.createCompareAssistantMessages({
    modelIds: ["m1", "m2"],
    ids: ["a1", "a2"],
    createdAt: 789,
    search: true,
  }), [
    { id: "a1", role: "assistant", content: "", model: "m1", createdAt: 789, search: true, searchStatus: "searching" },
    { id: "a2", role: "assistant", content: "", model: "m2", createdAt: 789, search: true, searchStatus: "searching" },
  ]);
});

console.log("\nchat message factory regression tests passed");
process.exit(0);
