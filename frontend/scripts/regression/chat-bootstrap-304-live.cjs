#!/usr/bin/env node
const { authHeaders, env, login, printResult } = require('./chat-live-utils.cjs');

(async () => {
  const baseUrl = env('TESTNET_BASE_URL', 'https://testnet.ai-space.xyz');
  const conversationId = Number(env('TESTNET_CONVERSATION_ID') || env('CONVERSATION_ID') || 909);
  const auth = await login({ baseUrl });
  const first = await fetch(`${baseUrl}/api/chat/bootstrap?id=${conversationId}&message_tail=32&conversation_limit=30`, {
    headers: { ...authHeaders(auth) },
  });
  const data = await first.json();
  const version = data?.snapshot?.snapshot_version;
  const second = await fetch(`${baseUrl}/api/chat/bootstrap?id=${conversationId}&message_tail=32&conversation_limit=30`, {
    headers: { ...authHeaders(auth), 'If-None-Match': version || '' },
  });
  const secondText = await second.text();
  const quoted = await fetch(`${baseUrl}/api/chat/bootstrap?id=${conversationId}&message_tail=32&conversation_limit=30`, {
    headers: { ...authHeaders(auth), 'If-None-Match': `"${version || ''}"` },
  });
  const quotedText = await quoted.text();
  const result = {
    conversationId,
    firstStatus: first.status,
    snapshotVersion: version,
    messageCount: data?.snapshot?.messages?.length || 0,
    total: data?.snapshot?.total || 0,
    secondStatus: second.status,
    secondBodyLength: secondText.length,
    quotedStatus: quoted.status,
    quotedBodyLength: quotedText.length,
  };
  result.ok = first.status === 200 && Boolean(version) && second.status === 304 && secondText.length === 0 && quoted.status === 304 && quotedText.length === 0;
  printResult(result);
  if (!result.ok) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
