"use client";

import { useEffect, useMemo, useState } from "react";
import { AssistantMessageMeta } from "./AssistantMessageMeta";
import AssistantSourceCitations from "./AssistantSourceCitations";
import MessageActions from "./MessageActions";
import MessageExportPreview from "./MessageExportPreview";
import MessageInput, { type AttachedFile } from "./MessageInput";
import { SelectionFloatingBar } from "./MessageExportActions";
import CodeBlock from "./markdown/CodeBlock";
import ShareDialog from "@/components/ui/ShareDialog";
import { useI18n } from "@/lib/i18n";
import type { ChatModel, Message, SearchSource } from "@/lib/chatTypes";

const model: ChatModel = {
  id: "fixture-model",
  name: "Fixture Model",
  provider: "fixture",
  description: "Synthetic fixture model",
  color: "#8b5cf6",
};

const now = 1_700_000_000_000;

const messages: Message[] = [
  {
    id: "fixture-user",
    role: "user",
    content: "Please summarize this source-grounded answer.",
    createdAt: now,
    serverMessageId: 1,
  },
  {
    id: "fixture-assistant",
    role: "assistant",
    model: model.id,
    content: "<think>Checked sources and compared claims.</think>Final answer with **evidence**.",
    createdAt: now + 1_000,
    generationStartedAt: now + 1_000,
    completedAt: now + 17_000,
    serverMessageId: 2,
    searchSourcesCount: 2,
    statusTimeline: [
      { id: "waiting_provider:completed", kind: "waiting_provider", status: "completed", startedAt: now + 1_000, endedAt: now + 2_000 },
      { id: "web_search:completed", kind: "web_search", status: "completed", startedAt: now + 2_000, endedAt: now + 4_000, count: 2 },
      { id: "reasoning:completed", kind: "reasoning", status: "completed", startedAt: now + 4_000, endedAt: now + 8_000 },
      { id: "streaming_answer:completed", kind: "streaming_answer", status: "completed", startedAt: now + 8_000, endedAt: now + 17_000 },
    ],
  },
];

const sources: SearchSource[] = [
  {
    title: "Notebook source",
    url: "notebook://fixture/source-1",
    description: "Notebook excerpt",
    snippet: "The answer should cite the selected source.",
    type: "notebook_file",
    page: 3,
  },
  {
    title: "Web source",
    url: "https://example.com/source",
    description: "Reference webpage",
    snippet: "External reference summary.",
    type: "web",
  },
];

const attachmentFixtures: AttachedFile[] = [
  {
    filename: "failed-report.pdf",
    content: "",
    type: "application/pdf",
    public_id: "fixture-failed-report",
    parse_status: "error",
    error_message: "File parsing failed. Please upload again or choose another file.",
  },
  {
    filename: "unsupported.bin",
    content: "",
    type: "application/octet-stream",
    public_id: "fixture-unsupported",
    parse_status: "unsupported",
  },
  {
    filename: "empty.txt",
    content: "",
    type: "text/plain",
    public_id: "fixture-empty",
    parse_status: "done",
  },
];

function ChatI18nResidueFixtureInner() {
  const { language, setLanguage, t } = useI18n();
  const [shareOpen, setShareOpen] = useState(true);
  const ready = language === "en";
  const assistant = messages[1];

  useEffect(() => {
    if (language !== "en") setLanguage("en");
  }, [language, setLanguage]);

  const inputModel = useMemo(() => ({ ...model, capabilities: ["file_upload"] }), []);

  if (!ready) {
    return <div data-testid="chat-i18n-fixture" data-locale-ready="false">Preparing English fixture...</div>;
  }

  return (
    <main className="min-h-screen bg-surface px-6 py-6 text-text-primary" data-testid="chat-i18n-fixture" data-locale-ready="true">
      <section className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="rounded-2xl border border-surface-border bg-surface-card p-4">
          <h1 className="text-lg font-semibold">Chat i18n residue fixture</h1>
          <p className="text-sm text-text-secondary">English locale visible text should not contain Chinese characters.</p>
        </header>

        <section className="rounded-2xl border border-surface-border bg-surface-card p-4" data-testid="fixture-status-actions">
          <AssistantMessageMeta msg={assistant} model={model} isStreaming={false} />
          <MessageActions
            onCopy={() => undefined}
            onRegenerate={() => undefined}
            onShareSelectMode={() => undefined}
            onFavoriteSelectMode={() => undefined}
            onForkCompare={() => undefined}
            isFavorited={false}
            showRegenerate
            align="left"
            visible
            createdAt={assistant.createdAt}
            completedAt={assistant.completedAt}
          />
        </section>

        <section className="rounded-2xl border border-surface-border bg-surface-card p-4" data-testid="fixture-source-code">
          <AssistantSourceCitations sources={sources} />
          <div className="mt-4">
            <CodeBlock language="ts" value={'export const answer = "source-grounded";\n'} />
          </div>
        </section>

        <section className="relative min-h-[96px] overflow-hidden rounded-2xl border border-surface-border bg-surface-card p-4" data-testid="fixture-selection-export">
          <SelectionFloatingBar
            selectionMode="share"
            selectedCount={2}
            hasSelection
            allSelected={false}
            sharing={false}
            exporting={false}
            favoriteLoading={false}
            onCancel={() => undefined}
            onSelectAll={() => undefined}
            onConfirmShare={() => undefined}
            onConfirmFavorite={() => undefined}
            onExportImage={() => undefined}
            onExportText={() => undefined}
          />
        </section>

        <section className="rounded-2xl border border-surface-border bg-surface-card p-4" data-testid="fixture-input-attachments">
          <div className="mb-2 text-sm font-medium text-text-secondary">Attachment error chips</div>
          <MessageInput
            onSend={() => ({ accepted: true })}
            onStop={() => undefined}
            isLoading={false}
            compareMode={false}
            onToggleCompare={() => undefined}
            currentModel={inputModel}
            templates={[]}
            selectedTemplateId={0}
            onSelectTemplate={() => undefined}
            onNewChat={() => undefined}
            initialAttachedFiles={attachmentFixtures}
          />
        </section>

        <button type="button" className="w-fit rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white" onClick={() => setShareOpen(true)}>
          {t("chat.action.generateShareLink")}
        </button>
      </section>

      <ShareDialog isOpen={shareOpen} slug="fixture-share" onClose={() => setShareOpen(false)} />
      <MessageExportPreview
        messages={messages}
        previewOpen
        exporting={false}
        onClose={() => undefined}
        onDownload={() => undefined}
      />
    </main>
  );
}

export default function ChatI18nResidueFixture() {
  return <ChatI18nResidueFixtureInner />;
}
