#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const storeMod = await import('../../lib/chatRuntimeStore.ts');
  const ownerMod = await import('../../lib/chatStreamOwnerRegistry.ts');
  const mergeMod = await import('../../lib/chatConversationSnapshotMerge.ts');

  const { createConversationRuntimeStore } = storeMod;
  const { createStreamOwnerRegistry } = ownerMod;
  const { mergeConversationSnapshot } = mergeMod;

  const store = createConversationRuntimeStore();
  let notificationCount = 0;
  const unsubscribe = store.subscribe((snapshot) => {
    notificationCount += 1;
    assert.ok(snapshot.conversations instanceof Map, 'store snapshot should expose conversations map');
  });
  store.patchConversation(101, {
    messages: [{ id: 'u1', role: 'user', content: 'hello' }],
    compareModels: ['a', 'b'],
    scrollState: { distanceToBottom: 0, atBottom: true, updatedAt: 100 },
  });
  store.patchConversation(102, { pendingOptimisticMessages: [{ id: 'pending-a', role: 'assistant' }] });
  assert.equal(store.getConversation(101).messages.length, 1, 'store should keep messages by conversation id');
  assert.deepEqual(store.getConversation(101).compareModels, ['a', 'b'], 'store should keep compare models by conversation id');
  assert.equal(store.getConversation(102).pendingOptimisticMessages.length, 1, 'store should isolate pending optimistic messages per conversation');
  assert.equal(store.getSnapshot().activeConversationId, undefined, 'active conversation is explicit, not inferred');
  store.setActiveConversation(101);
  assert.equal(store.getSnapshot().activeConversationId, 101, 'store should track active conversation explicitly');
  unsubscribe();
  store.patchConversation(101, { activityTarget: { messageId: 'm2', column: 'left' } });
  assert.equal(notificationCount, 3, 'unsubscribe should stop later notifications while earlier patch/setActive notify');

  const aborted = [];
  const registry = createStreamOwnerRegistry({
    abortOwner: (owner, reason) => aborted.push({ owner, reason }),
  });
  const ownerA = { conversationId: 201, taskId: 501, streamId: 'stream-a', serverMessageId: 9001, sequence: 1 };
  const ownerB = { conversationId: 201, taskId: 501, streamId: 'stream-b', serverMessageId: 9001, sequence: 2 };
  registry.register(ownerA);
  assert.equal(registry.canFinalize(ownerA), true, 'registered stream owner should be allowed to finalize');
  registry.register(ownerB);
  assert.equal(registry.canFinalize(ownerA), false, 'replaced owner must not finalize');
  assert.equal(registry.canFinalize(ownerB), true, 'new owner should finalize');
  assert.equal(aborted.length, 1, 'registering a replacement owner should abort the previous owner');
  assert.equal(aborted[0].reason, 'replaced');
  registry.finalize(ownerA);
  assert.equal(registry.canFinalize(ownerB), true, 'stale finalize should not remove current owner');
  registry.finalize(ownerB);
  assert.equal(registry.canFinalize(ownerB), false, 'current finalize should remove owner');
  const ownerC = { conversationId: 202, taskId: 777, streamId: 'stream-c' };
  registry.register(ownerC);
  registry.abortConversation(202, 'navigation');
  assert.equal(registry.canFinalize(ownerC), false, 'conversation abort should remove stream owners');
  assert.equal(aborted.at(-1).reason, 'navigation');

  const local = {
    conversationId: 301,
    snapshotVersion: 5,
    updatedAt: 5000,
    messages: [{ id: 'local-user', role: 'user' }, { id: 'local-assistant', role: 'assistant', generation_status: 'running', generation_task_id: 88 }],
    pendingOptimisticMessages: [{ id: 'optimistic-user', role: 'user' }],
    activeTaskIds: [88],
  };
  const staleBootstrap = {
    conversationId: 301,
    snapshotVersion: 4,
    updatedAt: 4000,
    messages: [{ id: 'remote-old', role: 'assistant', generation_status: 'running', generation_task_id: 88 }],
  };
  const staleDecision = mergeConversationSnapshot(local, staleBootstrap, {
    source: 'bootstrap',
    currentConversationId: 301,
    activeStreamTaskIds: [88],
  });
  assert.equal(staleDecision.accepted, false, 'bootstrap older than local active stream should be rejected');
  assert.equal(staleDecision.reason, 'remote_snapshot_older_than_active_stream');
  assert.equal(staleDecision.snapshot, local, 'rejected merge should preserve local snapshot');

  const routeMismatch = mergeConversationSnapshot(local, { ...staleBootstrap, conversationId: 999, snapshotVersion: 9 }, {
    source: 'restore',
    currentConversationId: 301,
  });
  assert.equal(routeMismatch.accepted, false, 'snapshot for stale route should be rejected');
  assert.equal(routeMismatch.reason, 'remote_conversation_mismatch');

  const optimisticProtected = mergeConversationSnapshot(local, { ...staleBootstrap, snapshotVersion: 6, updatedAt: 6000 }, {
    source: 'bootstrap',
    currentConversationId: 301,
  });
  assert.equal(optimisticProtected.accepted, false, 'local optimistic messages should beat bootstrap snapshots');
  assert.equal(optimisticProtected.reason, 'local_optimistic_newer_than_bootstrap');

  const completedRemote = {
    conversationId: 301,
    snapshotVersion: 6,
    updatedAt: 7000,
    messages: [{ id: 'done', role: 'assistant', generation_status: 'completed', generation_task_id: 88, content: 'done' }],
  };
  const completedDecision = mergeConversationSnapshot(local, completedRemote, {
    source: 'restore',
    currentConversationId: 301,
    activeStreamTaskIds: [88],
  });
  assert.equal(completedDecision.accepted, true, 'completed terminal remote should be allowed to replace running local task');
  assert.equal(completedDecision.reason, 'remote_completed_terminal_wins');
  assert.equal(completedDecision.snapshot, completedRemote);

  const newerDecision = mergeConversationSnapshot({ ...local, pendingOptimisticMessages: [], activeTaskIds: [] }, {
    conversationId: 301,
    snapshotVersion: 9,
    updatedAt: 9000,
    messages: [{ id: 'newer', role: 'assistant' }],
  }, { source: 'restore', currentConversationId: 301 });
  assert.equal(newerDecision.accepted, true, 'newer restore snapshot should be accepted');
  assert.equal(newerDecision.reason, 'remote_snapshot_newer');

  const repoRoot = path.resolve(__dirname, '../..');
  const createRuntimeSource = fs.readFileSync(path.join(repoRoot, 'hooks/useChatConversationCreateRuntime.ts'), 'utf8');
  assert.ok(createRuntimeSource.includes('chatRuntimeStore'), 'conversation create runtime should seed the shared runtime store');
  assert.ok(createRuntimeSource.includes('setActiveConversation(data.id)'), 'created conversations should become the explicit active runtime conversation');
  assert.ok(createRuntimeSource.includes('deleteConversation(tempConversationId)'), 'failed/replaced temp conversations should be removed from the runtime store');

  console.log(JSON.stringify({ ok: true, notifications: notificationCount, aborted: aborted.length }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
