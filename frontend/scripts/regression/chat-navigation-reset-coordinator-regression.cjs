#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "../..");
const sourceFile = path.join(repoRoot, "lib/chatNavigationResetCoordinator.ts");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-navigation-reset-"));
const outFile = path.join(tempDir, "chatNavigationResetCoordinator.cjs");

const source = fs.readFileSync(sourceFile, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;
fs.writeFileSync(outFile, transpiled);

const {
  buildNavigationAbortPlan,
  buildConversationNavigationPlan,
  shouldContinueConversationRestore,
} = require(outFile);

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

test("buildNavigationAbortPlan requests navigation abort for main and compare controllers", () => {
  assert.deepEqual(buildNavigationAbortPlan({ hasMainAbortController: true, compareAbortControllerCount: 2 }), {
    shouldAbortMain: true,
    shouldAbortCompare: true,
    abortReason: "navigation",
  });
});

test("buildNavigationAbortPlan omits abort reason when no controllers exist", () => {
  assert.deepEqual(buildNavigationAbortPlan({ hasMainAbortController: false, compareAbortControllerCount: 0 }), {
    shouldAbortMain: false,
    shouldAbortCompare: false,
    abortReason: null,
  });
});

test("buildConversationNavigationPlan resets empty conversation when reset is allowed", () => {
  assert.deepEqual(buildConversationNavigationPlan({
    conversationId: undefined,
    shouldReset: true,
    skillKey: "writer",
    hasMainAbortController: true,
    compareAbortControllerCount: 1,
  }), {
    kind: "reset",
    shouldSetLoadingHistory: true,
    loadingHistory: false,
    shouldClearConversationTitle: true,
    conversationTitle: "",
    shouldResetMessages: true,
    shouldSetCurrentConversation: true,
    currentConversation: undefined,
    loadedPersistedMessages: 0,
    totalMessages: 0,
    isCompare: false,
    compareModels: [],
    effectiveSkillKey: "writer",
  });
});

test("empty conversation preserves messages/current conversation when reset is suppressed", () => {
  const plan = buildConversationNavigationPlan({
    conversationId: undefined,
    shouldReset: false,
    skillKey: undefined,
    hasMainAbortController: false,
    compareAbortControllerCount: 0,
  });
  assert.equal(plan.kind, "reset");
  assert.equal(plan.shouldResetMessages, false);
  assert.equal(plan.shouldSetCurrentConversation, false);
  assert.equal(plan.effectiveSkillKey, undefined);
});

test("just-created conversation skips history load and clears pagination", () => {
  assert.deepEqual(buildConversationNavigationPlan({
    conversationId: 42,
    shouldReset: true,
    justCreatedConversationId: 42,
    skillKey: "ignored",
    hasMainAbortController: true,
    compareAbortControllerCount: 1,
  }), {
    kind: "just_created",
    shouldClearJustCreated: true,
    conversationId: 42,
    loadingHistory: false,
    loadedPersistedMessages: 0,
    totalMessages: 0,
  });
});

test("existing conversation requests direct SSE navigation aborts and history loading", () => {
  assert.deepEqual(buildConversationNavigationPlan({
    conversationId: 7,
    shouldReset: true,
    justCreatedConversationId: 99,
    hasMainAbortController: false,
    compareAbortControllerCount: 3,
  }), {
    kind: "load_existing",
    conversationId: 7,
    abortPlan: {
      shouldAbortMain: false,
      shouldAbortCompare: true,
      abortReason: "navigation",
    },
    shouldSetLoadingHistory: true,
    loadingHistory: true,
    shouldSetCurrentConversation: true,
  });
});

test("shouldContinueConversationRestore requires token and non-aborted load", () => {
  assert.equal(shouldContinueConversationRestore({ token: "abc", loadAborted: false }), true);
  assert.equal(shouldContinueConversationRestore({ token: "", loadAborted: false }), false);
  assert.equal(shouldContinueConversationRestore({ token: "abc", loadAborted: true }), false);
});

console.log("\nchat navigation reset coordinator regression tests passed");
