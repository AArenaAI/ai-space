#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "../..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-conversation-lifecycle-hook-"));
const outFile = path.join(tempDir, "useChatConversationLifecycle.cjs");
const sourceFile = path.join(repoRoot, "hooks/useChatConversationLifecycle.ts");
const source = fs.readFileSync(sourceFile, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
    skipLibCheck: true,
  },
  fileName: sourceFile,
});
fs.writeFileSync(
  outFile,
  compiled.outputText.replace(
    'require("react")',
    '{ useCallback: (fn) => fn, useMemo: (fn) => fn(), useRef: (initial) => ({ current: initial }), useState: (initial) => [initial, () => {}] }'
  )
);

const {
  hasMorePersistedMessages,
  markConversationCreated,
  createSetCreatedConversationAction,
  createResetConversationPaginationAction,
  createSetLoadedConversationAction,
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

test("hasMorePersistedMessages compares total and loaded counts", () => {
  assert.equal(hasMorePersistedMessages(51, 50), true);
  assert.equal(hasMorePersistedMessages(50, 50), false);
  assert.equal(hasMorePersistedMessages(10, 20), false);
});

test("markConversationCreated suppresses reset and records just-created id", () => {
  const shouldResetRef = { current: true };
  const justCreatedRef = { current: undefined };
  markConversationCreated({ shouldResetRef, justCreatedRef, conversationId: 42 });
  assert.equal(shouldResetRef.current, false);
  assert.equal(justCreatedRef.current, 42);
});

test("createSetCreatedConversationAction sets title/current and creation refs", () => {
  const title = createState("");
  const current = createState(undefined);
  const shouldResetRef = { current: true };
  const justCreatedRef = { current: undefined };
  const action = createSetCreatedConversationAction({
    setConversationTitle: title.set,
    setCurrentConversation: current.set,
    shouldResetRef,
    justCreatedRef,
  });
  action(7, "Hello");
  assert.equal(title.get(), "Hello");
  assert.equal(current.get(), 7);
  assert.equal(shouldResetRef.current, false);
  assert.equal(justCreatedRef.current, 7);
});

test("createResetConversationPaginationAction clears loaded and total counts", () => {
  const loaded = createState(50);
  const total = createState(120);
  const action = createResetConversationPaginationAction({
    setLoadedPersistedMessages: loaded.set,
    setTotalMessages: total.set,
  });
  action();
  assert.equal(loaded.get(), 0);
  assert.equal(total.get(), 0);
});

test("createSetLoadedConversationAction applies loaded conversation metadata", () => {
  const title = createState("");
  const current = createState(undefined);
  const loaded = createState(0);
  const total = createState(0);
  const action = createSetLoadedConversationAction({
    setConversationTitle: title.set,
    setCurrentConversation: current.set,
    setLoadedPersistedMessages: loaded.set,
    setTotalMessages: total.set,
  });
  action({ id: 9, title: "Loaded", loadedPersistedMessages: 30, totalMessages: 88 });
  assert.equal(title.get(), "Loaded");
  assert.equal(current.get(), 9);
  assert.equal(loaded.get(), 30);
  assert.equal(total.get(), 88);
});

(async () => {
  try {
    for (const entry of tests) {
      await entry.fn();
      console.log(`✓ ${entry.name}`);
    }
    console.log(`chat conversation lifecycle hook regression passed (${tests.length} tests)`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
