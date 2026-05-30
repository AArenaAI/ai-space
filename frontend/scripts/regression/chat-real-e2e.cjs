#!/usr/bin/env node
const http = require("node:http");
const { chromium } = require("playwright");

const apiBaseUrl = trimTrailingSlash(process.env.REAL_CHAT_API_BASE_URL || "http://127.0.0.1:9091");
const frontendBaseUrl = trimTrailingSlash(process.env.REAL_CHAT_FRONTEND_BASE_URL || "http://127.0.0.1:3000");
const model = process.env.REAL_CHAT_MODEL || "gpt-5.4-mini";
const reasoningEnabled = process.env.REAL_CHAT_REASONING === "1";
const requireReasoning = process.env.REAL_CHAT_REQUIRE_REASONING === "1";
const requireStreamReasoning = process.env.REAL_CHAT_REQUIRE_STREAM_REASONING === "1" || requireReasoning;
const requirePersistedReasoning = process.env.REAL_CHAT_REQUIRE_PERSISTED_REASONING === "1" || requireReasoning;
const reasoningEffort = process.env.REAL_CHAT_REASONING_EFFORT || "standard";
const searchEnabled = process.env.REAL_CHAT_SEARCH === "1";
const prompt = process.env.REAL_CHAT_PROMPT || (reasoningEnabled
  ? "真实E2E思考验证：请先进行非常简短的思考，然后正文只回答 OK 和数字 42。"
  : "真实E2E验证：请只回答 OK，然后给出数字 42。");
const expectedPattern = new RegExp(process.env.REAL_CHAT_EXPECT || "OK[\\s\\S]*42", "i");
const timeoutMs = Number(process.env.REAL_CHAT_TIMEOUT_MS || 120000);
const browserEnabled = process.env.REAL_CHAT_BROWSER !== "0";
const proxyPort = Number(process.env.REAL_CHAT_PROXY_PORT || 3210);
const startedAt = Date.now();

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function redact(value) {
  return String(value || "")
    .replace(/Bearer\s+[-._~+/=A-Za-z0-9]+/g, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9._-]+/g, "[REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/(api[_-]?key|token|password|secret)(["'=:\s]+)([^"'\s,}]+)/gi, "$1$2[REDACTED]");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchText(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  return { res, text };
}

async function registerUser() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `chat-real-e2e-${suffix}@example.test`;
  const password = `E2E-${suffix}-pw`;
  const { res, text } = await fetchText(`${apiBaseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: "Real Chat E2E" }),
  });
  assert(res.status === 201, `register failed: ${res.status} ${redact(text.slice(0, 500))}`);
  const data = JSON.parse(text);
  assert(data.token, "register response missing token");
  return { token: data.token, user: data.user, email };
}

async function createConversation(token) {
  const { res, text } = await fetchText(`${apiBaseUrl}/api/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: `真实E2E ${Date.now()}`, model }),
  });
  assert(res.status === 201, `conversation create failed: ${res.status} ${redact(text.slice(0, 500))}`);
  const data = JSON.parse(text);
  assert(data.id, "conversation create response missing id");
  return data;
}

function parseSseDataChunk(raw) {
  const lines = raw.split("\n");
  const dataLines = lines.filter((line) => line.startsWith("data:"));
  if (!dataLines.length) return "";
  return dataLines.map((line) => line.slice(5).trimStart()).join("\n");
}

