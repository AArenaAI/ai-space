"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import MessageList from "./MessageList";
import { Message, ChatModel } from "@/lib/chatTypes";

const LONG_MARKDOWN = [
  "# 长 Markdown 性能样本",
  "",
  "这是一段用于验证 Markdown 懒加载和虚拟列表首屏渲染的长内容。".repeat(20),
  "",
  "```ts",
  "export function sample(input: string) {",
  "  return input.split('').reverse().join('');",
  "}",
  "```",
  "",
  "| 项目 | 数值 | 说明 |",
  "| --- | ---: | --- |",
  "| alpha | 123 | 表格渲染样本 |",
  "| beta | 456 | 表格渲染样本 |",
  "",
  "- 列表项 A".repeat(40),
].join("\n");

function buildMessages(count: number, longEvery: number): Message[] {
  const now = 1_700_000_000_000;
  return Array.from({ length: count }, (_, index) => {
    const isUser = index % 2 === 0;
    const pair = Math.floor(index / 2) + 1;
    const content = isUser
      ? `这是第 ${pair} 轮用户消息，用于性能验证。`
      : (longEvery > 0 && pair % longEvery === 0
        ? `${LONG_MARKDOWN}\n\n轮次：${pair}\n\n${"补充说明。".repeat(600)}`
        : `这是第 ${pair} 轮助手回复。\n\n- 要点一\n- 要点二\n\n结束。`);
    return {
      id: `perf-${index + 1}`,
      role: isUser ? "user" : "assistant",
      content,
      model: isUser ? undefined : "perf-model",
      createdAt: now + index * 1000,
      completedAt: isUser ? undefined : now + index * 1000 + 500,
      serverMessageId: index + 1,
    } satisfies Message;
  });
}

function buildStreamingMessages(historyCount: number): Message[] {
  const evenHistoryCount = historyCount % 2 === 0 ? historyCount : historyCount - 1;
  const history = buildMessages(evenHistoryCount, 0);
  const now = 1_700_000_000_000 + evenHistoryCount * 1000;
  return [
    ...history,
    {
      id: "stream-user",
      role: "user",
      content: "请持续输出一段用于真实浏览器 streaming render benchmark 的长回答。",
      createdAt: now,
      serverMessageId: evenHistoryCount + 1,
    },
    {
      id: "stream-assistant",
      role: "assistant",
      content: "",
      model: "perf-model",
      createdAt: now + 1000,
      serverMessageId: evenHistoryCount + 2,
      activityStatus: { kind: "generating", status: "running", label: "Generating" },
    },
  ];
}

type RenderMetrics = {
  frameCount: number;
  maxFrameGap: number;
  avgFrameGap: number;
  longFrameCount: number;
  longTaskCount: number;
  longTaskDuration: number;
  deltaCount: number;
  elapsedMs: number;
  visibleMessageRows: number;
  allElements: number;
  bodyTextLength: number;
};

const STREAM_DELTA = "这是一段真实浏览器流式渲染增量，包含中文、标点和换行，用于观察 React commit、Virtuoso 测量和 DOM 更新成本。\n";

const models: ChatModel[] = [
  { id: "perf-model", name: "性能模型", provider: "local", description: "Synthetic performance model", color: "#64748b" },
];

