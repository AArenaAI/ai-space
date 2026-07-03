#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

const chatInterface = read('components/chat/ChatInterface.tsx');
const messageList = read('components/chat/MessageList.tsx');
const compareHeader = read('components/chat/ChatCompareHeader.tsx');
const compareModelHeader = read('components/chat/ChatCompareModelHeader.tsx');
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
  messageList.includes('compareModels={group.models.length > 0 ? group.models : (activeCompareModels.length ? activeCompareModels : compareModels)}')
    && messageList.includes('const isSingleModelGroup = group.models.length < 2 && group.assistantMessages.length <= 1'),
  'Historical compare groups should keep their original round models, while single-model normal groups stay left-aligned'
);
assert.ok(
  !compareHeader.includes('下一轮模型'),
  'Compare header should not show redundant next-turn text above every model selector'
);
assert.ok(
  compareHeader.includes('relative z-[90] w-full shrink-0 bg-surface/80 px-4 py-1')
    && !compareHeader.includes('border-b border-surface-border/45'),
  'Compare header should keep compact vertical padding without a bottom divider'
);
assert.ok(
  compareHeader.includes('data-testid="chat-compare-exit-center"')
    && compareHeader.includes('absolute left-1/2 top-1/2')
    && !compareModelHeader.includes('onExitCompare'),
  'Compare exit button should be centered in the header instead of owned by the left model column'
);
assert.ok(
  compareHeader.includes('mx-auto grid max-w-[1440px] grid-cols-1 items-center gap-5 lg:grid-cols-2 lg:gap-8 xl:gap-10'),
  'Compare header model selectors should align to the same centered grid and gutters as compare columns'
);
assert.ok(
  chatInterface.includes('COMPARE_MODEL_PERSIST_DEBOUNCE_MS = 300') && chatInterface.includes('compareModelPersistTimerRef'),
  'Compare model persistence should be debounced to avoid rapid repeated PATCH requests'
);
assert.ok(
  !compareColumnTurn.includes('本轮模型'),
  'Historical compare columns should not show redundant round-model text labels'
);

console.log('chat compare model selection static regression passed');
