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
source = source.replace('import { resolveChatMessageRuntimeState } from "./chatMessageRuntimeState";\n', `
function isTerminalMessage(message) {
  return Boolean(message.completedAt || message.stopped || message.errorCode || message.serverGenerationStatus === "completed" || message.serverGenerationStatus === "failed" || message.serverGenerationStatus === "cancelled" || message.phase === "completed" || message.phase === "failed" || message.phase === "stopped");
}
function isTerminalRealtime(realtime) {
  return Boolean(realtime && (realtime.completedAt || realtime.stopped || realtime.errorCode || realtime.phase === "completed" || realtime.phase === "failed" || realtime.phase === "stopped"));
}
function resolveChatMessageRuntimeState({ message, realtime }) {
  const terminalFromMessage = isTerminalMessage(message);
  const terminalFromRealtime = isTerminalRealtime(realtime);
  if (terminalFromMessage) {
    return {
      terminal: true,
      terminalSource: "message",
      content: message.content || (realtime && realtime.content) || "",
      answerContent: message.content || (realtime && realtime.answerContent),
      reasoningContent: message.reasoningContent || (realtime && realtime.reasoningContent) || "",
      searchSources: message.searchSources || (realtime && realtime.searchSources) || [],
      searchSourcesCount: message.searchSourcesCount ?? (realtime && realtime.searchSourcesCount),
      searchStatus: message.searchStatus ?? (realtime && realtime.searchStatus),
      activityStatus: message.activityStatus,
      statusTimeline: message.statusTimeline,
      phase: message.phase || (message.completedAt ? "completed" : undefined),
      generationStartedAt: message.generationStartedAt || (realtime && realtime.generationStartedAt) || message.createdAt,
      completedAt: message.completedAt || (realtime && realtime.completedAt),
      stopped: message.stopped || (realtime && realtime.stopped),
      errorCode: message.errorCode || (realtime && realtime.errorCode),
      retryable: message.retryable ?? (realtime && realtime.retryable),
      requestId: message.requestId || (realtime && realtime.requestId),
    };
  }
  return {
    terminal: terminalFromRealtime,
    terminalSource: terminalFromRealtime ? "realtime" : undefined,
    content: (realtime && realtime.content) || message.content || "",
    answerContent: (realtime && realtime.answerContent) || message.content,
    reasoningContent: (realtime && realtime.reasoningContent) || message.reasoningContent || "",
    searchSources: (realtime && realtime.searchSources) || message.searchSources || [],
    searchSourcesCount: (realtime && realtime.searchSourcesCount) ?? message.searchSourcesCount,
    searchStatus: (realtime && realtime.searchStatus) ?? message.searchStatus,
    activityStatus: (realtime && realtime.activityStatus) ?? message.activityStatus,
    statusTimeline: (realtime && realtime.statusTimeline) || message.statusTimeline,
    phase: (realtime && realtime.phase) || message.phase,
    generationStartedAt: (realtime && realtime.generationStartedAt) || message.generationStartedAt || message.createdAt,
    completedAt: (realtime && realtime.completedAt) || message.completedAt,
    stopped: (realtime && realtime.stopped) || message.stopped,
    errorCode: (realtime && realtime.errorCode) || message.errorCode,
    retryable: (realtime && realtime.retryable) ?? message.retryable,
    requestId: (realtime && realtime.requestId) || message.requestId,
  };
}
`);
source = source.replace('import { buildFallbackCompletedTimeline, getCompletedStatusLabel, type ChatStatusTimelineStep } from "./chatStatusTimeline";\n', `
function getCompletedStatusLabel(t, generationStartedAt, completedAt) {
  if (generationStartedAt && completedAt) return t("chat.status.completedWithElapsed", { elapsed: String(Math.max(0, Math.floor((completedAt - generationStartedAt) / 1000))) + "秒" });
  return t("chat.status.completed");
}
function buildFallbackCompletedTimeline({ generationStartedAt, completedAt, searchSourcesCount, hasReasoning, hasAnswer }) {
  const start = generationStartedAt || completedAt || Date.now();
  const end = completedAt || start;
  const steps = [{ id: "waiting_provider:running", kind: "waiting_provider", status: "running", startedAt: start, endedAt: end }];
  if (searchSourcesCount) steps.push({ id: "web_search:completed", kind: "web_search", status: "completed", startedAt: start, endedAt: end, count: searchSourcesCount });
  if (hasReasoning) steps.push({ id: "reasoning:running", kind: "reasoning", status: "running", startedAt: start, endedAt: end });
  if (hasAnswer !== false) steps.push({ id: "streaming_answer:running", kind: "streaming_answer", status: "running", startedAt: start, endedAt: end });
  return steps;
}
`);
source = source.replace('import { deriveUserGenerationPhase, getGenerationPhaseWithElapsedLabel, type UserGenerationPhase } from "./chatGenerationPhase";\n', `
function normalizeRuntimePhase(phase) {
  if (phase === "waiting_provider" || phase === "starting") return "waiting_provider";
  if (phase === "searching") return "searching";
  if (phase === "reasoning" || phase === "thinking") return "reasoning";
  if (phase === "streaming_answer" || phase === "generating") return "streaming_answer";
  if (phase === "finalizing") return "finalizing";
  return undefined;
}
function deriveUserGenerationPhase(data, isStreaming = false) {
  if (data && data.completedAt) return undefined;
  const explicit = normalizeRuntimePhase(data && data.phase);
  if (explicit) return explicit;
  if (data && data.searchStatus === "searching") return "searching";
  if (data && (data.isReasoning || data.reasoningContent !== undefined)) return "reasoning";
  if (data && typeof data.answerContent === "string" && data.answerContent.length > 0) return "streaming_answer";
  if (data && typeof data.content === "string" && data.content.length > 0) return "streaming_answer";
  if (isStreaming) return "waiting_provider";
  return undefined;
}
function getGenerationPhaseWithElapsedLabel(t, phase, elapsedMs) {
  const keys = {
    waiting_provider: "chat.phase.waiting_provider",
    searching: "chat.phase.searching",
    reasoning: "chat.phase.reasoning",
    streaming_answer: "chat.phase.streaming_answer",
    finalizing: "chat.phase.finalizing",
  };
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  return t(keys[phase] || "chat.status.generating") + " · 已用时 " + seconds + "秒";
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
assert.deepEqual(kinds({ message: { searchStatus: "completed", searchSourcesCount: 2, activityStatus: { kind: "generating", status: "running", label: "running" } }, isStreaming: true }), ["generating:running:true"], "running generation phase should replace mixed legacy badges while streaming");
const waitingProviderStatus = deriveMessageStatuses({
  message: { ...base, createdAt: Date.now() - 2400 },
  realtime: { content: "", phase: "waiting_provider", generationStartedAt: Date.now() - 2400 },
  isStreaming: true,
  t,
})[0];
assert.equal(waitingProviderStatus.generationPhase, "waiting_provider", "phase badge should expose generation phase for fixture selectors");
assert.match(waitingProviderStatus.label, /chat\.phase\.waiting_provider · 已用时 \d+秒/, "phase badge should include elapsed time");
assert.deepEqual(kinds({ message: {}, realtime: { content: "", phase: "waiting_provider" }, isStreaming: true }), ["generating:running:true"], "waiting provider should use the same generation phase as body status");
assert.deepEqual(kinds({ message: {}, realtime: { content: "", phase: "reasoning", reasoningContent: "" }, isStreaming: true }), ["thinking:running:true"], "reasoning phase should match body status");
assert.deepEqual(kinds({ message: {}, realtime: { content: "answer", phase: "streaming_answer" }, isStreaming: true }), ["generating:running:true"], "answer streaming phase should match body status");
assert.deepEqual(kinds({ message: {}, realtime: { content: "", phase: "finalizing" }, isStreaming: true }), ["finalizing:running:true"], "phase finalizing should render as active finalizing");
assert.deepEqual(kinds({ message: { completedAt: 2 }, isStreaming: false }), ["completed:completed:false"], "completed refreshed message should show a final completed badge");
assert.deepEqual(kinds({ message: {}, realtime: { content: "", searchStatus: "failed" }, isStreaming: true }), ["web_search:failed:false"], "failed search should not be active");
assert.deepEqual(kinds({ message: { searchStatus: "searching" }, realtime: { errorCode: "provider_error", searchStatus: "searching" }, isStreaming: true }), ["error:failed:false"], "realtime error should suppress search badges");
assert.deepEqual(kinds({ message: { completedAt: 2, searchSourcesCount: 1 }, isStreaming: false }), ["completed:completed:false"], "completed history with sources should use one final badge; sources move into the timeline");
assert.deepEqual(kinds({
  message: { completedAt: 20, phase: "completed", serverGenerationStatus: "completed", reasoningContent: "done", statusTimeline: [{ id: "reasoning:completed", kind: "reasoning", status: "completed", startedAt: 1, endedAt: 20 }] },
  realtime: { content: "", phase: "reasoning", reasoningContent: "stale", activityStatus: { kind: "reasoning", status: "running", label: "正在推理" }, statusTimeline: [{ id: "reasoning:running", kind: "reasoning", status: "running", startedAt: 10 }] },
  isStreaming: false,
}), ["completed:completed:false"], "completed persisted message must suppress stale running realtime reasoning");

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log("chat message status regression tests passed");
