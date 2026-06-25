#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '../..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-bootstrap-coordinator-'));
const outFile = path.join(tempDir, 'chatBootstrapCoordinator.cjs');
const source = fs.readFileSync(path.join(repoRoot, 'lib/chatBootstrapCoordinator.ts'), 'utf8');
fs.writeFileSync(outFile, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText);
const coordinator = require(outFile);

function jsonResponse(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] || headers[name] || null },
    json: async () => body,
  };
}

async function testRetries429UsingRetryAfter() {
  let calls = 0;
  const sleeps = [];
  const payload = { auth_status: 'authenticated', conversation: { id: 7 }, snapshot: { messages: [], total: 0 } };
  const result = await coordinator.fetchChatBootstrap({
    conversationId: 7,
    token: 'tok',
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(429, { error: 'too many' }, { 'retry-after': '0.05' });
      return jsonResponse(200, payload);
    },
    sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); },
  });
  assert.equal(calls, 2);
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] >= 50, `expected retry-after sleep >=50ms, got ${sleeps[0]}`);
  assert.deepEqual(result, payload);
}

async function testDedupeConcurrentIdenticalBootstrapRequests() {
  let calls = 0;
  let resolveFetch;
  const payload = { auth_status: 'authenticated', conversation: { id: 8 }, snapshot: { messages: [], total: 0 } };
  const fetchPromise = new Promise((resolve) => { resolveFetch = resolve; });
  const fetchImpl = async () => {
    calls += 1;
    await fetchPromise;
    return jsonResponse(200, payload);
  };
  const first = coordinator.fetchChatBootstrap({ conversationId: 8, token: 'tok', fetchImpl });
  const second = coordinator.fetchChatBootstrap({ conversationId: 8, token: 'tok', fetchImpl });
  resolveFetch();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(a, payload);
  assert.deepEqual(b, payload);
}

async function testDoesNotDedupeAbortedSignalRequests() {
  let calls = 0;
  const payload = { auth_status: 'authenticated', conversation: { id: 9 }, snapshot: { messages: [], total: 0 } };
  const controller = new AbortController();
  await Promise.all([
    coordinator.fetchChatBootstrap({ conversationId: 9, token: 'tok', signal: controller.signal, fetchImpl: async () => { calls += 1; return jsonResponse(200, payload); } }),
    coordinator.fetchChatBootstrap({ conversationId: 9, token: 'tok', signal: controller.signal, fetchImpl: async () => { calls += 1; return jsonResponse(200, payload); } }),
  ]);
  assert.equal(calls, 2);
}

(async () => {
  await testRetries429UsingRetryAfter();
  await testDedupeConcurrentIdenticalBootstrapRequests();
  await testDoesNotDedupeAbortedSignalRequests();
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('chat bootstrap coordinator regression passed');
})().catch((error) => {
  console.error(error);
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.exit(1);
});
