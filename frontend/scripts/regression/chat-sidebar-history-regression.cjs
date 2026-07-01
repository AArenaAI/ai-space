const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadModule() {
  const sourcePath = path.join(__dirname, '../../lib/chatSidebarHistory.ts');
  let source = fs.readFileSync(sourcePath, 'utf8');
  source = source
    .replace(/export type ChatSidebarConversation = \{[\s\S]*?\};\n\n/, '')
    .replace(/export type ChatSidebarActivityUpdate = \{[\s\S]*?\};\n\n/, '')
    .replace(/export const CHAT_SIDEBAR_CONVERSATION_PAGE_SIZE = 500;/, 'exports.CHAT_SIDEBAR_CONVERSATION_PAGE_SIZE = 500;')
    .replace(/export function sortSidebarConversations<T extends ChatSidebarConversation>\(conversations: T\[\]\): T\[\] \{/, 'function sortSidebarConversations(conversations) {')
    .replace(/export function mergeSidebarConversations<T extends ChatSidebarConversation>\(current: T\[\], incoming: T\[\]\): T\[\] \{/, 'function mergeSidebarConversations(current, incoming) {')
    .replace(/export function applySidebarConversationActivity<T extends ChatSidebarConversation>\(current: T\[\], update: ChatSidebarActivityUpdate\): T\[\] \{/, 'function applySidebarConversationActivity(current, update) {')
    .replace(/export function hasMoreSidebarConversations\(currentCount: number, nextOffset: number, total\?: number, hasMore\?: boolean\) \{/, 'function hasMoreSidebarConversations(currentCount, nextOffset, total, hasMore) {')
    .replace(/export function parseSidebarCursor\(cursor\?: string\) \{/, 'function parseSidebarCursor(cursor) {')
    .replace(/: ChatSidebarConversation\[\]/g, '')
    .replace(/: ChatSidebarActivityUpdate/g, '')
    .replace(/: number/g, '')
    .replace(/\?: string/g, '')
    .replace(/\?: number/g, '')
    .replace(/: string/g, '')
    .replace(/new Map<number, T>\(\)/g, 'new Map()')
    .replace(/ as T/g, '');
  source += '\nexports.sortSidebarConversations = sortSidebarConversations;';
  source += '\nexports.mergeSidebarConversations = mergeSidebarConversations;';
  source += '\nexports.applySidebarConversationActivity = applySidebarConversationActivity;';
  source += '\nexports.hasMoreSidebarConversations = hasMoreSidebarConversations;';
  source += '\nexports.parseSidebarCursor = parseSidebarCursor;';
  const exports = {};
  vm.runInNewContext(source, { exports, Date, Map, Number });
  return exports;
}

const {
  mergeSidebarConversations,
  applySidebarConversationActivity,
  hasMoreSidebarConversations,
  parseSidebarCursor,
} = loadModule();

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

console.log('chat sidebar history regression passed');
