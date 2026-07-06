#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(repoRoot, 'components/chat/ChatActivityPanel.tsx'), 'utf8');

assert.match(source, /const messageTerminal\s*=\s*isTerminalActivityMessage\(message\);/, 'activity panel must compute terminal message state before polling');
assert.match(source, /if \(!taskId \|\| typeof window === "undefined" \|\| messageTerminal\) return;/, 'activity panel must skip polling for terminal messages');
assert.match(source, /if \(isTerminalTaskStatus\(data\?\.task\?\.status\)\) \{\s*cancelled = true;\s*if \(timer\) window\.clearInterval\(timer\);\s*\}/s, 'activity panel must stop polling after terminal task snapshot');
assert.match(source, /let timer: (?:ReturnType<typeof window\.setInterval>|number) \| undefined;/, 'activity panel interval handle must be clearable from snapshot response');

console.log('chat activity polling static regression passed');
