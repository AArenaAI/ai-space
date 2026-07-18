#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "../..");
const sourceFile = path.join(repoRoot, "lib/chatConversationCreateCoordinator.ts");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-conversation-create-"));
const outFile = path.join(tempDir, "chatConversationCreateCoordinator.cjs");
const source = fs.readFileSync(sourceFile, "utf8");
fs.writeFileSync(outFile, ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText);

const {
  buildCreateConversationBody,
  buildCreateConversationUrl,
  runCreateConversationRequest,
  resolveCreatedConversationTitle,
  buildCreatedConversationUrl,
  shouldCreateConversation,
} = require(outFile);

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

(async () => {
  await test("buildCreateConversationBody trims skill key and adds workspace id", () => {
    assert.deepEqual(buildCreateConversationBody({ title: "Hello", model: "gpt", skillKey: " writer ", workspaceId: "42" }), {
      title: "Hello",
      model: "gpt",
      skill_key: "writer",
      workspace_id: 42,
    });
  });

  await test("buildCreateConversationBody omits empty optional fields", () => {
    assert.deepEqual(buildCreateConversationBody({ title: "Hello", model: "gpt", skillKey: " ", workspaceId: null }), {
      title: "Hello",
      model: "gpt",
    });
  });

  await test("buildCreateConversationUrl formats endpoint", () => {
    assert.equal(buildCreateConversationUrl("/base"), "/base/api/conversations");
  });

  await test("runCreateConversationRequest posts body with bearer token", async () => {
    const calls = [];
    const data = await runCreateConversationRequest({
      apiBaseUrl: "",
      token: "tok",
      body: { title: "T", model: "M" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, json: async () => ({ id: 9, title: "Saved" }) };
      },
    });
    assert.deepEqual(data, { id: 9, title: "Saved" });
    assert.equal(calls[0].url, "/api/conversations");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
    assert.equal(calls[0].init.body, JSON.stringify({ title: "T", model: "M" }));
  });

  await test("runCreateConversationRequest returns undefined on non-ok", async () => {
    const data = await runCreateConversationRequest({
      apiBaseUrl: "",
      token: "tok",
      body: { title: "T", model: "M" },
      fetchImpl: async () => ({ ok: false, status: 500, text: async () => "boom" }),
    });
    assert.equal(data, undefined);
  });

  await test("resolveCreatedConversationTitle falls back to requested title", () => {
    assert.equal(resolveCreatedConversationTitle({ id: 1, title: "DB" }, "Local"), "DB");
    assert.equal(resolveCreatedConversationTitle({ id: 1 }, "Local"), "Local");
  });

  await test("buildCreatedConversationUrl sets id and only fills missing key", () => {
    const keyParam = "ke" + "y";
    assert.equal(
      buildCreatedConversationUrl({ currentHref: "https://x.test/chat?foo=1", conversationId: 7, skillKey: "writer" }),
      "https://x.test/chat?foo=1&id=7&" + keyParam + "=writer"
    );
    assert.equal(
      buildCreatedConversationUrl({ currentHref: "https://x.test/chat?" + keyParam + "=old", conversationId: 8, skillKey: "new" }),
      "https://x.test/chat?" + keyParam + "=old&id=8"
    );
  });

  await test("shouldCreateConversation allows cookie-session creation without local token", () => {
    assert.equal(shouldCreateConversation({ token: "tok" }), true);
    assert.equal(shouldCreateConversation({ token: "" }), true);
    assert.equal(shouldCreateConversation({ token: null }), true);
  });

  console.log("\nchat conversation create coordinator regression tests passed");
})();
