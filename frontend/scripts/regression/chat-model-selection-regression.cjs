#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "../..");
const sourceFile = path.join(repoRoot, "hooks/useChatModelSelection.ts");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-model-selection-"));
const outFile = path.join(tempDir, "useChatModelSelection.cjs");
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
fs.writeFileSync(outFile, compiled.outputText.replace('require("react")', '{ useCallback: (fn) => fn, useEffect: () => {}, useState: (initial) => [initial, () => {}] }'));

const {
  SELECTED_MODEL_STORAGE_KEY,
  RECENT_MODELS_STORAGE_KEY,
  buildRecentModelIds,
  loadSavedChatModel,
  persistSelectedChatModel,
  persistRecentChatModels,
  preserveSelectedChatModel,
} = require(outFile);

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function installLocalStorage(initial = {}) {
  const store = { ...initial };
  const localStorageMock = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
  };
  global.localStorage = localStorageMock;
  global.window = { localStorage: localStorageMock };
  return store;
}

const models = [
  { id: "a", name: "A", provider: "P", description: "", color: "#000" },
  { id: "b", name: "B", provider: "P", description: "", color: "#111" },
];

test("loadSavedChatModel returns saved model when available", () => {
  installLocalStorage({ [SELECTED_MODEL_STORAGE_KEY]: "b" });
  assert.equal(loadSavedChatModel(models).id, "b");
});

test("loadSavedChatModel falls back to first model when missing or invalid", () => {
  installLocalStorage({ [SELECTED_MODEL_STORAGE_KEY]: "missing" });
  assert.equal(loadSavedChatModel(models).id, "a");
});

test("persistSelectedChatModel stores selected id", () => {
  const store = installLocalStorage();
  persistSelectedChatModel(models[1]);
  assert.equal(store[SELECTED_MODEL_STORAGE_KEY], "b");
});

test("buildRecentModelIds moves selected id to front and limits length", () => {
  assert.deepEqual(buildRecentModelIds(["a", "b", "c", "d"], "c", 3), ["c", "a", "b"]);
});

test("persistRecentChatModels preserves malformed storage", () => {
  const store = installLocalStorage({ [RECENT_MODELS_STORAGE_KEY]: "not-json" });
  persistRecentChatModels(models[0]);
  assert.equal(store[RECENT_MODELS_STORAGE_KEY], "not-json");
});

test("persistRecentChatModels stores filtered recent ids", () => {
  const store = installLocalStorage({ [RECENT_MODELS_STORAGE_KEY]: JSON.stringify(["a", 1, "b"]) });
  persistRecentChatModels(models[1]);
  assert.equal(store[RECENT_MODELS_STORAGE_KEY], JSON.stringify(["b", "a"]));
});

test("preserveSelectedChatModel keeps current selection across equivalent model list refreshes", () => {
  installLocalStorage({ [SELECTED_MODEL_STORAGE_KEY]: "a" });
  const refreshedModels = models.map((model) => ({ ...model }));
  assert.equal(preserveSelectedChatModel(models[1], refreshedModels).id, "b");
});

test("preserveSelectedChatModel falls back when current model disappears", () => {
  installLocalStorage({ [SELECTED_MODEL_STORAGE_KEY]: "a" });
  assert.equal(preserveSelectedChatModel({ ...models[1], id: "missing" }, models).id, "a");
});

(async () => {
  try {
    for (const entry of tests) {
      await entry.fn();
      console.log(`✓ ${entry.name}`);
    }
    console.log(`chat model selection regression passed (${tests.length} tests)`);
  } finally {
    delete global.localStorage;
    delete global.window;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
