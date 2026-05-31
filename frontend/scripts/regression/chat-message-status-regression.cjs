#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(projectRoot, "lib/messageStatus.ts");
let source = fs.readFileSync(sourcePath, "utf8");
source = source.replace(/import type \{[^;]+\} from "\.\/chatTypes";\n/g, "");
source = source.replace(/import type \{[^;]+\} from "\.\/streaming";\n/g, "");
source = source.replace(/import \{ getActivityLabel \} from "\.\/chatActivityStatus";\n/g, `
function getActivityLabel(t, kind, status, label) {
  if (status === "completed") {
    if (kind === "web_search") return t("chat.status.webSearchDone");
    if (kind === "file_search") return t("chat.status.fileSearchDone");
    if (kind === "tool_call") return t("chat.status.toolCallDone");
  }
  if (label) return label;
  if (kind === "web_search") return t("chat.status.webSearch");
  if (kind === "file_search") return t("chat.status.fileSearch");
  if (kind === "tool_call") return t("chat.status.toolCall");
  return t("chat.status.generating");
}
`);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  fileName: sourcePath,
}).outputText;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "message-status-regression-"));
const tmpFile = path.join(tmpDir, "messageStatus.cjs");
fs.writeFileSync(tmpFile, compiled, "utf8");
const { deriveMessageStatuses } = require(tmpFile);
const t = (key) => key;
const base = { id: "m1", role: "assistant", content: "", createdAt: 1 };

function kinds(input) {
  return deriveMessageStatuses({ message: { ...base, ...input.message }, realtime: input.realtime, isStreaming: !!input.isStreaming, t }).map((status) => `${status.kind}:${status.phase}:${status.active}`);
}

assert.deepEqual(kinds({ message: { errorCode: "rate_limit" }, isStreaming: true }), ["error:failed:false"], "error should suppress generating");
assert.deepEqual(kinds({ message: { stopped: true, activityStatus: { kind: "generating", status: "running", label: "running" } }, isStreaming: true }), ["stopped:stopped:false"], "stopped should suppress running");
assert.deepEqual(kinds({ message: { searchStatus: "searching" }, isStreaming: true }), ["web_search:running:true"], "searching should render as active web search");
assert.deepEqual(kinds({ message: { searchStatus: "completed", searchSourcesCount: 2, activityStatus: { kind: "generating", status: "running", label: "running" } }, isStreaming: true }), ["web_search:completed:false", "generating:running:true"], "search completed can precede generating");
assert.deepEqual(kinds({ message: {}, realtime: { content: "", phase: "finalizing" }, isStreaming: true }), ["finalizing:running:true"], "phase finalizing should render as active finalizing");
assert.deepEqual(kinds({ message: { completedAt: 2 }, isStreaming: false }), [], "completed refreshed message should not show running by default");
assert.deepEqual(kinds({ message: {}, realtime: { content: "", searchStatus: "failed" }, isStreaming: true }), ["web_search:failed:false"], "failed search should not be active");
assert.deepEqual(kinds({ message: { searchStatus: "searching" }, realtime: { errorCode: "provider_error", searchStatus: "searching" }, isStreaming: true }), ["error:failed:false"], "realtime error should suppress search badges");
assert.deepEqual(kinds({ message: { completedAt: 2, searchSourcesCount: 1 }, isStreaming: false }), ["web_search:completed:false"], "completed history with sources should keep completed search badge only");

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log("chat message status regression tests passed");
