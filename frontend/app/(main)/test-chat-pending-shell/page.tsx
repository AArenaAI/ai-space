import MessageList from "@/components/chat/MessageList";
import type { ChatModel, Message } from "@/lib/chatTypes";

const models: ChatModel[] = [
  { id: "pending-model", name: "Pending Model", provider: "fixture", description: "Pending fixture model", color: "#64748b" },
  { id: "pending-model-b", name: "Pending Model B", provider: "fixture", description: "Pending fixture model B", color: "#64748b" },
];

const now = 1_700_000_000_000;

const ordinaryMessages: Message[] = [
  { id: "ordinary-user", role: "user", content: "普通 Chat pending 回测", createdAt: now, serverMessageId: 1 },
  {
    id: "ordinary-assistant-pending",
    role: "assistant",
    content: "",
    model: "pending-model",
    createdAt: now + 1000,
    serverMessageId: 2,
    activityStatus: { kind: "generating", status: "running", label: "正在生成" },
  },
];

const compareMessages: Message[] = [
  { id: "compare-user", role: "user", content: "Compare pending 回测", createdAt: now + 2000, serverMessageId: 10 },
  {
    id: "compare-assistant-a",
    role: "assistant",
    content: "",
    model: "pending-model",
    createdAt: now + 3000,
    serverMessageId: 11,
    groupId: 77,
    groupIndex: 0,
    groupModels: ["pending-model", "pending-model-b"],
    userMessageId: 10,
    activityStatus: { kind: "generating", status: "running", label: "正在生成" },
  },
];

const activityMessages: Message[] = [
  { id: "activity-user", role: "user", content: "思考面板回测", createdAt: now + 4000, serverMessageId: 20 },
  {
    id: "activity-assistant",
    role: "assistant",
    content: "带思考和来源的回答。",
    model: "pending-model",
    createdAt: now + 5000,
    completedAt: now + 6500,
    serverMessageId: 21,
    reasoningContent: "这里是思考内容。",
    searchSources: [{ title: "Example", url: "https://example.com/a", description: "fixture" }],
    searchSourcesCount: 1,
    statusTimeline: [
      { id: "reasoning:completed", kind: "reasoning", status: "completed", startedAt: now + 5100, endedAt: now + 5900 },
      { id: "web_search:completed", kind: "web_search", status: "completed", startedAt: now + 5200, endedAt: now + 6000, count: 1 },
    ],
  },
];

export default function TestChatPendingShellPage() {
  return (
    <main className="flex min-h-screen flex-col gap-4 bg-surface p-4 text-text-primary" data-testid="chat-pending-shell-fixture">
      <section className="h-[260px] min-h-0 rounded-2xl border border-surface-border bg-surface-card/40" data-testid="ordinary-pending-section">
        <MessageList messages={ordinaryMessages} isLoading models={models} conversationId={9001} hasMoreMessages={false} />
      </section>
      <section className="h-[320px] min-h-0 rounded-2xl border border-surface-border bg-surface-card/40" data-testid="compare-pending-section">
        <MessageList messages={compareMessages} isLoading models={models} conversationId={9002} hasMoreMessages={false} isCompare compareModels={["pending-model", "pending-model-b"]} />
      </section>
      <section className="h-[320px] min-h-0 rounded-2xl border border-surface-border bg-surface-card/40" data-testid="activity-section">
        <MessageList messages={activityMessages} isLoading={false} models={models} conversationId={9003} hasMoreMessages={false} />
      </section>
    </main>
  );
}
