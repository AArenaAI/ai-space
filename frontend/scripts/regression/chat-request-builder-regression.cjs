#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(projectRoot, "lib/chatRequestBuilder.ts");

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-request-builder-regression-"));
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
  const outPath = path.join(tmpDir, "chatRequestBuilder.cjs");
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

const messages = [{ role: "user", content: "hi" }];

test("buildChatRequestHeaders uses bearer token when present", () => {
  assert.deepEqual(mod.buildChatRequestHeaders({ token: "tok", guestId: "guest" }), {
    "Content-Type": "application/json",
    Authorization: "Bearer tok",
    "X-Guest-ID": "guest",
  });
});

test("buildChatRequestHeaders falls back to guest id", () => {
  assert.deepEqual(mod.buildChatRequestHeaders({ token: "", guestId: "guest" }), {
    "Content-Type": "application/json",
    "X-Guest-ID": "guest",
  });
});

test("buildSingleChatRequestBody preserves single chat fields", () => {
  assert.deepEqual(mod.buildSingleChatRequestBody({
    model: "m1",
    messages,
    conversationId: 12,
    reasoningEnabled: true,
    reasoningEffort: "medium",
    search: true,
    templateId: 3,
    skipSaveUserMessage: true,
    skillKey: "skill",
    messageFileIds: ["f1"],
  }), {
    model: "m1",
    messages,
    stream: true,
    conversation_id: 12,
    notebook_id: undefined,
    reasoning_effort: "medium",
    search: true,
    template_id: 3,
    skip_save_user_msg: true,
    client_message_id: undefined,
    local_run_id: undefined,
    send_status: undefined,
    skill_key: "skill",
    message_file_ids: ["f1"],
    notebook_file_ids: undefined,
    client_timezone: undefined,
  });
});

test("buildSingleChatRequestBody defaults reasoning effort and optional fields", () => {
  assert.deepEqual(mod.buildSingleChatRequestBody({
    model: "m1",
    messages,
    reasoningEnabled: false,
    search: false,
    templateId: 0,
  }), {
    model: "m1",
    messages,
    stream: true,
    conversation_id: undefined,
    notebook_id: undefined,
    reasoning_effort: "thinking",
    search: false,
    template_id: 0,
    skip_save_user_msg: false,
    client_message_id: undefined,
    local_run_id: undefined,
    send_status: undefined,
    skill_key: undefined,
    message_file_ids: undefined,
    notebook_file_ids: undefined,
    client_timezone: undefined,
  });
});

test("buildCompareChatRequestBody preserves compare fields", () => {
  assert.deepEqual(mod.buildCompareChatRequestBody({
    model: "m2",
    messages,
    conversationId: 22,
    reasoningEnabled: true,
    reasoningEffort: "low",
    search: false,
    templateId: 5,
    templatePrefix: "prefix",
    skipSaveUserMessage: true,
    groupId: 7,
    userMessageId: 8,
    groupIndex: 1,
    groupModels: ["g1", "g2"],
    fallbackGroupModels: ["fallback"],
    skillKey: "skill",
    messageFileIds: ["file"],
  }), {
    model: "m2",
    messages,
    stream: true,
    conversation_id: 22,
    notebook_id: undefined,
    reasoning_effort: "low",
    search: false,
    template_id: 5,
    template_prefix: "prefix",
    skip_save_user_msg: true,
    group_id: 7,
    user_message_id: 8,
    group_index: 1,
    group_models: ["g1", "g2"],
    skill_key: "skill",
    message_file_ids: ["file"],
    notebook_file_ids: undefined,
    client_timezone: undefined,
  });
});

test("buildCompareChatRequestBody falls back group models when context list is empty", () => {
  const body = mod.buildCompareChatRequestBody({
    model: "m2",
    messages,
    reasoningEnabled: false,
    search: false,
    templateId: 0,
    skipSaveUserMessage: false,
    groupIndex: 0,
    groupModels: [],
    fallbackGroupModels: ["a", "b"],
  });
  assert.deepEqual(body.group_models, ["a", "b"]);
  assert.equal(body.reasoning_effort, "thinking");
});

console.log("\nchat request builder regression tests passed");
process.exit(0);
