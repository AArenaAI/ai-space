#!/usr/bin/env node
const { chromium } = require("playwright");

const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const paths = (process.env.SMOKE_PATHS || "/,/chat/,/test-md,/image/chat,/video/chat,/settings")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ignoredConsoleErrors = [
  // Browser console messages for failed resources often omit the URL. The
  // response listener below records the actual failed URL and only ignores
  // explicit backend/API misses, so this generic console line is redundant.
  /Failed to load resource: the server responded with a status of 404 \(Not Found\)/,
  /fetch image chats error:/,
  /fetch video chats error:/,
];

function isIgnorable404(text) {
  return /\/api\//.test(text) || /favicon\.ico/.test(text);
}

const ignoredRequestFailures = [
  /\/api\//,
  /favicon\.ico/,
  /ERR_ABORTED/,
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const ignoredIssues = [];

  try {
    for (const path of paths) {
      const page = await browser.newPage();
      const url = new URL(path, baseUrl).toString();
      const pageIssues = [];
      const pageIgnoredIssues = [];

      const recordConsoleError = (text) => {
        if (ignoredConsoleErrors.some((re) => re.test(text)) || isIgnorable404(text)) {
          pageIgnoredIssues.push(`ignored console.error: ${text}`);
        } else {
          pageIssues.push(`console.error: ${text}`);
        }
      };

      page.on("console", (msg) => {
        if (msg.type() === "error") {
          recordConsoleError(msg.text());
        }
      });

      page.on("pageerror", (err) => {
        pageIssues.push(`pageerror: ${err.message}`);
      });

      page.on("requestfailed", (request) => {
        const failure = request.failure();
        const text = `${request.method()} ${request.url()} ${failure?.errorText || "request failed"}`;
        if (ignoredRequestFailures.some((re) => re.test(text))) {
          pageIgnoredIssues.push(`ignored requestfailed: ${text}`);
        } else {
          pageIssues.push(`requestfailed: ${text}`);
        }
      });

      page.on("response", (response) => {
        const status = response.status();
        const responseUrl = response.url();
        if (status >= 400) {
          const issue = `response ${status}: ${responseUrl}`;
          if (isIgnorable404(responseUrl)) pageIgnoredIssues.push(`ignored ${issue}`);
          else pageIssues.push(issue);
        }
      });

      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const status = response?.status() || 0;
      if (status >= 400) {
        pageIssues.push(`http status ${status}`);
      }

      await page.waitForTimeout(1_500);
      const title = await page.title().catch(() => "");
      const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
      if (!bodyText.trim()) {
        pageIssues.push("empty body text");
      }

      if (pageIssues.length) {
        failures.push({ path, title, issues: pageIssues });
        console.log(`✗ ${path}`);
        pageIssues.slice(0, 16).forEach((issue) => console.log(`  - ${issue}`));
        if (pageIssues.length > 16) console.log(`  - ... ${pageIssues.length - 16} more`);
      } else {
        console.log(`✓ ${path} (${status}) ${title}`);
      }

      if (pageIgnoredIssues.length) {
        ignoredIssues.push({ path, issues: pageIgnoredIssues });
      }

      await page.close();
    }
  } finally {
    await browser.close();
  }

  if (ignoredIssues.length) {
    console.log("\nignored backend/API smoke issues:");
    ignoredIssues.forEach(({ path, issues }) => {
      console.log(`- ${path}`);
      issues.slice(0, 8).forEach((issue) => console.log(`  · ${issue}`));
      if (issues.length > 8) console.log(`  · ... ${issues.length - 8} more`);
    });
  }

  if (failures.length) {
    console.error(`\nbrowser smoke failed: ${failures.length} page(s) had issues`);
    process.exit(1);
  }

  console.log("\nbrowser smoke passed");
})();
