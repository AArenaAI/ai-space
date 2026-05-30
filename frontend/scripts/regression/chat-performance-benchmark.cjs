#!/usr/bin/env node
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { chromium } = require("playwright");

const baseUrl = process.env.PERF_BASE_URL || "http://127.0.0.1:3000";
const shouldRunBrowser = process.env.PERF_BROWSER !== "0";

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

function buildLoadMorePage({ totalMessages, loadedPersistedMessages, defaultLimit = 50 }) {
  const limit = defaultLimit;
  const offset = Math.max(0, totalMessages - loadedPersistedMessages - limit);
  const expectedOlderCount = Math.max(0, totalMessages - loadedPersistedMessages - offset);
  return { limit, offset, expectedOlderCount, requestLimit: expectedOlderCount || limit };
}

function prependUniqueOlderMessages(currentMessages, olderMessages) {
  const existingIds = new Set(currentMessages.map((message) => message.serverMessageId).filter(Boolean));
  const newOnes = olderMessages.filter((message) => {
    if (!message.serverMessageId || existingIds.has(message.serverMessageId)) return false;
    existingIds.add(message.serverMessageId);
    return true;
  });
  return [...newOnes, ...currentMessages];
}

function buildMessages(count, { longEvery = 10, contentMultiplier = 120 } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const isUser = index % 2 === 0;
    const round = Math.floor(index / 2) + 1;
    const isLong = !isUser && longEvery > 0 && round % longEvery === 0;
    return {
      id: `m-${index + 1}`,
      role: isUser ? "user" : "assistant",
      serverMessageId: index + 1,
      content: isUser
        ? `用户消息 ${round}`
        : isLong
          ? `# 长回复 ${round}\n\n${"长 Markdown 内容，含 **粗体**、列表、代码和表格。\n".repeat(contentMultiplier)}`
          : `助手回复 ${round}\n\n- a\n- b`,
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
    if (message.role === "assistant") {
      if (!current) {
        current = { id: message.groupId || message.serverMessageId || groups.length + 1, userMessage: message, assistantMessages: [], models: [] };
        groups.push(current);
      }
      current.assistantMessages.push(message);
      if (message.model && !current.models.includes(message.model)) current.models.push(message.model);
    }
  }
  return groups;
}

