#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(projectRoot, "lib/chatActivityTimeline.ts");
const source = fs.readFileSync(sourcePath, "utf8").replace(/import type \{[^;]+\} from "\.\/chatStatusTimeline";\n/g, "");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  fileName: sourcePath,
}).outputText;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-activity-timeline-"));
const tmpFile = path.join(tmpDir, "chatActivityTimeline.cjs");
fs.writeFileSync(tmpFile, compiled, "utf8");
const { ensureTerminalAnswerStep, isLowSignalCompletedActivityStep } = require(tmpFile);

const deepseekTimelineWithoutAnswer = [
  { id: "waiting_provider:completed", kind: "waiting_provider", status: "completed", startedAt: 1000, endedAt: 11000 },
  { id: "web_search:completed", kind: "web_search", status: "completed", startedAt: 11000, endedAt: 19000, count: 8 },
  { id: "reasoning:completed", kind: "reasoning", status: "completed", startedAt: 19000, endedAt: 34000 },
];
const completed = ensureTerminalAnswerStep({
  timeline: deepseekTimelineWithoutAnswer,
  hasAnswer: true,
  completedAt: 36000,
  generationStartedAt: 1000,
});
assert.deepEqual(completed.map((step) => `${step.kind}:${step.status}`), [
  "waiting_provider:completed",
  "web_search:completed",
  "reasoning:completed",
  "streaming_answer:completed",
]);
assert.equal(completed.at(-1).startedAt, 34000);
assert.equal(completed.at(-1).endedAt, 36000);

const alreadyHasAnswer = ensureTerminalAnswerStep({
  timeline: [{ id: "streaming_answer:completed", kind: "streaming_answer", status: "completed", startedAt: 1, endedAt: 1 }],
  hasAnswer: true,
  completedAt: 2,
});
assert.equal(alreadyHasAnswer.length, 1, "should not duplicate existing answer completion step");

assert.equal(isLowSignalCompletedActivityStep({ id: "streaming_answer:completed", kind: "streaming_answer", status: "completed", startedAt: 10, endedAt: 10 }, 10), false, "answer completion must stay visible even if short");
assert.equal(isLowSignalCompletedActivityStep({ id: "waiting_provider:completed", kind: "waiting_provider", status: "completed", startedAt: 10, endedAt: 10 }, 10), true, "short waiting provider remains low-signal");

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log("chat activity timeline regression tests passed");
