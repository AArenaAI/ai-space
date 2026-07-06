#!/usr/bin/env node
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../lib/chatTargetHref.ts')).href;
  const { buildChatTargetHref } = await import(moduleUrl);

  const cases = [
    {
      name: 'plain chat conversation',
      input: { conversationId: 42 },
      expected: '/chat?id=42',
    },
    {
      name: 'message target',
      input: { conversationId: 42, messageId: 99 },
      expected: '/chat?id=42&message=99',
    },
    {
      name: 'block target requires message target',
      input: { conversationId: 42, blockId: 'msg:3' },
      expected: '/chat?id=42',
    },
    {
      name: 'message block target',
      input: { conversationId: 42, messageId: 99, blockId: 'message-99:3' },
      expected: '/chat?id=42&message=99&block=message-99%3A3',
    },
    {
      name: 'skill chat message block target',
      input: { conversationId: 42, skillKey: 'translator', messageId: 99, blockId: 'message-99:3' },
      expected: '/skills/chat?key=translator&id=42&message=99&block=message-99%3A3',
    },
    {
      name: 'empty block ignored',
      input: { conversationId: 42, messageId: 99, blockId: '   ' },
      expected: '/chat?id=42&message=99',
    },
  ];

  for (const item of cases) {
    assert.equal(buildChatTargetHref(item.input), item.expected, item.name);
  }

  console.log(JSON.stringify({ ok: true, cases: cases.length }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