async function runRealChatRequest(token, conversationId) {
  const body = {
    model,
    messages: [
      { role: "system", content: "你是一个用于端到端测试的助手。" },
      { role: "user", content: prompt },
    ],
    conversation_id: conversationId,
    stream: true,
    reasoning: reasoningEnabled,
    reasoning_effort: reasoningEffort,
    search: searchEnabled,
    template_id: 0,
  };

  const res = await fetch(`${apiBaseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const contentType = res.headers.get("content-type") || "";
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`chat request failed: ${res.status} ${redact(errorBody.slice(0, 800))}`);
  }
  assert(contentType.includes("text/event-stream"), `chat response is not event-stream: ${contentType}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let events = 0;
  let jsonEvents = 0;
  let done = false;
  let content = "";
  let reasoning = "";
  let metaConversationId;
  let assistantMessageId;
  let userMessageId;
  let generationTaskId;
  let lastGenerationStatus = "";
  let provider = "";

  while (Date.now() - startedAt < timeoutMs) {
    const { value, done: readerDone } = await reader.read();
    if (readerDone) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      const data = parseSseDataChunk(chunk);
      if (!data) continue;
      events += 1;
      if (data === "[DONE]") {
        done = true;
        continue;
      }
      let json;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      jsonEvents += 1;
      const delta = json.choices?.[0]?.delta || {};
      if (typeof delta.content === "string") content += delta.content;
      if (typeof delta.reasoning_content === "string") reasoning += delta.reasoning_content;
      if (typeof delta.reasoning === "string") reasoning += delta.reasoning;
      const task = json._generation_task;
      if (task) {
        metaConversationId ||= Number(task.conversation_id) || undefined;
        assistantMessageId ||= Number(task.assistant_message_id) || undefined;
        userMessageId ||= Number(task.user_message_id) || undefined;
        generationTaskId ||= Number(task.id || task.task_id) || undefined;
        lastGenerationStatus = String(task.status || lastGenerationStatus || "");
      }
      if (json.provider) provider = String(json.provider);
    }
    if (done) break;
  }

  assert(events > 0, "chat stream produced no SSE events");
  assert(jsonEvents > 0, "chat stream produced no JSON SSE events");
  assert(done, "chat stream did not emit [DONE]");
  assert(content.trim().length > 0, "chat stream produced empty assistant content");
  assert(expectedPattern.test(content), `assistant content did not match expected pattern ${expectedPattern}: ${JSON.stringify(content)}`);
  if (requireStreamReasoning) {
    assert(reasoning.trim().length > 0, "chat stream produced no reasoning content while reasoning is required");
  }
  assert(metaConversationId === conversationId, `stream conversation mismatch: ${metaConversationId} !== ${conversationId}`);
  assert(assistantMessageId, "stream metadata missing assistant_message_id");
  assert(userMessageId, "stream metadata missing user_message_id");
  assert(generationTaskId, "stream metadata missing generation task id");

  return {
    events,
    jsonEvents,
    done,
    content,
    reasoning,
    conversationId: metaConversationId,
    assistantMessageId,
    userMessageId,
    generationTaskId,
    lastGenerationStatus,
    provider,
  };
}

