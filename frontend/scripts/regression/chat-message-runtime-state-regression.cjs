#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(projectRoot, "lib/chatMessageRuntimeState.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  fileName: sourcePath,
}).outputText;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-message-runtime-state-"));
const tmpFile = path.join(tmpDir, "chatMessageRuntimeState.cjs");
fs.writeFileSync(tmpFile, compiled, "utf8");
const { resolveChatMessageRuntimeState, isTerminalMessage } = require(tmpFile);

const completedMessage = {
  id: "3046",
  role: "assistant",
  content: "今天是 2026 年 6 月 30 日。",
  reasoningContent: "持久化推理内容",
  model: "deepseek-v4-pro",
  createdAt: 1000,
  generationStartedAt: 1000,
  completedAt: 30000,
  serverGenerationStatus: "completed",
  phase: "completed",
  searchSources: [{ title: "src", url: "https://example.com", description: "" }],
  searchSourcesCount: 1,
  statusTimeline: [
    { id: "waiting_provider:completed", kind: "waiting_provider", status: "completed", startedAt: 1000, endedAt: 2000 },
    { id: "reasoning:completed", kind: "reasoning", status: "completed", startedAt: 2000, endedAt: 25000 },
    { id: "streaming_answer:completed", kind: "streaming_answer", status: "completed", startedAt: 25000, endedAt: 30000 },
  ],
};
const staleRealtime = {
  content: "旧实时内容",
  reasoningContent: "旧 running 推理",
  phase: "reasoning",
  activityStatus: { kind: "reasoning", status: "running", label: "正在推理" },
  statusTimeline: [
    { id: "reasoning:running", kind: "reasoning", status: "running", startedAt: 5000 },
  ],
  generationStartedAt: 5000,
};

assert.equal(isTerminalMessage(completedMessage), true);
const resolved = resolveChatMessageRuntimeState({ message: completedMessage, realtime: staleRealtime });
assert.equal(resolved.terminal, true);
assert.equal(resolved.terminalSource, "message");
assert.equal(resolved.content, completedMessage.content);
assert.equal(resolved.reasoningContent, completedMessage.reasoningContent);
assert.deepEqual(resolved.searchSources, completedMessage.searchSources);
assert.deepEqual(resolved.statusTimeline.map((step) => `${step.kind}:${step.status}`), [
  "waiting_provider:completed",
  "reasoning:completed",
  "streaming_answer:completed",
]);
assert.equal(resolved.activityStatus, undefined, "stale running realtime activity must not leak into completed message");

const completedWithoutTimeline = { ...completedMessage, statusTimeline: undefined };
const resolvedWithoutTimeline = resolveChatMessageRuntimeState({ message: completedWithoutTimeline, realtime: staleRealtime });
assert.equal(resolvedWithoutTimeline.statusTimeline, undefined, "completed message without timeline should not fall back to stale running realtime timeline");

const runningMessage = { id: "r1", role: "assistant", content: "", createdAt: 1 };
const runningResolved = resolveChatMessageRuntimeState({ message: runningMessage, realtime: staleRealtime });
assert.equal(runningResolved.terminal, false);
assert.deepEqual(runningResolved.statusTimeline.map((step) => `${step.kind}:${step.status}`), ["reasoning:running"]);
assert.equal(runningResolved.activityStatus.label, "正在推理");

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log("chat message runtime state regression tests passed");
