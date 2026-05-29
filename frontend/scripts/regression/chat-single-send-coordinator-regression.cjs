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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, strict: true },
    fileName: path.join(projectRoot, sourceFile),
  }).outputText;
  const outPath = path.join(tmpDir, sourceFile.replace(/^lib\//, "").replace(/\.ts$/, ".js"));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output);
}

function loadModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-single-send-coordinator-regression-"));
  [
    "lib/chatMessageFactory.ts",
    "lib/chatRequestBuilder.ts",
    "lib/chatSingleSendCoordinator.ts",
  ].forEach((file) => transpileModule(file, tmpDir));
  return require(path.join(tmpDir, "chatSingleSendCoordinator.js"));
}

const {
  shouldStartSingleSend,
  buildNewConversationTitle,
  prepareSingleSendMessages,
  applySingleSendMessagePlan,
  runSingleChatRequest,
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

let nextId = 0;
function createId() { nextId += 1; return `id-${nextId}`; }
function now() { return 1234 + nextId; }
function resetIds() { nextId = 0; }
function okResponse(body = {}) { return { ok: true, json: async () => body }; }
function failResponse(body = { error: "boom", message: "失败" }) { return { ok: false, json: async () => body }; }

(async () => {
  await test("shouldStartSingleSend accepts content, regenerate, or attachments", () => {
    assert.equal(shouldStartSingleSend({ content: "", isRegenerate: false, attachments: [] }), false);
    assert.equal(shouldStartSingleSend({ content: " hi ", isRegenerate: false, attachments: [] }), true);
    assert.equal(shouldStartSingleSend({ content: "", isRegenerate: true, attachments: [] }), true);
    assert.equal(shouldStartSingleSend({ content: "", isRegenerate: false, attachments: [{ filename: "a", public_id: "p" }] }), true);
  });

  await test("buildNewConversationTitle trims and ellipsizes", () => {
    assert.equal(buildNewConversationTitle("  short  "), "short");
    assert.equal(buildNewConversationTitle("一二三四五六", 3), "一二三...");
  });

  await test("prepareSingleSendMessages builds normal user and assistant messages", () => {
    resetIds();
    const messages = [{ id: "old", role: "assistant", content: "old", createdAt: 1 }];
    const plan = prepareSingleSendMessages({
      content: " hello ", messages, modelId: "m1", isRegenerate: false, skipUserMessage: false,
      attachments: [{ filename: "f.txt", public_id: "pub" }, { filename: "skip" }], search: true, createId, now,
    });
    assert.equal(plan.mode, "normal");
    assert.equal(plan.userMessage.content, "hello");
    assert.deepEqual(plan.userMessage.files, [{ public_id: "pub", type: "file", filename: "f.txt" }]);
    assert.equal(plan.assistantMessage.role, "assistant");
    assert.equal(plan.assistantMessage.searchStatus, "searching");
    assert.deepEqual(plan.contextMessages.map((m) => m.id), ["old", "id-1"]);
    assert.deepEqual(applySingleSendMessagePlan(messages, plan).map((m) => m.id), ["old", "id-1", "id-2"]);
  });

  await test("prepareSingleSendMessages builds regenerate plan from last user", () => {
    resetIds();
    const messages = [
      { id: "u1", role: "user", content: "one", createdAt: 1 },
      { id: "a1", role: "assistant", content: "old", createdAt: 2 },
      { id: "u2", role: "user", content: "two", createdAt: 3 },
      { id: "a2", role: "assistant", content: "old2", createdAt: 4 },
    ];
    const plan = prepareSingleSendMessages({ content: "ignored", messages, modelId: "m2", isRegenerate: true, skipUserMessage: false, search: false, createId, now });
    assert.equal(plan.mode, "regenerate");
    assert.equal(plan.lastUserIndex, 2);
    assert.deepEqual(plan.contextMessages.map((m) => m.id), ["u1", "a1", "u2"]);
    assert.deepEqual(applySingleSendMessagePlan(messages, plan).map((m) => m.id), ["u1", "a1", "u2", "id-1"]);
  });

  await test("prepareSingleSendMessages returns undefined for regenerate without user", () => {
    resetIds();
    const plan = prepareSingleSendMessages({ content: "", messages: [{ id: "a", role: "assistant", content: "x", createdAt: 1 }], modelId: "m", isRegenerate: true, skipUserMessage: false, search: false, createId, now });
    assert.equal(plan, undefined);
  });

  await test("prepareSingleSendMessages builds skip-user synthetic context", () => {
    resetIds();
    const messages = [{ id: "u1", role: "user", content: "prev", createdAt: 1 }];
    const plan = prepareSingleSendMessages({ content: " hidden ", messages, modelId: "m3", isRegenerate: false, skipUserMessage: true, attachments: [{ filename: "x", type: "image", public_id: "p" }], search: false, createId, now });
    assert.equal(plan.mode, "skip-user");
    assert.equal(plan.contextMessages[1].id, "");
    assert.equal(plan.contextMessages[1].content, "hidden");
    assert.deepEqual(plan.contextMessages[1].files, [{ public_id: "p", type: "image", filename: "x" }]);
    assert.deepEqual(applySingleSendMessagePlan(messages, plan).map((m) => m.id), ["u1", "id-1"]);
  });

  await test("runSingleChatRequest posts body and streams response", async () => {
    const calls = [];
    const controller = new AbortController();
    const assistant = { id: "a1", role: "assistant", content: "", createdAt: 1, model: "m" };
    const result = await runSingleChatRequest({
      apiBaseUrl: "http://api",
      headers: { Authorization: "Bearer token" },
      controller,
      assistantMessage: assistant,
      modelId: "m",
      modelMessages: [{ role: "user", content: "hi" }],
      conversationId: 9,
      reasoning: { enabled: true, effort: "low" },
      search: true,
      templateId: 2,
      skipSaveUserMessage: true,
      skillKey: "skill",
      messageFileIds: ["file"],
      fetchImpl: async (url, init) => { calls.push([url, JSON.parse(init.body), init.signal === controller.signal]); return okResponse(); },
      streamResponse: async (response, msg, ctrl, convId) => {
        calls.push(["stream", response.ok, msg.id, ctrl === controller, convId]);
        return { content: "ok", lastSequence: 1, sawDone: true, useBackground: false };
      },
    });
    assert.equal(result.content, "ok");
    assert.equal(calls[0][0], "http://api/api/chat");
    assert.equal(calls[0][1].model, "m");
    assert.equal(calls[0][1].skip_save_user_msg, true);
    assert.equal(calls[0][1].reasoning_effort, "low");
    assert.deepEqual(calls[0][1].message_file_ids, ["file"]);
    assert.equal(calls[0][2], true);
    assert.deepEqual(calls[1], ["stream", true, "a1", true, 9]);
  });

  await test("runSingleChatRequest throws normalized response errors", async () => {
    await assert.rejects(
      () => runSingleChatRequest({
        headers: {}, controller: new AbortController(), assistantMessage: { id: "a", role: "assistant", content: "", createdAt: 1 },
        modelId: "m", modelMessages: [], reasoning: { enabled: false }, search: false, templateId: 0, skipSaveUserMessage: false,
        fetchImpl: async () => failResponse({ error: "quota", message: "额度不足" }),
        streamResponse: async () => undefined,
      }),
      (err) => err.errorCode === "quota" && err.message === "额度不足"
    );
  });

  if (!process.exitCode) console.log("\nchat single send coordinator regression tests passed");
})();
