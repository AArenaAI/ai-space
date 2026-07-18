#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
let source = fs.readFileSync(path.join(projectRoot, "lib/chatMessageIdentity.ts"), "utf8");
source = source.replace(/import type \{[^;]+\} from "\.\/chatTypes";\n/g, "");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-message-identity-"));
const tmpFile = path.join(tmpDir, "chatMessageIdentity.cjs");
fs.writeFileSync(tmpFile, compiled, "utf8");
const {
  getMessageRenderKey,
  getChatMessageIdentityMatchReason,
  sameChatMessage,
  bindServerMessage,
  mergeChatMessagesByIdentity,
} = require(tmpFile);

const localUser = { id: "local-user", role: "user", content: "hi", createdAt: 1, clientMessageId: "client-u", localRunId: "run-1", sendStatus: "submitting" };
const serverUser = { id: "42", role: "user", content: "hi", createdAt: 2, serverMessageId: 42, clientMessageId: "client-u", localRunId: "run-1", sendStatus: "server_bound" };
const localAssistant = { id: "local-assistant", role: "assistant", content: "", createdAt: 1, clientMessageId: "client-a", localRunId: "run-1" };
const serverAssistant = { id: "43", role: "assistant", content: "", createdAt: 2, serverMessageId: 43, generationTaskId: 9, clientMessageId: "client-a", localRunId: "run-1" };

assert.equal(getMessageRenderKey(localUser), "client-u");
assert.equal(getMessageRenderKey({ id: "43", role: "assistant", content: "", createdAt: 1, serverMessageId: 43 }), "server:43");
assert.equal(getMessageRenderKey({ id: "x", role: "assistant", content: "", createdAt: 1, localRunId: "run-x" }), "run:run-x:assistant");
assert.equal(getChatMessageIdentityMatchReason({ role: "user", serverMessageId: 1 }, { role: "assistant", serverMessageId: 1 }), "serverMessageId");
assert.equal(getChatMessageIdentityMatchReason(localUser, serverUser), "clientMessageId");
assert.equal(getChatMessageIdentityMatchReason({ id: "a", role: "assistant", localRunId: "run-1" }, { id: "b", role: "assistant", localRunId: "run-1" }), "localRunIdRole");
assert.equal(getChatMessageIdentityMatchReason({ id: "a", role: "assistant", localRunId: "run-1" }, { id: "b", role: "user", localRunId: "run-1" }), "none");
assert.equal(sameChatMessage(localAssistant, serverAssistant), true);
const bound = bindServerMessage(localAssistant, serverAssistant);
assert.equal(bound.id, "local-assistant", "bind must preserve React/local id");
assert.equal(bound.serverMessageId, 43);
assert.equal(bound.generationTaskId, 9);
assert.equal(bound.clientMessageId, "client-a");
assert.equal(bound.localRunId, "run-1");
const merged = mergeChatMessagesByIdentity([localUser, localAssistant], [serverUser, serverAssistant]);
assert.equal(merged.length, 2, "server bind must patch not duplicate local rows");
assert.deepEqual(merged.map((m) => m.id), ["local-user", "local-assistant"]);
assert.deepEqual(merged.map((m) => m.serverMessageId), [42, 43]);

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log("chat message identity regression passed");
