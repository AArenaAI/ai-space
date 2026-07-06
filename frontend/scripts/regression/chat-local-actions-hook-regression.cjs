#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "../..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-local-actions-hook-"));
const outFile = path.join(tempDir, "useChatLocalActions.cjs");
const sourceFile = path.join(repoRoot, "hooks/useChatLocalActions.ts");
const coordinatorFile = path.join(repoRoot, "lib/chatLocalActionCoordinator.ts");
let source = fs.readFileSync(sourceFile, "utf8");
source = source.replace(/import type[^;]+chatTypes[^;]+;\n/g, "");
source = source.replace(
  /import \{\n  buildClearMessagesState,\n  buildRegenerateRequest,\n  switchGroupView,\n\} from "@\/lib\/chatLocalActionCoordinator";/,
  fs.readFileSync(coordinatorFile, "utf8").replace(/export /g, "")
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
    skipLibCheck: true,
  },
  fileName: sourceFile,
});
fs.writeFileSync(outFile, compiled.outputText.replace('require("react")', '{}'));

const {
  createClearMessagesAction,
  createRegenerateMessageAction,
  createSwitchGroupModelAction,
} = require(outFile);

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function createState(initial) {
  let value = initial;
  return {
    get: () => value,
    set: (next) => {
      value = typeof next === "function" ? next(value) : next;
    },
  };
}

test("createClearMessagesAction clears messages and conversation", () => {
  const messages = createState([{ id: "m1" }]);
  const conversation = createState(12);
  const action = createClearMessagesAction({ setMessages: messages.set, setCurrentConversation: conversation.set });
  action();
  assert.deepEqual(messages.get(), []);
  assert.equal(conversation.get(), undefined);
});

test("createRegenerateMessageAction sends latest user message", async () => {
  const calls = [];
  const action = createRegenerateMessageAction({
    getMessages: () => [
      { role: "user", content: "old" },
      { role: "assistant", content: "answer" },
      { role: "user", content: "new" },
    ],
    getReasoning: () => ({ enabled: true, effort: "high" }),
    getSearch: () => true,
    sendMessage: async (...args) => calls.push(args),
  });
  await action();
  assert.deepEqual(calls, [["new", { enabled: true, effort: "high" }, true, true]]);
});

test("createRegenerateMessageAction no-ops without user message", async () => {
  const calls = [];
  const action = createRegenerateMessageAction({
    getMessages: () => [{ role: "assistant", content: "answer" }],
    getReasoning: () => ({ enabled: false }),
    getSearch: () => false,
    sendMessage: async (...args) => calls.push(args),
  });
  await action();
  assert.deepEqual(calls, []);
});

test("createSwitchGroupModelAction updates map immutably", () => {
  const initial = new Map([[1, 0]]);
  const groupViews = createState(initial);
  const action = createSwitchGroupModelAction({ setGroupViews: groupViews.set });
  action(1, 2);
  assert.notEqual(groupViews.get(), initial);
  assert.equal(groupViews.get().get(1), 2);
});

(async () => {
  try {
    for (const entry of tests) {
      await entry.fn();
      console.log(`✓ ${entry.name}`);
    }
    console.log(`chat local actions hook regression passed (${tests.length} tests)`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
