#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const messageInput = fs.readFileSync(path.join(repoRoot, 'components/chat/MessageInput.tsx'), 'utf8');
const chatInterface = fs.readFileSync(path.join(repoRoot, 'components/chat/ChatInterface.tsx'), 'utf8');

function compact(source) {
  return source.replace(/\s+/g, ' ');
}

const inputOneLine = compact(messageInput);
const chatOneLine = compact(chatInterface);

assert.match(
  messageInput,
  /export type ChatComposerSendResult\s*=\s*\{\s*accepted:\s*boolean/s,
  'MessageInput should expose an accepted/rejected send result contract'
);
assert.match(
  messageInput,
  /onSend:\s*\([^)]*\)\s*=>\s*(?:Promise<ChatComposerSendResult>|ChatComposerSendResult)/,
  'MessageInput onSend should return ChatComposerSendResult so failed sends can keep the draft'
);
assert.match(
  inputOneLine,
  /sendResult = await onSend\(/,
  'MessageInput should await onSend before clearing composer state'
);
assert.match(
  messageInput,
  /data-testid="chat-composer-send-notice"/,
  'MessageInput should render a stable inline notice for rejected sends'
);
assert.match(
  inputOneLine,
  /const clearComposer = useCallback\(\(\) => \{.*setContent\(""\).*setAttachedFiles\(\[\]\).*\}, \[\]\)/,
  'MessageInput should centralize content/attachment clearing in clearComposer'
);
assert.match(
  inputOneLine,
  /if \(!sendResult\?\.accepted\) \{ setSendNotice\(sendResult\?\.notice \|\| "消息尚未发送，已为你保留输入内容。"\); return; \} clearComposer\(\);/,
  'MessageInput should only clear the composer after accepted=true and should show a retained-draft notice on rejection'
);

for (const snippet of [
  '当前内测批次暂未开放该模型',
  '账号未激活',
  'setCreditExhaustedOpen(true)',
  'chat.compareMinModels',
]) {
  const idx = chatInterface.indexOf(snippet);
  assert.notEqual(idx, -1, `Missing preflight snippet ${snippet}`);
  const nearby = chatInterface.slice(Math.max(0, idx - 420), idx + 520);
  assert.match(
    nearby,
    /return\s+\{\s*accepted:\s*false/s,
    `Preflight branch around ${snippet} should reject send without clearing composer`
  );
}

assert.match(
  chatOneLine,
  /window\.dispatchEvent\(new Event\("chat-composer-clear"\)\)/,
  'Confirmed deferred sends should clear the composer through chat-composer-clear event'
);

console.log('chat composer submit contract static regression passed');
