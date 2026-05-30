#!/usr/bin/env node
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { chromium } = require("playwright");

const baseUrl = process.env.PERF_BASE_URL || "http://127.0.0.1:3000";

function fmtMs(value) {
  return `${Number(value).toFixed(2)}ms`;
}

async function runScenario(browser, scenario) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const failedRequests = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
  });

  try {
    const url = `${baseUrl}/test-chat-performance/?mode=stream&count=${scenario.count}&deltas=${scenario.deltas}&deltaInterval=${scenario.deltaInterval}&hasMore=0`;
    const start = performance.now();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    assert.ok(response && response.status() < 400, `unexpected status ${response?.status()} for ${url}`);
    await page.waitForSelector('[data-testid="chat-performance-fixture"]', { timeout: 20_000 });
    const fixtureReadyMs = performance.now() - start;
    const metricsHandle = await page.waitForSelector('[data-testid="chat-stream-render-metrics"]', { timeout: 30_000 });
    const totalElapsedMs = performance.now() - start;
    const metrics = JSON.parse(await metricsHandle.getAttribute("data-metrics"));
    const runtimeState = await page.evaluate(() => ({
      visibleMessageRows: document.querySelectorAll('[data-testid="virtuoso-item-list"] > *').length,
      allElements: document.querySelectorAll("*").length,
      bodyTextLength: document.body.innerText.length,
    }));
    assert.equal(metrics.deltaCount, scenario.deltas);
    assert.ok(runtimeState.visibleMessageRows > 0, "expected rendered virtuoso rows during streaming benchmark");
    return {
      name: `browser.streaming.${scenario.count}x${scenario.deltas}`,
      metrics: { fixtureReadyMs, totalElapsedMs, ...metrics, ...runtimeState, consoleErrors: errors.length, failedRequests: failedRequests.length },
      errors,
      failedRequests,
    };
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const scenarios = [
    { count: 500, deltas: 240, deltaInterval: 16 },
    { count: 3000, deltas: 240, deltaInterval: 16 },
  ];
  const results = [];
  try {
    for (const scenario of scenarios) {
      results.push(await runScenario(browser, scenario));
    }
  } finally {
    await browser.close();
  }

  console.log("chat browser render performance results");
  for (const result of results) {
    const m = result.metrics;
    console.log(`- ${result.name}: fixtureReadyMs=${fmtMs(m.fixtureReadyMs)} totalElapsedMs=${fmtMs(m.totalElapsedMs)} streamElapsedMs=${fmtMs(m.elapsedMs)} frameCount=${m.frameCount} avgFrameGap=${fmtMs(m.avgFrameGap)} maxFrameGap=${fmtMs(m.maxFrameGap)} longFrameCount=${m.longFrameCount} longTaskCount=${m.longTaskCount} longTaskDuration=${fmtMs(m.longTaskDuration)} visibleMessageRows=${m.visibleMessageRows} allElements=${m.allElements} bodyTextLength=${m.bodyTextLength} consoleErrors=${m.consoleErrors} failedRequests=${m.failedRequests}`);
    if (result.errors.length) console.log(`  errors: ${result.errors.slice(0, 3).join(" | ")}`);
    if (result.failedRequests.length) console.log(`  failedRequests: ${result.failedRequests.slice(0, 3).join(" | ")}`);
  }
})();
