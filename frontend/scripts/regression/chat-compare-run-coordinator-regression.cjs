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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-compare-run-coordinator-regression-"));
  [
    "lib/chatCompareCoordinator.ts",
    "lib/chatRequestBuilder.ts",
    "lib/chatCompareRunCoordinator.ts",
  ].forEach((file) => transpileModule(file, tmpDir));
  return require(path.join(tmpDir, "chatCompareRunCoordinator.js"));
}

const {
  buildCompareRunRequestBody,
  createCompareRunCoordinator,
  runCompareModels,
} = loadModule();

function test(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => console.log(`✓ ${name}`))
    .catch((err) => {
      console.error(`✗ ${name}`);
      console.error(err);
      process.exitCode = 1;
    });
}

function okResponse(body = {}) {
  return {
    ok: true,
    json: async () => body,
  };
}

function failResponse(body = { error: "boom", message: "失败" }) {
  return {
    ok: false,
    json: async () => body,
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("buildCompareRunRequestBody preserves compare fields", () => {
  const body = buildCompareRunRequestBody({
    assistant: { id: "a2", model: "model-b" },
    index: 1,
    requestGroupContext: { groupId: 10, userMessageId: 20, groupModels: ["model-a", "model-b"] },
    compareModelIds: ["model-a", "model-b"],
    modelMessages: [{ role: "user", content: "hi" }],
    conversationId: 7,
    reasoning: { enabled: true, effort: "medium" },
    search: true,
    templateId: 3,
    templatePrefix: "prefix",
    skillKey: "skill",
    messageFileIds: ["file-1"],
  });
  assert.equal(body.model, "model-b");
  assert.equal(body.skip_save_user_msg, true);
  assert.equal(body.group_id, 10);
  assert.equal(body.user_message_id, 20);
  assert.equal(body.group_index, 1);
  assert.deepEqual(body.group_models, ["model-a", "model-b"]);
  assert.equal(body.reasoning_effort, "medium");
  assert.deepEqual(body.message_file_ids, ["file-1"]);
});

test("coordinator resolves once when group context is ready", async () => {
  const resolved = [];
  const coordinator = createCompareRunCoordinator({
    fallbackGroupModels: ["a", "b"],
    onResolved: (context) => resolved.push(context),
  });
  coordinator.setGroupContext({ groupId: 1, userMessageId: undefined, groupModels: [] });
  assert.equal(coordinator.isResolved(), false);
  coordinator.setGroupContext({ groupId: undefined, userMessageId: 2, groupModels: [] });
  const context = await coordinator.waitForGroupContext();
  assert.equal(coordinator.isResolved(), true);
  assert.deepEqual(context, { groupId: 1, userMessageId: 2, groupModels: ["a", "b"] });
  assert.equal(resolved.length, 1);
});

test("runCompareModels runs first request then rest after context", async () => {
  const calls = [];
  const controllers = [new AbortController(), new AbortController(), new AbortController()];
  const fetchImpl = async (url, init) => {
    calls.push(["fetch", JSON.parse(init.body)]);
    return okResponse();
  };
  const streamResponse = async (_response, assistant, _controller, _convId, onGroupContext) => {
    calls.push(["stream", assistant.id]);
    if (assistant.id === "a1") {
      onGroupContext?.({ groupId: 100, userMessageId: 200, groupModels: ["m1", "m2", "m3"] });
      return { groupContext: { groupId: 100, userMessageId: 200, groupModels: ["m1", "m2", "m3"] }, lastSequence: 1, content: "", useBackground: false, sawDone: true };
    }
    return { lastSequence: 1, content: "", useBackground: false, sawDone: true };
  };

  await runCompareModels({
    headers: { "Content-Type": "application/json" },
    controllers,
    assistantMessages: [{ id: "a1", model: "m1" }, { id: "a2", model: "m2" }, { id: "a3", model: "m3" }],
    compareModelIds: ["m1", "m2", "m3"],
    modelMessages: [{ role: "user", content: "hi" }],
    conversationId: 9,
    reasoning: { enabled: false },
    search: false,
    templateId: 0,
    callbacks: {
      fetchImpl,
      streamResponse,
      onGroupContextResolved: (context) => calls.push(["resolved", context]),
      onRecoverableResult: () => calls.push(["recoverable"]),
      onAbortUser: () => calls.push(["abort-user"]),
      onRunError: () => calls.push(["error"]),
      getAbortReason: () => null,
    },
  });

  const fetchBodies = calls.filter((call) => call[0] === "fetch").map((call) => call[1]);
  assert.equal(fetchBodies.length, 3);
  assert.equal(fetchBodies[0].skip_save_user_msg, false);
  assert.equal(fetchBodies[1].skip_save_user_msg, true);
  assert.equal(fetchBodies[1].group_id, 100);
  assert.equal(fetchBodies[2].user_message_id, 200);
  assert.equal(calls.some((call) => call[0] === "resolved"), true);
});

test("runCompareModels waits for first run when context is missing", async () => {
  const calls = [];
  await runCompareModels({
    headers: {},
    controllers: [new AbortController(), new AbortController()],
    assistantMessages: [{ id: "a1", model: "m1" }, { id: "a2", model: "m2" }],
    compareModelIds: ["m1", "m2"],
    modelMessages: [{ role: "user", content: "hi" }],
    reasoning: { enabled: false },
    search: false,
    templateId: 0,
    callbacks: {
      fetchImpl: async (_url, init) => { calls.push(["fetch", JSON.parse(init.body)]); return okResponse(); },
      streamResponse: async () => ({ lastSequence: 1, content: "", useBackground: false, sawDone: true }),
      onGroupContextResolved: () => calls.push(["resolved"]),
      onRecoverableResult: () => calls.push(["recoverable"]),
      onAbortUser: () => calls.push(["abort-user"]),
      onRunError: () => calls.push(["error"]),
      getAbortReason: () => null,
    },
  });
  assert.equal(calls.filter((call) => call[0] === "fetch").length, 1);
});

test("runCompareModels forwards recoverable stream result", async () => {
  const calls = [];
  await runCompareModels({
    headers: {},
    controllers: [new AbortController()],
    assistantMessages: [{ id: "a1", model: "m1" }],
    compareModelIds: ["m1"],
    modelMessages: [{ role: "user", content: "hi" }],
    reasoning: { enabled: false },
    search: false,
    templateId: 0,
    callbacks: {
      fetchImpl: async () => okResponse(),
      streamResponse: async () => ({ lastSequence: 1, content: "", useBackground: true, sawDone: false, recoverable: true, serverMessageId: 5 }),
      onGroupContextResolved: () => {},
      onRecoverableResult: (assistant, result) => calls.push(["recoverable", assistant.id, result.serverMessageId]),
      onAbortUser: () => {},
      onRunError: () => {},
      getAbortReason: () => null,
    },
  });
  assert.deepEqual(calls, [["recoverable", "a1", 5]]);
});

test("runCompareModels reports fetch errors", async () => {
  const calls = [];
  await runCompareModels({
    headers: {},
    controllers: [new AbortController()],
    assistantMessages: [{ id: "a1", model: "m1" }],
    compareModelIds: ["m1"],
    modelMessages: [{ role: "user", content: "hi" }],
    reasoning: { enabled: false },
    search: false,
    templateId: 0,
    callbacks: {
      fetchImpl: async () => failResponse({ error: "quota", message: "额度不足" }),
      streamResponse: async () => undefined,
      onGroupContextResolved: () => {},
      onRecoverableResult: () => {},
      onAbortUser: () => {},
      onRunError: (assistant, error) => calls.push(["error", assistant.id, error.errorCode, error.message]),
      getAbortReason: () => null,
    },
  });
  assert.deepEqual(calls, [["error", "a1", "quota", "额度不足"]]);
});

test("runCompareModels handles user abort only when abort reason is user", async () => {
  const calls = [];
  await runCompareModels({
    headers: {},
    controllers: [new AbortController()],
    assistantMessages: [{ id: "a1", model: "m1" }],
    compareModelIds: ["m1"],
    modelMessages: [{ role: "user", content: "hi" }],
    reasoning: { enabled: false },
    search: false,
    templateId: 0,
    callbacks: {
      fetchImpl: async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); },
      streamResponse: async () => undefined,
      onGroupContextResolved: () => {},
      onRecoverableResult: () => {},
      onAbortUser: (assistant) => calls.push(["abort-user", assistant.id]),
      onRunError: () => calls.push(["error"]),
      getAbortReason: () => "user",
    },
  });
  assert.deepEqual(calls, [["abort-user", "a1"]]);
});

setTimeout(() => {
  if (!process.exitCode) console.log("\nchat compare run coordinator regression tests passed");
}, 50);