function visibleMessages(messages, groupViews = new Map()) {
  const groups = inferGroups(messages);
  const groupByMessageId = new Map();
  for (const group of groups) {
    groupByMessageId.set(group.userMessage.id, group);
    for (const assistant of group.assistantMessages) groupByMessageId.set(assistant.id, group);
  }
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

function runSyntheticBenchmarks() {
  const results = [];

  for (const totalMessages of [500, 1000, 3000, 10000]) {
    const page = buildLoadMorePage({ totalMessages, loadedPersistedMessages: 50 });
    assert.equal(page.requestLimit, 50);
    assert.equal(page.offset, totalMessages - 100);
    results.push({ name: `pagination.${totalMessages}`, metrics: { offset: page.offset, requestLimit: page.requestLimit } });
  }

  for (const count of [1000, 3000, 10000]) {
    const current = buildMessages(50).map((message, index) => ({ ...message, serverMessageId: count - 49 + index }));
    const older = buildMessages(50).map((message, index) => ({ ...message, serverMessageId: count - 99 + index }));
    const duplicateOlder = [...older, { ...older[0] }, { ...older[1], serverMessageId: current[0].serverMessageId }];
    const runs = [];
    for (let i = 0; i < 200; i += 1) {
      const start = now();
      const merged = prependUniqueOlderMessages(current, duplicateOlder);
      assert.equal(merged.length, 100);
      runs.push(now() - start);
    }
    results.push({ name: `loadMore.merge.${count}`, metrics: summarize(runs) });
  }

  for (const count of [1000, 3000, 10000]) {
    const messages = buildMessages(count, { longEvery: 12, contentMultiplier: 80 });
    const groupRuns = [];
    const visibleRuns = [];
    for (let i = 0; i < 50; i += 1) {
      let start = now();
      const groups = inferGroups(messages);
      groupRuns.push(now() - start);
      assert.equal(groups.length, Math.ceil(count / 2));

      start = now();
      const visible = visibleMessages(messages);
      visibleRuns.push(now() - start);
      assert.equal(visible.length, count);
    }
    results.push({ name: `messageList.inferGroups.${count}`, metrics: summarize(groupRuns) });
    results.push({ name: `messageList.visibleMessages.${count}`, metrics: summarize(visibleRuns) });
  }

  for (const count of [1000, 3000, 10000]) {
    const messages = buildMessages(count, { longEvery: 5, contentMultiplier: 160 });
    const start = now();
    const longCount = messages.filter((message) => message.role === "assistant" && message.content.length >= 4000).length;
    const shortCount = messages.length - longCount;
    const elapsed = now() - start;
    results.push({ name: `markdown.thresholdScan.${count}`, metrics: { elapsed, longCount, shortCount } });
  }

  return results;
}

async function runBrowserBenchmarks() {
  if (!shouldRunBrowser) return [];
  const browser = await chromium.launch({ headless: true });
  const scenarios = [
    { count: 1000, longEvery: 10 },
    { count: 3000, longEvery: 10 },
  ];
  const results = [];
  try {
    for (const scenario of scenarios) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      page.on("pageerror", (err) => errors.push(err.message));
      const url = `${baseUrl}/test-chat-performance/?count=${scenario.count}&longEvery=${scenario.longEvery}`;
      const start = now();
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      const domContentLoadedMs = now() - start;
      assert.ok(response && response.status() < 400, `unexpected status ${response?.status()} for ${url}`);
      await page.waitForSelector('[data-testid="chat-performance-fixture"]', { timeout: 20_000 });
      const fixtureReadyMs = now() - start;
      await page.waitForTimeout(1_200);
      const settleMs = now() - start;
      const metrics = await page.evaluate(() => {
        const bodyTextLength = document.body.innerText.length;
        const markdownSkeletons = document.querySelectorAll('.animate-pulse').length;
        const renderedCodeBlocks = document.querySelectorAll('pre, code').length;
        const visibleMessageRows = Array.from(document.querySelectorAll('[data-testid="virtuoso-item-list"] > *')).length;
        const allElements = document.querySelectorAll('*').length;
        const nav = performance.getEntriesByType('navigation')[0];
        return {
          bodyTextLength,
          markdownSkeletons,
          renderedCodeBlocks,
          visibleMessageRows,
          allElements,
          loadEventEnd: nav ? nav.loadEventEnd : 0,
          domInteractive: nav ? nav.domInteractive : 0,
        };
      });
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
      await page.waitForTimeout(200);
      const afterTopScroll = await page.evaluate(() => ({ text: document.body.innerText.slice(0, 120), elements: document.querySelectorAll('*').length }));
      results.push({
        name: `browser.fixture.${scenario.count}`,
        metrics: { domContentLoadedMs, fixtureReadyMs, settleMs, ...metrics, afterTopScrollElements: afterTopScroll.elements, consoleErrors: errors.length },
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}

function printResults(results) {
  console.log("chat performance benchmark results");
  for (const result of results) {
    const metricText = Object.entries(result.metrics)
      .map(([key, value]) => {
        if (typeof value === "number" && /ms|elapsed|p50|p95|avg|min|max/.test(key)) return `${key}=${fmtMs(value)}`;
        return `${key}=${typeof value === "number" ? Number(value.toFixed ? value.toFixed(2) : value) : value}`;
      })
      .join(" ");
    console.log(`- ${result.name}: ${metricText}`);
  }
}

(async () => {
  const synthetic = runSyntheticBenchmarks();
  const browserResults = await runBrowserBenchmarks();
  const results = [...synthetic, ...browserResults];
  printResults(results);
})();
