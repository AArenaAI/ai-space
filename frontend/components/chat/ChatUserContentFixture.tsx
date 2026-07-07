"use client";

import MessageList from "./MessageList";
import type { ChatModel, Message } from "@/lib/chatTypes";

const models: ChatModel[] = [
  { id: "fixture-model", name: "Fixture Model", provider: "local", description: "User content fixture model", color: "#64748b" },
];

const longUserBody = Array.from({ length: 48 }, (_, index) => `这是用户长消息第 ${index + 1} 行，用于验证用户侧长内容折叠和展开后的完整展示。`).join("\n");
const longCode = Array.from({ length: 150 }, (_, index) => `console.log("long code line ${index + 1}");`).join("\n");

const messages: Message[] = [
  {
    id: "user-files",
    role: "user",
    content: "这是带文件的用户消息，应该显示文件 chip，并保持正文正常展示。",
    files: [
      { public_id: "fixture-doc", type: "text", filename: "需求说明.txt" },
      { public_id: "fixture-pdf", type: "application/pdf", filename: "长文档报告.pdf" },
    ],
    createdAt: 1_700_000_000_000,
    serverMessageId: 1,
  },
  {
    id: "assistant-code",
    role: "assistant",
    content: `<think>历史思考内容应该默认折叠，避免恢复旧会话时占满屏幕。</think>下面是一个长代码块，用于验证默认折叠。\n\n\`\`\`ts\n${longCode}\n\`\`\`\n\n代码块后面的正文也应该正常显示。`,
    model: "fixture-model",
    createdAt: 1_700_000_001_000,
    completedAt: 1_700_000_002_000,
    serverMessageId: 2,
  },
  {
    id: "user-quote",
    role: "user",
    content: "> 这是第 1 轮用户消息\n> 第二行引用内容\n\n请基于这段引用继续解释，并保持用户输入正文可读。",
    createdAt: 1_700_000_003_000,
    serverMessageId: 3,
  },
  {
    id: "user-long",
    role: "user",
    content: longUserBody,
    createdAt: 1_700_000_004_000,
    serverMessageId: 4,
  },
];

export default function ChatUserContentFixture() {
  return (
    <div className="flex h-screen min-h-0 flex-col bg-surface text-text-primary" data-testid="chat-user-content-fixture">
      <div className="shrink-0 border-b border-surface-border px-4 py-2 text-xs text-text-secondary">
        user content fixture · files · quote · long message · long code
      </div>
      <div className="flex min-h-0 flex-1">
        <MessageList
          messages={messages}
          isLoading={false}
          models={models}
          conversationId={999}
          onEditUserMessage={async () => undefined}
          canEditUserMessages
          isLoadingMore={false}
          hasMoreMessages={false}
        />
      </div>
    </div>
  );
}
