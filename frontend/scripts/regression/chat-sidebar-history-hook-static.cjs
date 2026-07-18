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
assert.ok(hook.includes('conversation-deleted'), 'hook should own conversation-deleted cleanup for failed optimistic creates');
assert.ok(hook.includes('patchConversation') && hook.includes('removeConversation') && hook.includes('applyConversationActivity'), 'hook should expose one optimistic sidebar action pipeline');
assert.ok(hook.includes('before_activity_at') && hook.includes('before_id'), 'hook should own cursor pagination params');
assert.ok(hook.includes('chat-bootstrap-ready'), 'hook should merge bootstrap sidebar payloads');
assert.ok(hook.includes('enabled?: boolean'), 'shared sidebar history hook should support disabled consumers');
assert.ok(hook.includes('useBootstrapSeed?: boolean'), 'shared sidebar history hook should gate partial bootstrap sidebar seeds');
assert.ok(hook.includes('if (!useBootstrapSeed) return;'), 'partial bootstrap sidebar history should not render unless explicitly enabled');
assert.ok(hook.includes('if (!effectiveWorkspaceId) return;'), 'shared sidebar history hook should not fetch all-workspace history before workspace is known');
assert.ok(hook.includes('sidebarConversationPageInflight'), 'shared sidebar history hook should de-dupe identical in-flight canonical page requests');
assert.ok(hook.includes('readCanonicalConversationCache'), 'shared sidebar history hook should show complete canonical cache before background revalidation');
assert.ok(hook.includes('writeCanonicalConversationCache'), 'shared sidebar history hook should persist complete canonical pages for stable next paint');
assert.ok(hook.includes('sidebarConversationPageRecent'), 'shared sidebar history hook should suppress immediate sequential duplicate canonical fetches');
assert.ok(hook.includes('prev.length > 0 ? prev : []'), 'sidebar history should not clear visible canonical cache during transient auth bootstrap');
assert.ok(hook.includes('if (enabled) return;') && hook.includes('setConversationState([])'), 'disabled sidebar history consumers should not keep hidden cached rows mounted');
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
    && hook.includes('applyConversationActivity(metadata)')
    && hook.includes('applySidebarConversationActivity(prev, detail)'),
  'sidebar history should consume shared conversation metadata events through the shared optimistic pipeline'
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
  assert.ok(source.includes('workspaceId: currentWS?.id'), `${name} should pass the active workspace into shared sidebar history`);
  assert.ok(!source.includes('parseSidebarCursor'), `${name} should not duplicate cursor parsing`);
  assert.ok(!source.includes('applySidebarConversationActivity'), `${name} should not duplicate activity merge logic`);
  assert.ok(!source.includes('hasMoreSidebarConversations'), `${name} should not duplicate has-more logic`);
  assert.ok(!source.includes('mergeConversationLists'), `${name} should not duplicate merge helper`);
}

assert.ok(!mobile.includes('cachedConversationsMobile'), 'MobileNav should not keep its own module cache');
assert.ok(mobile.includes('enabled: menuOpen'), 'MobileNav should not fetch/render sidebar history while the drawer is closed on desktop');
assert.ok(mobile.includes('useBootstrapSeed: false'), 'MobileNav should not render partial bootstrap sidebar history before canonical load');
assert.ok(!desktop.includes('cachedConversations'), 'AppSidebar should not keep its own module cache');
assert.ok(desktop.includes('useBootstrapSeed: false'), 'AppSidebar should render canonical sidebar history in one pass instead of partial bootstrap seed');
assert.ok(desktop.includes('clearChatSidebarHistoryCache(`desktop:${currentWS?.id || "all"}`)'), 'AppSidebar should clear the shared cache on workspace/logout transitions');

console.log('chat sidebar history hook static regression passed');