async function verifyTaskAndHistory(token, ids, expectedContent) {
  const taskUrl = `${apiBaseUrl}/api/chat/tasks/${ids.assistantMessageId}`;
  const taskRes = await fetch(taskUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!taskRes.ok) {
    const errorBody = await taskRes.text();
    throw new Error(`task status failed: ${taskRes.status} ${redact(errorBody.slice(0, 500))}`);
  }
  const taskData = await taskRes.json();
  const taskStatus = taskData.task?.status || taskData.background_task?.status || "";
  const taskContent = taskData.message?.content || taskData.task?.result || "";
  assert(taskStatus === "completed", `task is not completed: ${taskStatus}`);
  assert(expectedPattern.test(taskContent || expectedContent), "task/message content does not contain expected answer");

  const restoreRes = await fetch(`${apiBaseUrl}/api/conversations/${ids.conversationId}?message_tail=50`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!restoreRes.ok) {
    const errorBody = await restoreRes.text();
    throw new Error(`conversation restore failed: ${restoreRes.status} ${redact(errorBody.slice(0, 500))}`);
  }
  const restoreData = await restoreRes.json();
  const messages = Array.isArray(restoreData.messages) ? restoreData.messages : [];
  const userMessage = messages.find((m) => Number(m.id) === Number(ids.userMessageId) || (m.role === "user" && String(m.content || "").includes("真实E2E验证")));
  const assistantMessage = messages.find((m) => Number(m.id) === Number(ids.assistantMessageId) || (m.role === "assistant" && expectedPattern.test(String(m.content || ""))));
  assert(userMessage, "restored history missing user message");
  assert(assistantMessage, "restored history missing assistant message");
  assert(expectedPattern.test(String(assistantMessage.content || "")), "restored assistant content does not match expected answer");
  assert(assistantMessage.completed_at, "restored assistant message missing completed_at");
  const persistedReasoning = assistantMessage.reasoning_content || assistantMessage.reasoning || assistantMessage.thinking || "";
  if (requirePersistedReasoning) {
    assert(String(persistedReasoning).trim().length > 0, "restored assistant message missing persisted reasoning while persisted reasoning is required");
  }

  const countRes = await fetch(`${apiBaseUrl}/api/conversations/${ids.conversationId}/messages?limit=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(countRes.ok, `message count failed: ${countRes.status}`);
  const countData = await countRes.json();
  assert(Number(countData.total || 0) >= 2, `message count too small: ${JSON.stringify(countData)}`);

  return {
    taskStatus,
    restoredMessages: messages.length,
    totalMessages: countData.total,
    persistedReasoningLength: String(persistedReasoning).length,
    persistedAssistantCompletedAt: assistantMessage.completed_at,
  };
}

async function waitForHttpOk(url, timeout = 60000) {
  const deadline = Date.now() + timeout;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`timeout waiting for ${url}: ${lastError}`);
}

function startProxy() {
  const server = http.createServer((req, res) => {
    const targetBase = req.url.startsWith("/api/") ? apiBaseUrl : frontendBaseUrl;
    const target = new URL(req.url, targetBase);
    const headers = { ...req.headers, host: target.host };
    const proxyReq = http.request(target, { method: req.method, headers }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on("error", (err) => {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`proxy error: ${err.message}`);
    });
    req.pipe(proxyReq);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(proxyPort, "127.0.0.1", () => resolve(server));
  });
}

async function runBrowserHistoryE2E(token, user, conversationId, expectedContent, expectedReasoning = "") {
  await waitForHttpOk(`${frontendBaseUrl}/chat/`, 60000);
  const proxy = await startProxy();
  const proxyBase = `http://127.0.0.1:${proxyPort}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const issues = [];
  const ignoredIssues = [];
  const recordIssue = (issue) => {
    if (/ERR_ABORTED/.test(issue) && /\/api\/conversations\//.test(issue)) {
      ignoredIssues.push(issue);
      return;
    }
    issues.push(issue);
  };
  page.on("console", (msg) => { if (msg.type() === "error") issues.push(`console.error: ${msg.text()}`); });
  page.on("pageerror", (err) => issues.push(`pageerror: ${err.message}`));
  page.on("requestfailed", (request) => recordIssue(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`));
  page.on("response", (response) => {
    if (response.status() >= 400 && !/favicon\.ico/.test(response.url())) issues.push(`response ${response.status()}: ${response.url()}`);
  });
  try {
    await page.addInitScript(({ tokenValue, userValue, reasoningEffortValue, reasoningEnabledValue, searchEnabledValue }) => {
      localStorage.setItem("token", tokenValue);
      localStorage.setItem("user", JSON.stringify(userValue));
      localStorage.setItem("reasoning-mode", reasoningEffortValue);
      localStorage.setItem("reasoning-enabled", reasoningEnabledValue ? "true" : "false");
      localStorage.setItem("search-enabled", searchEnabledValue ? "true" : "false");
    }, {
      tokenValue: token,
      userValue: user || {},
      reasoningEffortValue: reasoningEffort,
      reasoningEnabledValue: reasoningEnabled,
      searchEnabledValue: searchEnabled,
    });
    const url = `${proxyBase}/chat/?id=${conversationId}`;
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    assert((response?.status() || 0) < 400, `browser chat history HTTP ${response?.status()}`);
    const expectedNeedle = expectedContent.trim().split(/\s+/)[0];
    try {
      await page.waitForFunction((needle) => document.body.innerText.includes(needle), expectedNeedle, { timeout: 30000 });
    } catch (err) {
      const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
      const currentUrl = page.url();
      throw new Error(`browser history wait failed for ${JSON.stringify(expectedNeedle)} at ${currentUrl}: ${err.message}\nbody=${JSON.stringify(bodyText.slice(0, 1200))}\nissues=${issues.slice(0, 12).join("\n")}`);
    }
    const bodyText = await page.locator("body").innerText({ timeout: 5000 });
    const promptNeedle = prompt.slice(0, 8);
    assert(bodyText.includes(promptNeedle), `browser history did not render user prompt: ${JSON.stringify(promptNeedle)}`);
    assert(expectedPattern.test(bodyText), "browser history did not render assistant answer");
    if (requirePersistedReasoning) {
      const reasoningNeedle = String(expectedReasoning || "").trim().split(/\s+/)[0];
      assert(reasoningNeedle && bodyText.includes(reasoningNeedle), `browser history did not render persisted reasoning: ${JSON.stringify(reasoningNeedle)}`);
    }
    assert(!/加载中\.\.\./.test(bodyText) || bodyText.length > 100, "browser appears stuck in loading state");
    assert(issues.length === 0, `browser issues:\n${issues.slice(0, 12).join("\n")}`);
    return { url, bodyTextLength: bodyText.length, ignoredIssues };
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolve) => proxy.close(resolve));
  }
}

(async () => {
  const report = {
    apiBaseUrl,
    frontendBaseUrl,
    model,
    reasoningEnabled,
    requireReasoning,
    requireStreamReasoning,
    requirePersistedReasoning,
    reasoningEffort,
    searchEnabled,
    browserEnabled,
    startedAt: new Date(startedAt).toISOString(),
  };
  try {
    const health = await fetch(`${apiBaseUrl}/health`);
    assert(health.ok, `backend health failed: ${health.status}`);
    const modelsRes = await fetch(`${apiBaseUrl}/api/models/chat`);
    assert(modelsRes.ok, `models failed: ${modelsRes.status}`);
    const models = await modelsRes.json();
    assert(Array.isArray(models) && models.some((m) => m.id === model), `model ${model} not found in chat models`);
    report.modelCount = models.length;

    const auth = await registerUser();
    report.userId = auth.user?.id;
    report.defaultWorkspaceId = auth.user?.default_workspace_id;
    const conversation = await createConversation(auth.token);
    report.conversationId = conversation.id;

    const stream = await runRealChatRequest(auth.token, conversation.id);
    Object.assign(report, {
      streamEvents: stream.events,
      streamJsonEvents: stream.jsonEvents,
      streamDone: stream.done,
      contentLength: stream.content.length,
      contentPreview: stream.content.slice(0, 120),
      reasoningLength: stream.reasoning.length,
      streamReasoningObserved: stream.reasoning.trim().length > 0,
      assistantMessageId: stream.assistantMessageId,
      userMessageId: stream.userMessageId,
      generationTaskId: stream.generationTaskId,
      provider: stream.provider,
      lastGenerationStatus: stream.lastGenerationStatus,
    });

    const persistence = await verifyTaskAndHistory(auth.token, stream, stream.content);
    Object.assign(report, persistence);

    if (browserEnabled) {
      const browser = await runBrowserHistoryE2E(auth.token, auth.user, stream.conversationId, stream.content, stream.reasoning);
      report.browserHistory = browser;
    }

    report.elapsedMs = Date.now() - startedAt;
    console.log(JSON.stringify(report, null, 2));
    console.log("chat real e2e passed");
  } catch (err) {
    console.error(redact(err.stack || err.message || err));
    if (Object.keys(report).length) console.error(redact(JSON.stringify(report, null, 2)));
    process.exit(1);
  }
})();
