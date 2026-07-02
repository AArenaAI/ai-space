#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

const hook = read('hooks/useChatSidebarHistory.ts');
const metadataEvents = read('lib/chatConversationMetadataEvents.ts');
const sidebarHistoryLib = read('lib/chatSidebarHistory.ts');
const useChat = read('hooks/useChat.ts');
const mobile = read('components/mobile/MobileNav.tsx');
const desktop = read('components/sidebar/AppSidebar.tsx');

assert.ok(hook.includes('export function useChatSidebarHistory'), 'shared sidebar history hook should exist');
assert.ok(hook.includes('conversation-created'), 'hook should own conversation-created updates');
assert.ok(hook.includes('conversation-renamed'), 'hook should own conversation-renamed updates');
assert.ok(hook.includes('conversation-updated'), 'hook should own conversation-updated updates');
assert.ok(hook.includes('before_activity_at') && hook.includes('before_id'), 'hook should own cursor pagination params');
assert.ok(hook.includes('chat-bootstrap-ready'), 'hook should merge bootstrap sidebar payloads');
assert.ok(metadataEvents.includes('normalizeConversationMetadataEventDetail'), 'shared conversation metadata event normalizer should exist');
assert.ok(
  metadataEvents.includes('eventType === "conversation-renamed"')
    && metadataEvents.includes('incoming.source === "local-send"')
    && metadataEvents.includes('isDefaultOrEmptyConversationTitle(currentTitle)'),
  'chat header title should only accept manual renames or local-send titles for new/default conversations'
);
assert.ok(
  sidebarHistoryLib.includes('resolveSidebarActivityTitle')
    && sidebarHistoryLib.includes('update.source === "local-send"')
    && sidebarHistoryLib.includes('!isDefaultOrEmptySidebarTitle(existingTitle)'),
  'sidebar activity updates should not overwrite existing titles on every local send'
);
assert.ok(
  hook.includes('getConversationMetadataEventFromDomEvent')
    && hook.includes('applySidebarConversationActivity(prev, metadata)'),
  'sidebar history should consume shared conversation metadata events'
);
assert.ok(
  useChat.includes('getConversationMetadataEventFromDomEvent')
    && useChat.includes('shouldApplyConversationTitleUpdate')
    && useChat.includes('window.addEventListener("conversation-updated", handleConversationMetadata)')
    && useChat.includes('eventType: event.type')
    && useChat.includes('setConversationTitle(incoming!.title!)'),
  'current chat header title should consume the same conversation metadata events as the sidebar'
);

for (const [name, source] of [['MobileNav', mobile], ['AppSidebar', desktop]]) {
  assert.ok(source.includes('useChatSidebarHistory({'), `${name} should use shared sidebar history hook`);
  assert.ok(!source.includes('parseSidebarCursor'), `${name} should not duplicate cursor parsing`);
  assert.ok(!source.includes('applySidebarConversationActivity'), `${name} should not duplicate activity merge logic`);
  assert.ok(!source.includes('hasMoreSidebarConversations'), `${name} should not duplicate has-more logic`);
  assert.ok(!source.includes('mergeConversationLists'), `${name} should not duplicate merge helper`);
}

assert.ok(!mobile.includes('cachedConversationsMobile'), 'MobileNav should not keep its own module cache');
assert.ok(!desktop.includes('cachedConversations'), 'AppSidebar should not keep its own module cache');
assert.ok(desktop.includes('clearChatSidebarHistoryCache(`desktop:${currentWS?.id || "all"}`)'), 'AppSidebar should clear the shared cache on workspace/logout transitions');

console.log('chat sidebar history hook static regression passed');
