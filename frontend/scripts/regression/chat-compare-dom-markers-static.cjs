#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const row = fs.readFileSync(path.join(repoRoot, 'components/chat/ChatCompareGroupRow.tsx'), 'utf8');
const column = fs.readFileSync(path.join(repoRoot, 'components/chat/CompareColumnTurn.tsx'), 'utf8');

assert.match(row, /data-chat-compare-group="true"/, 'compare group row must expose group marker');
assert.match(row, /data-chat-compare-group-id=\{group\.id\}/, 'compare group row must expose group id');
assert.match(row, /data-chat-compare-user-message-id=\{group\.userMessage\.serverMessageId \?\? group\.userMessage\.id\}/, 'compare group row must expose user message id');
assert.match(row, /data-chat-compare-column-index=\{colIndex\}/, 'compare column shell must expose column index');
assert.match(row, /data-chat-compare-column-model=\{modelId \|\| undefined\}/, 'compare column shell must expose column model');
assert.match(row, /data-chat-compare-assistant-message-id=\{assistant\?\.serverMessageId \?\? assistant\?\.id\}/, 'compare column shell must expose assistant id');
assert.match(column, /data-chat-compare-column-turn="true"/, 'compare column turn must expose turn marker');

console.log('chat compare DOM markers static regression passed');
