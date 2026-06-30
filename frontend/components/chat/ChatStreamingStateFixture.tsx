"use client";

import { useEffect, useMemo, useState } from "react";
import MessageList from "./MessageList";
import ChatActivityPanel from "./ChatActivityPanel";
import StreamingMarkdownView from "./StreamingMarkdownView";
import { Message, ChatModel } from "@/lib/chatTypes";
import { realtimeAppend, realtimeClear, realtimeGet, realtimeMarkCompleted, realtimeUpdate } from "@/lib/streaming";

const models: ChatModel[] = [
  { id: "fixture-model", name: "Fixture Model", provider: "fixture", description: "Synthetic chat state fixture", color: "#8b5cf6" },
];

const COMPLEX_STREAMING_MARKDOWN = [
  "复杂 Markdown streaming fallback 样本。",
  "",
  "```ts",
  "export function expensiveStreamingMarkdown() {",
  "  return 'avoid parsing while streaming';",
  "}",
  "```",
  "",
  "| 项目 | 状态 |",
  "| --- | --- |",
  "| streaming | plain fallback |",
].join("\n");

function baseMessages(): Message[] {
  return [
    {
      id: "fixture-user",
      role: "user",
      content: "请联网搜索并先思考再回答。",
      createdAt: 1_700_000_000_000,
      serverMessageId: 1,
    },
    {
      id: "fixture-assistant",
      role: "assistant",
      content: "",
      model: "fixture-model",
      createdAt: 1_700_000_001_000,
      serverMessageId: 2,
      searchStatus: "searching",
      activityStatus: { kind: "web_search", status: "searching", label: "正在联网搜索" },
    },
  ];
}

