#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

const groupRow = read('components/chat/ChatCompareGroupRow.tsx');
const header = read('components/chat/ChatCompareHeader.tsx');
const columnTurn = read('components/chat/CompareColumnTurn.tsx');
const globals = read('app/globals.css');
const messageList = read('components/chat/MessageList.tsx');
const scrollProgress = read('components/chat/ChatScrollProgress.tsx');
const messageActions = read('components/chat/MessageActions.tsx');

const compareGridClasses = 'gap-5 lg:grid-cols-2 lg:gap-8 xl:gap-10';
assert.ok(
  groupRow.includes(compareGridClasses),
  'Compare columns should use wider desktop gutters after removing card boundaries'
);
assert.ok(
  header.includes('relative z-[90] w-full shrink-0 bg-surface/80 px-4 py-1')
    && !header.includes('border-b border-surface-border/45'),
  'Compare header should use compact vertical padding without a bottom divider'
);
assert.ok(
  header.includes('mx-auto grid max-w-[1440px] grid-cols-1 items-center gap-5 lg:grid-cols-2 lg:gap-8 xl:gap-10'),
  'Compare header selectors should share the same max width and gutters as the answer columns'
);
assert.ok(
  read('components/chat/ChatCompareModelHeader.tsx').includes('[&>span:first-child]:h-7 [&>span:first-child]:w-7')
    && read('components/chat/ChatCompareModelHeader.tsx').includes('gap-3 pl-0 pr-2'),
  'Compare header selector avatar/text spacing should match the answer model meta for text left alignment'
);
assert.ok(
  columnTurn.includes('border border-transparent bg-transparent'),
  'Compare answer frame should be visually unboxed by default'
);
assert.ok(
  columnTurn.includes('data-compare-column-focus-zone={rightHalfFocused ? "right" : "page"}')
    && columnTurn.includes('rightHalfFocused && "bg-slate-500/[0.055] dark:bg-white/[0.06] green:bg-black/[0.045]"'),
  'Compare hover focus should only activate when the pointer is in the right-half column-scroll zone'
);
assert.ok(
  !columnTurn.includes('border border-surface-border/45 bg-surface/35'),
  'Compare answer frame should not regress to the old bordered card background'
);
assert.ok(
  columnTurn.includes('data-compare-column-scroll-shadow="top"') && columnTurn.includes('data-compare-column-scroll-shadow="bottom"'),
  'Compare columns should keep gradient scroll affordances'
);
assert.ok(
  columnTurn.includes('COMPARE_COLUMN_FADE_TOP_PX = 44')
    && columnTurn.includes('COMPARE_COLUMN_FADE_BOTTOM_PX = 56')
    && columnTurn.includes('WebkitMaskImage')
    && columnTurn.includes('maskImage')
    && columnTurn.includes('style={{ ...COMPARE_COLUMN_SCROLL_STYLE, ...columnScrollMaskStyle }}'),
  'Compare scroll affordance should fade content with CSS masks instead of colored overlays so hover/theme backgrounds still match'
);
assert.ok(
  columnTurn.includes('closest(\'[data-chat-activity-scroll="true"]\')')
    && columnTurn.includes('nestedActivityScroll.scrollTop + nestedActivityScroll.clientHeight >= nestedActivityScroll.scrollHeight - 1')
    && columnTurn.includes('el.scrollTop += event.deltaY'),
  'Compare nested Activity scroll should hand off wheel movement to the parent column at top/bottom edges'
);
assert.ok(
  columnTurn.includes('top-0 h-14')
    && columnTurn.includes('bottom-0 h-16')
    && !columnTurn.includes('bg-gradient-to-b from-surface')
    && !columnTurn.includes('bg-gradient-to-t from-surface'),
  'Compare scroll affordance marker layers should not paint theme-colored bands over hover backgrounds'
);
assert.ok(
  globals.includes('.compare-column-scroll-container') && globals.includes('scrollbar-color: rgba(148, 163, 184, 0.16) transparent'),
  'Compare columns should have a dedicated weak scrollbar style'
);
assert.ok(
  scrollProgress.includes('edgeAligned?: boolean')
    && scrollProgress.includes('edgeAligned ? "right-0 w-3 justify-end" : "right-1 w-7 justify-center"')
    && scrollProgress.includes('edgeAligned ? "right-0" : "left-1/2 -translate-x-1/2"'),
  'Chat scroll progress should support an edge-aligned mode that pins the thumb to the container edge'
);
assert.ok(
  (messageList.match(/onDragStateChange=\{setScrollProgressDragging\}\n\s+edgeAligned/g) || []).length >= 2,
  'Both compare and normal chat should render the outer scroll progress in edge-aligned mode'
);
assert.ok(
  messageList.includes('CHAT_HISTORY_TOP_FADE_PX = 44')
    && messageList.includes('const chatHistoryTopMaskStyle = scrollProgress.canScroll && scrollProgress.ratio > 0.006')
    && messageList.includes('WebkitMaskImage: `linear-gradient(to bottom, transparent 0, #000 ${CHAT_HISTORY_TOP_FADE_PX}px, #000 100%)`')
    && (messageList.match(/\.\.\.chatHistoryTopMaskStyle/g) || []).length >= 2,
  'Chat history scrollers in both normal and compare modes should keep the top fade affordance'
);
assert.ok(
  messageList.includes('const isSingleModelGroup = group.models.length < 2 && group.assistantMessages.length <= 1')
    && messageList.includes('if (isSingleModelGroup) return colIndex === 0 ? group.assistantMessages[0] : undefined')
    && messageList.includes('compareModels={group.models.length > 0 ? group.models : (activeCompareModels.length ? activeCompareModels : compareModels)}'),
  'Single-model normal groups in compare mode should render in the left column only instead of duplicating into global compare columns'
);
assert.ok(
  !messageActions.includes('h-0 overflow-visible'),
  'Hidden message actions should keep layout height instead of overflowing upward into the message bubble'
);

console.log('chat compare unboxed style static regression passed');
