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
  const compareLeftA = { conversationId: 203, taskId: 701, streamId: 'left-a', groupId: 900, groupIndex: 0, column: 'left' };
  const compareRight = { conversationId: 203, taskId: 702, streamId: 'right-a', groupId: 900, groupIndex: 1, column: 'right' };
  const compareLeftB = { conversationId: 203, taskId: 703, streamId: 'left-b', groupId: 900, groupIndex: 0, column: 'left' };
  registry.register(compareLeftA);
  registry.register(compareRight);
  registry.register(compareLeftB);
  assert.equal(registry.canFinalize(compareLeftA), false, 'same compare column replacement should retire previous left owner');
  assert.equal(registry.canFinalize(compareLeftB), true, 'same compare column replacement should keep new left owner');
  assert.equal(registry.canFinalize(compareRight), true, 'left column replacement must not retire right owner');
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

  const e2e = createConversationRuntimeStore();
  e2e.patchConversation(-1, { messages: [], pendingOptimisticMessages: [], compareModels: [], updatedAt: 1000 });
  e2e.setActiveConversation(-1);
  e2e.deleteConversation(-1);
  e2e.patchConversation(401, { messages: [], pendingOptimisticMessages: [], compareModels: [], updatedAt: 1100 });
  e2e.setActiveConversation(401);
  assert.equal(e2e.getSnapshot().activeConversationId, 401, 'created real conversation should become active');

  const optimisticUser = { id: 'u-local', role: 'user', content: 'hello' };
  const pendingAssistant = { id: 'a-server', role: 'assistant', content: '', serverMessageId: 777, generationTaskId: 888 };
  e2e.patchConversation(401, {
    messages: [optimisticUser, pendingAssistant],
    pendingOptimisticMessages: [pendingAssistant],
    updatedAt: 1200,
  });
  assert.deepEqual(e2e.getConversation(401).messages.map((message) => message.id), ['u-local', 'a-server'], 'send optimistic messages should land in runtime slice');
  assert.deepEqual(e2e.getConversation(401).pendingOptimisticMessages.map((message) => message.id), ['a-server'], 'pending assistant should be visible in runtime slice');

  e2e.patchConversation(401, {
    activeStreams: { 'a-server': { convId: 401, serverMessageId: 777, generationTaskId: 888, main: true } },
    generationTasks: { '888': { convId: 401, serverMessageId: 777, generationTaskId: 888, localMessageId: 'a-server' } },
    updatedAt: 1300,
  });
  assert.equal(e2e.getConversation(401).activeStreams['a-server'].main, true, 'main stream active state should be tracked');
  assert.equal(e2e.getConversation(401).generationTasks['888'].localMessageId, 'a-server', 'generation task metadata should point back to local message');

  e2e.patchConversation(401, {
    activeStreams: { 'a-server': { convId: 401, serverMessageId: 777, generationTaskId: 888, lastSequence: 2, content: 'partial' } },
    generationTasks: { '888': { convId: 401, serverMessageId: 777, generationTaskId: 888, localMessageId: 'a-server', lastSequence: 2, content: 'partial' } },
    updatedAt: 1400,
  });
  assert.equal(e2e.getConversation(401).activeStreams['a-server'].lastSequence, 2, 'task stream resume metadata should replace main-stream metadata');

  e2e.patchConversation(401, {
    messages: [{ ...optimisticUser, serverMessageId: 776 }, { ...pendingAssistant, content: 'final', completedAt: 1500 }],
    activeStreams: { 'a-server': { convId: 401, serverMessageId: 777, polling: true } },
    generationTasks: { '888': { convId: 401, serverMessageId: 777, generationTaskId: 888, localMessageId: 'a-server' } },
    pendingOptimisticMessages: [],
    updatedAt: 1500,
  });
  assert.equal(e2e.getConversation(401).messages[1].content, 'final', 'background polling should sync final message content');
  assert.equal(e2e.getConversation(401).pendingOptimisticMessages.length, 0, 'completed send should clear pending optimistic messages');
  assert.equal(e2e.getConversation(401).activeStreams['a-server'].polling, true, 'polling state should coexist with final message reconciliation until finished');

  e2e.patchConversation(401, {
    activeStreams: {},
    generationTasks: {},
    updatedAt: 1600,
  });
  assert.deepEqual(e2e.getConversation(401).activeStreams, {}, 'finished polling should clear only active stream metadata');
  assert.equal(e2e.getConversation(401).messages[1].content, 'final', 'clearing active streams must not drop messages');

  e2e.patchConversation(401, {
    messages: [{ id: 'u-remote', role: 'user', content: 'hello' }, { id: 'a-remote', role: 'assistant', content: 'final', serverMessageId: 777, generationTaskId: 888, completedAt: 1700 }],
    compareModels: ['m1', 'm2'],
    activeStreams: {},
    generationTasks: {},
    pendingOptimisticMessages: [],
    updatedAt: 1700,
  });
  const restoredSlice = e2e.getConversation(401);
  assert.deepEqual(restoredSlice.messages.map((message) => message.id), ['u-remote', 'a-remote'], 'restore/cache snapshot should replace messages in the same runtime slice');
  assert.deepEqual(restoredSlice.compareModels, ['m1', 'm2'], 'compare metadata should survive restore/cache convergence');
  assert.deepEqual(restoredSlice.activeStreams, {}, 'restore terminal snapshot should not resurrect stale active streams');
  assert.equal(restoredSlice.pendingOptimisticMessages.length, 0, 'restore terminal snapshot should not resurrect stale pending messages');

  const repoRoot = path.resolve(__dirname, '../..');
  const createRuntimeSource = fs.readFileSync(path.join(repoRoot, 'hooks/useChatConversationCreateRuntime.ts'), 'utf8');
  const singleSendSource = fs.readFileSync(path.join(repoRoot, 'hooks/useChatSingleSendRuntime.ts'), 'utf8');
  const compareSendSource = fs.readFileSync(path.join(repoRoot, 'hooks/useChatCompareSendRuntime.ts'), 'utf8');
  const mainStreamSource = fs.readFileSync(path.join(repoRoot, 'hooks/useChatMainStreamRuntime.ts'), 'utf8');
  const taskStreamSource = fs.readFileSync(path.join(repoRoot, 'hooks/useChatTaskStreamRuntime.ts'), 'utf8');
  const backgroundPollingSource = fs.readFileSync(path.join(repoRoot, 'hooks/useChatBackgroundPollingRuntime.ts'), 'utf8');
  const restoreSource = fs.readFileSync(path.join(repoRoot, 'hooks/useChatConversationRestoreRuntime.ts'), 'utf8');
  const generationControlsSource = fs.readFileSync(path.join(repoRoot, 'hooks/useChatGenerationControlsRuntime.ts'), 'utf8');
  const lifecycleSource = fs.readFileSync(path.join(repoRoot, 'hooks/useChatConversationLifecycle.ts'), 'utf8');
  const localActionsSource = fs.readFileSync(path.join(repoRoot, 'hooks/useChatLocalActions.ts'), 'utf8');
  assert.ok(createRuntimeSource.includes('chatRuntimeStore'), 'conversation create runtime should seed the shared runtime store');
  assert.ok(createRuntimeSource.includes('setActiveConversation(data.id)'), 'created conversations should become the explicit active runtime conversation');
  assert.ok(createRuntimeSource.includes('deleteConversation(tempConversationId)'), 'failed/replaced temp conversations should be removed from the runtime store');
  assert.ok(singleSendSource.includes('pendingOptimisticMessages'), 'single send runtime should sync pending optimistic assistants into the runtime store');
  assert.ok(compareSendSource.includes('syncCompareMessagesToRuntime'), 'compare send runtime should sync local/compare messages into the runtime store');
  assert.ok(mainStreamSource.includes('syncMainStreamToRuntime'), 'main stream runtime should sync active/final state into the runtime store');
  assert.ok(taskStreamSource.includes('syncActiveTaskStreamsToRuntime'), 'task stream runtime should sync active task metadata into the runtime store');
  assert.ok(backgroundPollingSource.includes('syncBackgroundPollingToRuntime'), 'background polling runtime should sync polling/message state into the runtime store');
  assert.ok(restoreSource.includes('syncRestoreSnapshotToRuntime'), 'restore runtime should sync cache/restore snapshots into the runtime store');
  assert.ok(generationControlsSource.includes('syncGenerationControlMessagesToRuntime'), 'generation controls should sync fork/refresh messages into the runtime store');
  assert.ok(generationControlsSource.includes('clearGenerationControlActivity'), 'generation controls should clear active runtime metadata on stop');
  assert.ok(lifecycleSource.includes('chatRuntimeStore.setActiveConversation'), 'conversation lifecycle should keep active runtime conversation in sync');
  assert.ok(lifecycleSource.includes('chatRuntimeStore.patchConversation(conversationId'), 'load-more lifecycle should sync prepended messages into the runtime store');
  assert.ok(localActionsSource.includes('chatRuntimeStore.setActiveConversation(undefined)'), 'local clear action should clear active runtime conversation');

  console.log(JSON.stringify({ ok: true, notifications: notificationCount, aborted: aborted.length }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