export default function ChatPerformanceFixture() {
  const params = useSearchParams();
  const count = Math.max(0, Number(params?.get("count") || 1000));
  const longEvery = Math.max(0, Number(params?.get("longEvery") || 10));
  const hasMore = params?.get("hasMore") !== "0";
  const mode = params?.get("mode") || "static";
  const deltaCount = Math.max(1, Number(params?.get("deltas") || 240));
  const deltaInterval = Math.max(0, Number(params?.get("deltaInterval") || 16));
  const [loadMoreCount, setLoadMoreCount] = useState(0);
  const staticMessages = useMemo(() => buildMessages(count, longEvery), [count, longEvery]);
  const initialStreamingMessages = useMemo(() => buildStreamingMessages(count), [count]);
  const [streamMessages, setStreamMessages] = useState<Message[]>(initialStreamingMessages);
  const [renderMetrics, setRenderMetrics] = useState<RenderMetrics | null>(null);
  const frameGapsRef = useRef<number[]>([]);
  const longTaskRef = useRef({ count: 0, duration: 0 });
  const messages = mode === "stream" ? streamMessages : staticMessages;

  useEffect(() => {
    if (mode !== "stream") return;
    setStreamMessages(initialStreamingMessages);
    setRenderMetrics(null);
    frameGapsRef.current = [];
    longTaskRef.current = { count: 0, duration: 0 };

    let cancelled = false;
    let lastFrame = performance.now();
    let frameId = 0;
    const observeFrame = (ts: number) => {
      const gap = ts - lastFrame;
      if (gap > 0) frameGapsRef.current.push(gap);
      lastFrame = ts;
      if (!cancelled) frameId = requestAnimationFrame(observeFrame);
    };
    frameId = requestAnimationFrame(observeFrame);

    let observer: PerformanceObserver | null = null;
    if (typeof PerformanceObserver !== "undefined") {
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTaskRef.current.count += 1;
            longTaskRef.current.duration += entry.duration;
          }
        });
        observer.observe({ entryTypes: ["longtask"] });
      } catch {}
    }

    const start = performance.now();
    let emitted = 0;
    const timer = window.setInterval(() => {
      emitted += 1;
      const suffix = emitted % 12 === 0 ? `\n\n### 小节 ${emitted / 12}\n\n- 要点 A\n- 要点 B\n` : "";
      setStreamMessages((prev) => prev.map((message) => (
        message.id === "stream-assistant"
          ? { ...message, content: `${message.content}${STREAM_DELTA}${suffix}` }
          : message
      )));

      if (emitted >= deltaCount) {
        window.clearInterval(timer);
        window.setTimeout(() => {
          const frameGaps = frameGapsRef.current;
          const allElements = document.querySelectorAll("*").length;
          const visibleMessageRows = document.querySelectorAll('[data-testid="virtuoso-item-list"] > *').length;
          setRenderMetrics({
            frameCount: frameGaps.length,
            maxFrameGap: frameGaps.length ? Math.max(...frameGaps) : 0,
            avgFrameGap: frameGaps.length ? frameGaps.reduce((sum, value) => sum + value, 0) / frameGaps.length : 0,
            longFrameCount: frameGaps.filter((value) => value > 50).length,
            longTaskCount: longTaskRef.current.count,
            longTaskDuration: longTaskRef.current.duration,
            deltaCount,
            elapsedMs: performance.now() - start,
            visibleMessageRows,
            allElements,
            bodyTextLength: document.body.innerText.length,
          });
        }, 250);
      }
    }, deltaInterval);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      window.clearInterval(timer);
      observer?.disconnect();
    };
  }, [deltaCount, deltaInterval, initialStreamingMessages, mode]);

  return (
    <div className="flex h-screen min-h-0 flex-col bg-surface text-text-primary" data-testid="chat-performance-fixture">
      <div className="shrink-0 border-b border-surface-border px-4 py-2 text-xs text-text-secondary">
        perf fixture · mode={mode} · messages={messages.length} · loadMore={loadMoreCount}
        {renderMetrics && (
          <span
            className="ml-2"
            data-testid="chat-stream-render-metrics"
            data-metrics={JSON.stringify(renderMetrics)}
          >
            streamDone · maxFrameGap={renderMetrics.maxFrameGap.toFixed(1)}ms · longTasks={renderMetrics.longTaskCount}
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1">
        <MessageList
          messages={messages}
          isLoading={mode === "stream" && !renderMetrics}
          models={models}
          conversationId={999}
          isLoadingMore={false}
          hasMoreMessages={hasMore}
          onLoadMore={() => setLoadMoreCount((value) => value + 1)}
        />
      </div>
    </div>
  );
}
