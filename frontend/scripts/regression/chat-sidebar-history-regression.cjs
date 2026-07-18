const assert = require('assert');
const fs = require('fs');
const path = require('path');

(async () => {
const {
  mergeSidebarConversations,
  applySidebarConversationActivity,
  hasMoreSidebarConversations,
  parseSidebarCursor,
} = await import('../../lib/chatSidebarHistory.ts');

(function staleBootstrapCannotDowngradeLocalActivity() {
  const current = [
    { id: 1, title: 'old', pinned: false, updated_at: '2026-07-02T10:00:00.000Z' },
    { id: 2, title: 'yesterday', pinned: false, updated_at: '2026-07-01T10:00:00.000Z' },
  ];
  const incomingBootstrap = [
    { id: 1, title: 'server old', pinned: false, updated_at: '2026-07-01T09:00:00.000Z' },
  ];
  const merged = mergeSidebarConversations(current, incomingBootstrap);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 1);
  assert.equal(merged[0].updated_at, '2026-07-02T10:00:00.000Z');
  assert.equal(merged.some((conv) => conv.id === 2), true);
})();

(function localSendMovesConversationToTopImmediately() {
  const current = [
    { id: 1, title: 'today', pinned: false, updated_at: '2026-07-02T08:00:00.000Z' },
    { id: 2, title: 'yesterday', pinned: false, updated_at: '2026-07-01T10:00:00.000Z' },
  ];
  const next = applySidebarConversationActivity(current, {
    id: 2,
    updated_at: '2026-07-02T11:00:00.000Z',
    source: 'local-send',
  });
  assert.equal(next[0].id, 2);
  assert.equal(next[0].updated_at, '2026-07-02T11:00:00.000Z');
})();

(function paginationUsesTotalAndCursorSignals() {
  assert.equal(hasMoreSidebarConversations(500, 500, 501), true);
  assert.equal(hasMoreSidebarConversations(501, 500, 501), false);
  assert.equal(hasMoreSidebarConversations(10, 500, undefined, true), true);
  assert.equal(hasMoreSidebarConversations(10, 500, undefined, false), false);
  assert.deepEqual(parseSidebarCursor('2026-07-02T11:00:00.000Z:42'), {
    beforeActivityAt: '2026-07-02T11:00:00.000Z',
    beforeId: '42',
  });
})();

(function canonicalFirstPageMustMergeInsteadOfReplace() {
  const hookPath = path.join(__dirname, '../../hooks/useChatSidebarHistory.ts');
  const hook = fs.readFileSync(hookPath, 'utf8');
  assert.ok(
    hook.includes('mergeSidebarConversations(prev, page.conversations)'),
    'canonical /conversations first page must merge/upsert instead of replacing bootstrap/sidebar state'
  );
  assert.equal(
    hook.includes('setConversations(sortSidebarConversations(page.conversations))'),
    false,
    'canonical /conversations first page replacement causes visible sidebar second-refresh/shrink regressions'
  );
})();

console.log('chat sidebar history regression passed');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
