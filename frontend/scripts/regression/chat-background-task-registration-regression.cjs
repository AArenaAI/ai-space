#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-background-task-registration-regression-"));
  const sourceFile = path.join(projectRoot, "lib/chatBackgroundTaskRegistration.ts");
  const output = ts.transpileModule(fs.readFileSync(sourceFile, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      strict: true,
    },
    fileName: sourceFile,
  }).outputText;
  const outPath = path.join(tmpDir, "chatBackgroundTaskRegistration.js");
  fs.writeFileSync(outPath, output);
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

test("getNotificationConversationTitle prefers trimmed conversation title", () => {
  assert.equal(mod.getNotificationConversationTitle("  Project Plan  ", "Model"), "Project Plan");
});

test("getNotificationConversationTitle falls back to model name then generic label", () => {
  assert.equal(mod.getNotificationConversationTitle("", " GPT-5.5 "), "GPT-5.5");
  assert.equal(mod.getNotificationConversationTitle("", ""), "对话任务");
});

test("buildChatBackgroundTaskRegistration builds chat task payload with conversation link", () => {
  assert.deepEqual(mod.buildChatBackgroundTaskRegistration({
    serverMessageId: 42,
    conversationId: 7,
    conversationTitle: "  长报告  ",
    modelName: "gpt-5.5-pro",
  }), {
    type: "chat",
    id: 42,
    key: "chat:42",
    title: "长对话生成中",
    description: "长报告",
    href: "/chat?id=7",
    conversationId: 7,
    serverMessageId: 42,
    conversationTitle: "长报告",
  });
});

test("buildChatBackgroundTaskRegistration omits query when conversation id is missing", () => {
  assert.deepEqual(mod.buildChatBackgroundTaskRegistration({
    serverMessageId: 99,
    modelName: "fallback-model",
  }), {
    type: "chat",
    id: 99,
    key: "chat:99",
    title: "长对话生成中",
    description: "fallback-model",
    href: "/chat",
    conversationId: undefined,
    serverMessageId: 99,
    conversationTitle: "fallback-model",
  });
});

console.log("\nchat background task registration regression tests passed");
