"use client";

import { Ref } from "react";
import { Bot, Download, Lightbulb, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { Message } from "@/lib/chatTypes";
import { parseThinkContent, sanitizeContent } from "@/lib/chatContent";
import MarkdownRenderer from "./MarkdownRenderer";

function ExportMessageContent({ msg }: { msg: Message }) {
  const { t } = useI18n();
  if (msg.role === "user") {
    return <div className="whitespace-pre-wrap break-words">{msg.content || ""}</div>;
  }

  const { reasoning, answer, isThinking } = parseThinkContent(msg.content || "");
  const cleanAnswer = sanitizeContent(answer);

  return (
    <div className="prose prose-sm max-w-none text-white/90">
      {reasoning && (
        <div className="mb-3 overflow-hidden rounded-xl border border-white/10 bg-white/8">
          <div className="flex items-center gap-2 px-3 py-2 bg-white/10">
            <Lightbulb className="h-3.5 w-3.5 shrink-0 text-amber-300" />
            <span className="text-sm font-medium text-white/75">
              {isThinking ? t("chat.reasoning.inProgress") : t("chat.reasoning.title")}
            </span>
          </div>
          <div className="whitespace-pre-wrap px-3 py-2.5 text-[13px] leading-relaxed text-white/70">
            {reasoning}
          </div>
        </div>
      )}
      <MarkdownRenderer content={cleanAnswer} />
    </div>
  );
}

function ExportShareCard({ messages, cardRef }: { messages: Message[]; cardRef?: Ref<HTMLDivElement> }) {
  const { t, language } = useI18n();
  return (
    <div
      ref={cardRef}
      className="relative w-full overflow-hidden rounded-3xl p-8 shadow-2xl"
      style={{
        background: "linear-gradient(135deg, #111827 0%, #1e1b4b 48%, #312e81 100%)",
      }}
    >
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-brand/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-16 h-44 w-44 rounded-full bg-purple-500/25 blur-3xl" />

      <div className="relative z-10 mb-7 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/12 ring-1 ring-white/15">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-lg font-semibold text-white">AI Space</div>
          <div className="text-xs text-white/50">{t("chat.export.previewSubtitle")}</div>
        </div>
      </div>

      <div className="relative z-10 space-y-5">
        {messages.map((msg) => {
          const isUser = msg.role === "user";
          return (
            <div key={msg.id} className={cn("flex", isUser ? "justify-end" : "justify-start gap-3")}>
              {!isUser && (
                <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10">
                  <Bot className="h-4 w-4 text-white/70" />
                </div>
              )}
              <div className="max-w-[82%]">
                {!isUser && <div className="mb-1 ml-1 text-[11px] text-white/45">AI Space</div>}
                <div
                  className={cn(
                    "break-words rounded-2xl border px-4 py-3 text-sm leading-relaxed shadow-sm",
                    isUser
                      ? "rounded-br-md border-white/15 bg-white/18 text-white"
                      : "rounded-bl-md border-white/10 bg-white/10 text-white/90"
                  )}
                >
                  <ExportMessageContent msg={msg} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="relative z-10 mt-8 flex items-center justify-between border-t border-white/10 pt-5 text-xs text-white/45">
        <span>{new Date().toLocaleDateString(language)}</span>
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" /> {t("chat.export.generatedBy")}
        </span>
      </div>
    </div>
  );
}

export default function MessageExportPreview({
  messages,
  previewOpen,
  exporting,
  previewCardRef,
  hiddenCardRef,
  onClose,
  onDownload,
}: {
  messages: Message[];
  previewOpen: boolean;
  exporting: boolean;
  previewCardRef?: Ref<HTMLDivElement>;
  hiddenCardRef?: Ref<HTMLDivElement>;
  onClose: () => void;
  onDownload: () => void;
}) {
  const { t } = useI18n();
  if (messages.length === 0) return null;

  return (
    <>
      {previewOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={onClose}
            aria-label={t("chat.export.closePreview")}
          />
          <div className="relative z-10 flex max-h-full w-full max-w-[620px] flex-col items-center gap-4">
            <div className="w-full overflow-auto rounded-3xl bg-surface-elevated p-3 shadow-2xl">
              <ExportShareCard messages={messages} cardRef={previewCardRef} />
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-surface-border bg-surface-elevated px-4 py-3 shadow-xl">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-4 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors"
              >
                {t("chat.action.cancel")}
              </button>
              <button
                type="button"
                onClick={onDownload}
                disabled={exporting}
                className="flex items-center gap-2 rounded-xl bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Download className="w-4 h-4" />
                {exporting ? t("chat.export.exporting") : t("chat.export.downloadImage")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        style={{ position: "fixed", left: 0, top: 0, width: "560px", opacity: 0, pointerEvents: "none", zIndex: -1 }}
      >
        <ExportShareCard messages={messages} cardRef={hiddenCardRef} />
      </div>
    </>
  );
}
