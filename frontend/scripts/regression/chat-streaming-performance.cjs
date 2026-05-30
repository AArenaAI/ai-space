#!/usr/bin/env node
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");

function now() {
  return performance.now();
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarize(values) {
  return {
    min: Math.min(...values),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: Math.max(...values),
    avg: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

function fmtMs(value) {
  return `${value.toFixed(2)}ms`;
}

function buildHistory(count) {
  return Array.from({ length: count }, (_, index) => {
    const isUser = index % 2 === 0;
    return {
      id: `m-${index + 1}`,
      role: isUser ? "user" : "assistant",
      serverMessageId: index + 1,
      content: isUser ? `用户历史 ${index + 1}` : `助手历史 ${index + 1}\n\n- a\n- b`,
      createdAt: index,
      completedAt: isUser ? undefined : index + 1,
      model: isUser ? undefined : "perf-model",
    };
  });
}

function inferGroups(messages) {
  const groups = [];
  let current = null;
  for (const message of messages) {
    if (message.role === "user") {
      current = { id: message.serverMessageId || groups.length + 1, userMessage: message, assistantMessages: [], models: [] };
      groups.push(current);
      continue;
    }
    if (!current) {
      current = { id: message.groupId || message.serverMessageId || groups.length + 1, userMessage: message, assistantMessages: [], models: [] };
      groups.push(current);
    }
    current.assistantMessages.push(message);
    if (message.model && !current.models.includes(message.model)) current.models.push(message.model);
  }
  return groups;
}

function buildGroupByMessageId(groups) {
  const map = new Map();
  for (const group of groups) {
    map.set(group.userMessage.id, group);
    for (const assistant of group.assistantMessages) map.set(assistant.id, group);
  }
  return map;
}

function visibleMessages(messages, groupByMessageId, groupViews = new Map()) {
  return messages.filter((message) => {
    const group = groupByMessageId.get(message.id);
    if (message.role !== "user" && group && group.assistantMessages.length > 1) {
      const activeIndex = groupViews.get(group.id) ?? 0;
      const activeMessage = group.assistantMessages[activeIndex] ?? group.assistantMessages[0];
      return message.id === activeMessage?.id;
    }
    return true;
  });
}

function updateLastAssistantContent(messages, delta) {
  const next = messages.slice();
  const lastIndex = next.length - 1;
  const last = next[lastIndex];
  assert.equal(last.role, "assistant");
  next[lastIndex] = { ...last, content: `${last.content}${delta}` };
  return next;
}

function runStreamingScenario({ historyCount, deltaCount }) {
  let messages = [
    ...buildHistory(historyCount),
    {
      id: `m-stream-user-${historyCount}`,
      role: "user",
      serverMessageId: historyCount + 1,
      content: "请继续输出一段用于流式性能测试的内容",
      createdAt: historyCount + 1,
    },
    {
      id: `m-stream-${historyCount}`,
      role: "assistant",
      serverMessageId: historyCount + 2,
      content: "",
      createdAt: historyCount + 2,
      model: "perf-model",
    },
  ];

  const patchRuns = [];
  const groupRuns = [];
  const visibleRuns = [];
  const fullRuns = [];
  for (let i = 0; i < deltaCount; i += 1) {
    const fullStart = now();
    let start = now();
    messages = updateLastAssistantContent(messages, `delta-${i} `);
    patchRuns.push(now() - start);

    start = now();
    const groups = inferGroups(messages);
    groupRuns.push(now() - start);

    start = now();
    const groupByMessageId = buildGroupByMessageId(groups);
    const visible = visibleMessages(messages, groupByMessageId);
    visibleRuns.push(now() - start);
    fullRuns.push(now() - fullStart);
    assert.equal(visible.length, messages.length);
  }

  return {
    name: `streaming.delta.${historyCount}x${deltaCount}`,
    metrics: {
      patch: summarize(patchRuns),
      inferGroups: summarize(groupRuns),
      visibleMessages: summarize(visibleRuns),
      fullTick: summarize(fullRuns),
      finalContentLength: messages[messages.length - 1].content.length,
    },
  };
}

function flattenMetrics(metrics, prefix = "") {
  const entries = [];
  for (const [key, value] of Object.entries(metrics)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) entries.push(...flattenMetrics(value, name));
    else entries.push([name, value]);
  }
  return entries;
}

function printResults(results) {
  console.log("chat streaming performance results");
  for (const result of results) {
    const text = flattenMetrics(result.metrics)
      .map(([key, value]) => {
        if (typeof value === "number" && /ms|p50|p95|avg|min|max/.test(key)) return `${key}=${fmtMs(value)}`;
        return `${key}=${typeof value === "number" ? Number(value.toFixed ? value.toFixed(2) : value) : value}`;
      })
      .join(" ");
    console.log(`- ${result.name}: ${text}`);
  }
}

const results = [
  runStreamingScenario({ historyCount: 500, deltaCount: 240 }),
  runStreamingScenario({ historyCount: 3000, deltaCount: 240 }),
];

for (const result of results) {
  assert.ok(result.metrics.fullTick.p95 < 16, `${result.name} fullTick p95 too high: ${result.metrics.fullTick.p95}`);
  assert.ok(result.metrics.visibleMessages.p95 < 12, `${result.name} visibleMessages p95 too high: ${result.metrics.visibleMessages.p95}`);
}

printResults(results);
