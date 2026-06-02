"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MessageList from "./MessageList";
import type { ChatModel, Message } from "@/lib/chatTypes";

const models: ChatModel[] = [
  { id: "fixture-model", name: "Fixture Model", provider: "local", description: "Load more fixture model", color: "#64748b" },
];

const DEFAULT_CONFIG = { currentTurns: 14, olderTurns: 8, pages: 1, lines: 8, delay: 260 };

const readPositiveIntParam = (params: URLSearchParams, name: string, fallback: number) => {
  const raw = params.get(name);
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const makeTurn = (index: number, prefix = "current", answerLines = 8): Message[] => [
  {
    id: `${prefix}-user-${index}`,
    role: "user",
    content: `第 ${index} 轮问题：用于测试向上加载更多历史消息时当前视图是否保持稳定。`,
    createdAt: 1_700_000_000_000 + index * 2,
    serverMessageId: index * 2 - 1,
  },
  {
    id: `${prefix}-assistant-${index}`,
    role: "assistant",
    content: Array.from({ length: answerLines }, (_, line) => `第 ${index} 轮回答第 ${line + 1} 行：这是一段有高度的历史回答，用来放大 prepend 后的滚动补偿误差。`).join("\n\n"),
    model: "fixture-model",
    createdAt: 1_700_000_000_000 + index * 2 + 1,
    completedAt: 1_700_000_000_000 + index * 2 + 2,
    serverMessageId: index * 2,
  },
];

export default function ChatLoadMoreHistoryFixture() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setConfig({
      currentTurns: readPositiveIntParam(params, "currentTurns", DEFAULT_CONFIG.currentTurns),
      olderTurns: readPositiveIntParam(params, "olderTurns", DEFAULT_CONFIG.olderTurns),
      pages: readPositiveIntParam(params, "pages", DEFAULT_CONFIG.pages),
      lines: readPositiveIntParam(params, "lines", DEFAULT_CONFIG.lines),
      delay: readPositiveIntParam(params, "delay", DEFAULT_CONFIG.delay),
    });
  }, []);
  const currentTurns = config.currentTurns;
  const olderTurnsPerPage = config.olderTurns;
  const pages = config.pages;
  const answerLines = config.lines;
  const loadDelay = config.delay;
  const initialMessages = useMemo(
    () => Array.from({ length: currentTurns }, (_, index) => makeTurn(index + 100, "current", answerLines)).flat(),
    [answerLines, currentTurns],
  );
  const olderPages = useMemo(
    () => Array.from({ length: pages }, (_, pageIndex) =>
      Array.from({ length: olderTurnsPerPage }, (_, index) => makeTurn(pageIndex * olderTurnsPerPage + index + 1, `older-${pageIndex + 1}`, answerLines)).flat()
    ),
    [answerLines, olderTurnsPerPage, pages],
  );
  const [messages, setMessages] = useState(initialMessages);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadedPageCount, setLoadedPageCount] = useState(0);
  const loadedOlder = loadedPageCount >= pages;

  useEffect(() => {
    setMessages(initialMessages);
    setLoadedPageCount(0);
    setIsLoadingMore(false);
  }, [initialMessages]);

  const handleLoadMore = useCallback(() => {
    if (loadedOlder || isLoadingMore) return;
    setIsLoadingMore(true);
    window.setTimeout(() => {
      const nextPage = olderPages[loadedPageCount] || [];
      setMessages((prev) => [...nextPage, ...prev]);
      setLoadedPageCount((count) => count + 1);
      setIsLoadingMore(false);
    }, loadDelay);
  }, [isLoadingMore, loadDelay, loadedOlder, loadedPageCount, olderPages]);

  return (
    <div className="flex h-screen min-h-0 flex-col bg-surface text-text-primary" data-testid="chat-load-more-history-fixture" data-loaded-older={loadedOlder ? "true" : "false"} data-loaded-pages={loadedPageCount} data-loading-more={isLoadingMore ? "true" : "false"}>
      <div className="shrink-0 border-b border-surface-border px-4 py-2 text-xs text-text-secondary">
        load more history fixture · loaded pages: <span data-testid="load-more-loaded-pages">{loadedPageCount}</span> / {pages}
      </div>
      <div className="flex min-h-0 flex-1">
        <MessageList
          messages={messages}
          isLoading={false}
          models={models}
          conversationId={1000}
          isLoadingMore={isLoadingMore}
          hasMoreMessages={!loadedOlder}
          onLoadMore={handleLoadMore}
        />
      </div>
    </div>
  );
}
