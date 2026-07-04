#!/usr/bin/env node
const assert = require('node:assert/strict');

(async () => {
  const mod = await import('../../lib/chatSidebarHistory.ts');
  const {
    applySidebarConversationActivity,
    hasMoreSidebarConversations,
    mergeSidebarConversations,
    parseSidebarCursor,
    sortSidebarConversations,
  } = mod;

  const base = [
    { id: 1, title: 'Existing title', model: 'gpt-old', pinned: false, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    { id: 2, title: 'Pinned', model: 'gpt-old', pinned: true, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:01.000Z' },
    { id: 3, title: '新对话', model: 'gpt-old', pinned: false, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:02.000Z' },
  ];

  const sorted = sortSidebarConversations(base);
  assert.deepEqual(sorted.map((item) => item.id), [2, 3, 1], 'pinned conversations should stay above recent unpinned conversations');

  const merged = mergeSidebarConversations(base, [
    { id: 1, title: 'Server title older activity', model: 'gpt-new', pinned: false, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2025-12-31T23:59:59.000Z' },
    { id: 4, title: 'New server conversation', model: 'gpt-new', pinned: false, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:03.000Z' },
  ]);
  const mergedOne = merged.find((item) => item.id === 1);
  assert.equal(mergedOne.title, 'Server title older activity', 'server payload should refresh title fields during bootstrap/page merge');
  assert.equal(mergedOne.updated_at, '2026-01-01T00:00:00.000Z', 'older server page activity should not move conversation backwards');
  assert.deepEqual(merged.map((item) => item.id), [2, 4, 3, 1], 'merge should preserve pinned first then activity order');

  const localExisting = applySidebarConversationActivity(base, {
    id: 1,
    title: 'Draft prompt title',
    model: 'gpt-5',
    source: 'local-send',
    updated_at: '2026-01-01T00:00:05.000Z',
  });
  const localExistingOne = localExisting.find((item) => item.id === 1);
  assert.equal(localExistingOne.title, 'Existing title', 'local-send optimistic title should not overwrite non-default title');
  assert.equal(localExistingOne.model, 'gpt-5', 'local-send optimistic activity should update model');
  assert.deepEqual(localExisting.map((item) => item.id), [2, 1, 3], 'local-send optimistic activity should reorder by recent activity under pinned items');

  const localDefault = applySidebarConversationActivity(base, {
    id: 3,
    title: 'First user prompt',
    source: 'local-send',
    updated_at: '2026-01-01T00:00:06.000Z',
  });
  assert.equal(localDefault.find((item) => item.id === 3).title, 'First user prompt', 'local-send should replace default/new-chat titles');

  const remoteRename = applySidebarConversationActivity(base, {
    id: 1,
    title: 'Manual rename',
    source: 'manual-rename',
    updated_at: '2026-01-01T00:00:07.000Z',
  });
  assert.equal(remoteRename.find((item) => item.id === 1).title, 'Manual rename', 'manual rename should overwrite existing title');

  const optimisticNew = applySidebarConversationActivity(base, {
    conversationId: '9',
    title: 'Optimistic created conversation',
    model: 'deepseek',
    skill_key: '',
    source: 'local-send',
    updated_at: '2026-01-01T00:00:08.000Z',
  });
  const optimistic = optimisticNew.find((item) => item.id === 9);
  assert.ok(optimistic, 'local-send activity for unknown conversation should create an optimistic sidebar row');
  assert.equal(optimistic.title, 'Optimistic created conversation');
  assert.equal(optimistic.pinned, false);
  assert.deepEqual(optimisticNew.map((item) => item.id), [2, 9, 3, 1], 'optimistic row should appear in recent activity order under pinned items');

  assert.deepEqual(parseSidebarCursor('2026-01-01T00:00:08.000Z:42'), { beforeActivityAt: '2026-01-01T00:00:08.000Z', beforeId: '42' }, 'cursor parser should split from the last colon to preserve ISO timestamps');
  assert.equal(parseSidebarCursor('bad-cursor'), null, 'invalid cursor should return null');
  assert.equal(hasMoreSidebarConversations(10, 20, 100, undefined), true, 'total-based hasMore should work');
  assert.equal(hasMoreSidebarConversations(100, 100, 100, undefined), false, 'total-based hasMore should stop at total');
  assert.equal(hasMoreSidebarConversations(3, 500, undefined, false), false, 'server has_more=false should win');
  assert.equal(hasMoreSidebarConversations(3, 500, undefined, true), true, 'server has_more=true should win');

  console.log(JSON.stringify({ ok: true, sorted: sorted.map((item) => item.id), optimisticOrder: optimisticNew.map((item) => item.id) }));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
