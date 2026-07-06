#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const pending = fs.readFileSync(path.join(repoRoot, 'components/chat/AssistantPendingShell.tsx'), 'utf8');
const content = fs.readFileSync(path.join(repoRoot, 'components/chat/AssistantMessageContent.tsx'), 'utf8');
const compare = fs.readFileSync(path.join(repoRoot, 'components/chat/CompareLoadingSlot.tsx'), 'utf8');

for (const forbidden of [
  'LoaderCircle',
  'animate-spin',
  'animate-ping',
  'ThinkingDots',
  'animate-bounce',
  'bg-brand/',
  '正在生成回答',
  '后台保持进度',
  'bg-surface-card/35',
  'bg-surface-elevated/70',
  'animate-shimmer',
  'min-h-[104px]',
  'min-h-[86px]',
]) {
  assert.equal(pending.includes(forbidden), false, `AssistantPendingShell should not contain ${forbidden}`);
}

assert.match(pending, /color-mix\(in srgb, var\(--text-secondary\) 60%, var\(--text-primary\) 40%\)/, 'breathing core should use adaptive visible neutral color');
assert.match(pending, /data-chat-pending-dot-core="true"/, 'breathing core should expose stable UI test marker');
assert.match(pending, /h-3\.5 w-3\.5/, 'breathing dot should be visibly larger than tiny status dots');
assert.match(pending, /animate-pulse/, 'pending state should breathe subtly');
assert.match(pending, /aria-label=\{accessibleLabel\}/, 'visual-only pending dot should keep an accessible label');

assert.match(content, /return <AssistantPendingShell \/>/, 'ordinary chat should use unlabeled breathing dot only');
assert.equal(content.includes('后台保持进度'), false, 'ordinary chat pending body should not duplicate background status');
assert.equal(content.includes('正在生成回答'), false, 'ordinary chat pending body should not duplicate generation status text');

assert.match(compare, /<AssistantPendingShell[\s\S]*showAvatar[\s\S]*compact/, 'compare pending slot should reuse compact breathing dot');
assert.equal(compare.includes('正在生成回答'), false, 'compare pending slot should not show generation text');
assert.equal(compare.includes('deepReasoningLabel :'), false, 'compare pending slot should not duplicate thinking labels in the answer body');

console.log('chat pending shell static regression passed');
