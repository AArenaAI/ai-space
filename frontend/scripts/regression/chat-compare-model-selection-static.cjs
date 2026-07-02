#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

const chatInterface = read('components/chat/ChatInterface.tsx');
const messageList = read('components/chat/MessageList.tsx');
const compareHeader = read('components/chat/ChatCompareHeader.tsx');
const compareColumnTurn = read('components/chat/CompareColumnTurn.tsx');

assert.ok(
  chatInterface.includes('const activeCompareModelIds = selectedModels.length > 0 ? selectedModels : compareModels;'),
  'Compare should prefer current selectedModels over restored compareModels for the next turn'
);
assert.ok(
  chatInterface.includes('setCompareModels(normalized);') && chatInterface.includes('persistCompareModelsForConversation(normalized);'),
  'Compare model changes should sync useChat state and persist to the conversation'
);
assert.ok(
  chatInterface.includes('body: JSON.stringify({ compare: true, compare_models: JSON.stringify(modelIds) })'),
  'Compare model persistence should PATCH conversation compare_models'
);
assert.ok(
  messageList.includes('return explicitModels.length >= 2 ? explicitModels : activeCompareModels;'),
  'Compare header should show explicit next-turn model selection before historical group models'
);
assert.ok(
  messageList.includes('compareModels={group.models.length >= 2 ? group.models : (activeCompareModels.length ? activeCompareModels : compareModels)}'),
  'Historical compare groups should keep their original round models'
);
assert.ok(compareHeader.includes('下一轮模型'), 'Compare header should label next-turn models');
assert.ok(compareColumnTurn.includes('本轮模型'), 'Historical compare columns should label actual round models');

console.log('chat compare model selection static regression passed');