export default function ChatStreamingStateFixture() {
  const assistantId = "fixture-assistant";
  const [fixtureOptions, setFixtureOptions] = useState({ longActivityReasoning: false, forceActivityPanelOpen: false });
  const { longActivityReasoning, forceActivityPanelOpen } = fixtureOptions;
  const [messages, setMessages] = useState<Message[]>(() => baseMessages());
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState("init");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFixtureOptions({
      longActivityReasoning: params.has("activity_reasoning_long"),
      forceActivityPanelOpen: params.has("activity_panel_open"),
    });
  }, []);

  useEffect(() => {
    realtimeClear(assistantId);
    setMessages(baseMessages());
    setLoading(true);
    setPhase("searching");

    realtimeUpdate(assistantId, {
      content: "",
      phase: "waiting_provider",
      generationStartedAt: Date.now(),
    });

    const reasoningChunks = longActivityReasoning
      ? [
          "先分析搜索结果，确认每个来源的时间、主体和结论是否一致。",
          "然后排除重复来源，把相互矛盾的说法按可信度排序。",
          "最后只保留和用户问题直接相关的信息，避免把检索过程写进最终回答。",
        ]
      : ["先分析搜索结果，确认 **最终** 只输出简短回答。"];
    const answerStartDelay = longActivityReasoning ? 4200 : 1700;
    const doneDelay = longActivityReasoning ? 7000 : 3000;

    const timers = [
      window.setTimeout(() => {
        realtimeUpdate(assistantId, {
          content: "",
          searchStatus: "searching",
          activityStatus: { kind: "web_search", status: "searching", label: "正在联网搜索" },
          phase: "searching",
        });
        setPhase("searching");
      }, 80),
      window.setTimeout(() => {
        realtimeUpdate(assistantId, {
          searchStatus: "completed",
          searchSourcesCount: 8,
          searchSources: Array.from({ length: 8 }, (_, index) => ({ title: `来源 ${index + 1}`, url: `https://example.com/${index + 1}`, description: "fixture" })),
          activityStatus: { kind: "web_search", status: "completed", label: "联网搜索完成" },
        });
      }, 900),
      window.setTimeout(() => {
        // Simulate a provider/SSE event that carries reasoning and visible answer
        // in the same payload. The frontend must show reasoning first and hold
        // the answer until reasoning is closed.
        realtimeAppend(assistantId, { reasoningDelta: reasoningChunks[0], reasoning: true });
        setPhase("mixed-held");
      }, 1200),
      ...(longActivityReasoning ? [
        window.setTimeout(() => {
          realtimeAppend(assistantId, { reasoningDelta: reasoningChunks[1], reasoning: true });
          setPhase("reasoning-chunk-2");
        }, 2100),
        window.setTimeout(() => {
          realtimeAppend(assistantId, { reasoningDelta: reasoningChunks[2], reasoning: true });
          setPhase("reasoning-chunk-3");
        }, 3000),
      ] : []),
      window.setTimeout(() => {
        realtimeAppend(assistantId, { reasoning: false });
        realtimeAppend(assistantId, { answerDelta: "最终回答 **", reasoning: false });
        setPhase("answer-streaming");
      }, answerStartDelay),
      window.setTimeout(() => {
        realtimeAppend(assistantId, { answerDelta: "OK", reasoning: false });
      }, answerStartDelay + 250),
      window.setTimeout(() => {
        realtimeAppend(assistantId, { answerDelta: "** 42", reasoning: false });
      }, answerStartDelay + 450),
      window.setTimeout(() => {
        // Simulate DONE without a search-completed meta event. This used to leave
        // the web-search badge stuck in the running state.
        realtimeUpdate(assistantId, { activityStatus: undefined, searchStatus: undefined, phase: "completed" });
        realtimeMarkCompleted(assistantId);
        const finalData = realtimeGet(assistantId);
        const completedAt = Date.now();
        setMessages((prev) => prev.map((message) => message.id === assistantId
          ? {
              ...message,
              ...finalData,
              content: "<think>先分析搜索结果，确认 **最终** 只输出简短回答。</think>最终回答 **OK** 42",
              completedAt,
              activityStatus: undefined,
              searchStatus: undefined,
              // Simulate a real-provider noisy timestamp case seen with DS: answer
              // generation can be captured earlier than reasoning completion, but
              // the user-facing timeline should still display reasoning before
              // the final answer generation step.
              statusTimeline: finalData?.statusTimeline?.map((step) => step.kind === "streaming_answer"
                ? { ...step, startedAt: (finalData.generationStartedAt || completedAt) + 250 }
                : step.kind === "reasoning"
                  ? { ...step, startedAt: (finalData.generationStartedAt || completedAt) + 700 }
                  : step
              ),
            }
          : message
        ));
        setLoading(false);
        setPhase("done");
      }, doneDelay),
    ];

    return () => {
      timers.forEach(window.clearTimeout);
      realtimeClear(assistantId);
    };
  }, [longActivityReasoning]);

  const marker = useMemo(() => JSON.stringify({ phase, loading }), [phase, loading]);

  return (
    <div className="flex h-screen min-h-0 flex-col bg-surface text-text-primary" data-testid="chat-streaming-state-fixture" data-state={marker}>
      <div className="shrink-0 border-b border-surface-border px-4 py-2 text-xs text-text-secondary">
        streaming state fixture · phase=<span data-testid="fixture-phase">{phase}</span>
      </div>
      <div className="max-h-32 overflow-auto opacity-0 pointer-events-none" data-testid="complex-streaming-markdown-fixture" aria-hidden="true">
        <div data-testid="complex-streaming-markdown-active">
          <StreamingMarkdownView content={COMPLEX_STREAMING_MARKDOWN} isStreaming />
        </div>
        <div data-testid="complex-streaming-markdown-done">
          <StreamingMarkdownView content={COMPLEX_STREAMING_MARKDOWN} isStreaming={false} idleTimeout={1} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <MessageList
          messages={messages}
          isLoading={loading}
          models={models}
          conversationId={999}
          isLoadingMore={false}
          hasMoreMessages={false}
        />
        {forceActivityPanelOpen && (
          <div className="relative w-[420px] shrink-0 border-l border-surface-border" data-testid="fixture-activity-panel-host">
            <ChatActivityPanel
              message={messages.find((message) => message.id === assistantId)}
              model={models[0]}
              onClose={() => undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}
