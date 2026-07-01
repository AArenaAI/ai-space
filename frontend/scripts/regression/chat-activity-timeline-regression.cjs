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
const { isLowSignalCompletedActivityStep } = require(tmpFile);

assert.equal(isLowSignalCompletedActivityStep({ id: "streaming_answer:completed", kind: "streaming_answer", status: "completed", startedAt: 10, endedAt: 10 }, 10), true, "answer completion is low-signal in the user-facing Activity panel");
assert.equal(isLowSignalCompletedActivityStep({ id: "waiting_provider:completed", kind: "waiting_provider", status: "completed", startedAt: 10, endedAt: 10 }, 10), true, "completed waiting provider is low-signal");
assert.equal(isLowSignalCompletedActivityStep({ id: "finalizing:completed", kind: "finalizing", status: "completed", startedAt: 10, endedAt: 20_000 }, 20_000), true, "completed finalizing is low-signal even when long");
assert.equal(isLowSignalCompletedActivityStep({ id: "web_search:completed", kind: "web_search", status: "completed", startedAt: 10, endedAt: 10 }, 10), false, "search completion remains user-facing because it carries source count/context");
assert.equal(isLowSignalCompletedActivityStep({ id: "reasoning:completed", kind: "reasoning", status: "completed", startedAt: 10, endedAt: 10 }, 10), false, "reasoning remains user-facing");
assert.equal(isLowSignalCompletedActivityStep({ id: "streaming_answer:running", kind: "streaming_answer", status: "running", startedAt: 10 }, 20_000), false, "running answer generation remains useful while active");

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log("chat activity timeline regression tests passed");
