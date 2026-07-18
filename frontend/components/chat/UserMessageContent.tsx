"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, FileText, Quote } from "lucide-react";
import type { Message } from "@/lib/chatTypes";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { emitChatRenderProfileEvent, isChatRenderProfileEnabled } from "@/lib/chatRenderProfile";

type UserMessageContentProps = {
  message: Message;
  imageLoadFailedLabel: string;
  onEditRequest?: () => void;
};

const LONG_USER_MESSAGE_CHAR_THRESHOLD = 2000;
const LONG_USER_MESSAGE_LINE_THRESHOLD = 40;
const USER_MESSAGE_COLLAPSED_CHAR_LIMIT = 1200;
const USER_MESSAGE_COLLAPSED_LINE_LIMIT = 18;

function formatUserMessageSize(lineCount: number, charCount: number, t: (key: string, params?: Record<string, string>) => string) {
  const charLabel = charCount >= 1000
    ? t("chat.userContent.approxKChars", { count: (charCount / 1000).toFixed(1) })
    : t("chat.userContent.approxChars", { count: String(charCount) });
  return t("chat.userContent.size", { chars: charLabel, lines: String(lineCount) });
}

function splitLeadingQuote(content: string) {
  const lines = content.split("\n");
  const quoteLines: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith(">")) {
      quoteLines.push(line.replace(/^>\s?/, ""));
      index += 1;
      continue;
    }

    if (quoteLines.length > 0 && line.trim() === "") {
      index += 1;
      break;
    }

    break;
  }

  if (quoteLines.length === 0) {
    return { quote: "", body: content };
  }

  return {
    quote: quoteLines.join("\n").trim(),
    body: lines.slice(index).join("\n").trimStart(),
  };
}

function getCollapsedContent(content: string, t: (key: string, params?: Record<string, string>) => string) {
  const lines = content.split("\n");
  const lineCount = lines.length;
  const charCount = content.length;
  const isLong = charCount > LONG_USER_MESSAGE_CHAR_THRESHOLD || lineCount > LONG_USER_MESSAGE_LINE_THRESHOLD;
  const sizeLabel = formatUserMessageSize(lineCount, charCount, t);
  if (!isLong) return { isLong, preview: content, sizeLabel };

  const previewByLines = lines.slice(0, USER_MESSAGE_COLLAPSED_LINE_LIMIT).join("\n");
  const preview = previewByLines.length > USER_MESSAGE_COLLAPSED_CHAR_LIMIT
    ? `${previewByLines.slice(0, USER_MESSAGE_COLLAPSED_CHAR_LIMIT).trimEnd()}…`
    : `${previewByLines.trimEnd()}…`;

  return { isLong, preview, sizeLabel };
}

function UserMessageContent({ message, imageLoadFailedLabel, onEditRequest }: UserMessageContentProps) {
  const profileEnabled = isChatRenderProfileEnabled();
  const renderStartedAt = profileEnabled ? (typeof performance !== "undefined" ? performance.now() : Date.now()) : 0;
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const imageFiles = message.files?.filter((file) => file.type === "image") || [];
  const otherFiles = message.files?.filter((file) => file.type !== "image") || [];
  const { quote, body } = useMemo(() => splitLeadingQuote(message.content || ""), [message.content]);
  const { isLong, preview, sizeLabel } = useMemo(() => getCollapsedContent(body, t), [body, t]);
  const visibleBody = isLong && !expanded ? preview : body;
  useEffect(() => {
    if (!profileEnabled) return;
    const commitAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    emitChatRenderProfileEvent("user-message-content-commit", {
      messageId: message.id,
      contentLength: message.content?.length || 0,
      bodyLength: body.length,
      hasQuote: Boolean(quote),
      imageFileCount: imageFiles.length,
      otherFileCount: otherFiles.length,
      isLong,
      expanded,
      durationMs: commitAt - renderStartedAt,
    });
  });

  return (
    <div className="flex flex-col gap-2" data-testid="user-message-content">
      {imageFiles.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="user-message-image-files">
          {imageFiles.map((file, index) => (
            <div key={`${file.public_id}-${index}`} className="relative group/file rounded-xl overflow-hidden border border-surface-border bg-surface-card">
              <img
                src={`/api/files/${file.public_id}/download`}
                alt={file.filename}
                className="max-w-[200px] max-h-[200px] object-cover rounded-xl"
                data-testid="user-message-image"
                onError={(event) => {
                  (event.target as HTMLImageElement).src = "";
                  (event.target as HTMLImageElement).classList.add("hidden");
                  (event.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
                }}
              />
              <div className="hidden text-xs text-text-tertiary px-3 py-2">{imageLoadFailedLabel}</div>
            </div>
          ))}
        </div>
      )}

      {otherFiles.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="user-message-file-list">
          {otherFiles.map((file, index) => (
            <a
              key={`${file.public_id}-${index}`}
              href={`/api/files/${file.public_id}/download`}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="user-message-file-chip"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-card border border-surface-border hover:border-brand/30 transition-colors"
            >
              <FileText className="w-4 h-4 text-text-tertiary shrink-0" />
              <span className="text-[13px] text-text-secondary truncate max-w-[200px]">{file.filename}</span>
            </a>
          ))}
        </div>
      )}

      {quote ? (
        <div
          className="rounded-xl border border-surface-border/70 bg-surface-elevated/70 px-3 py-2 shadow-sm"
          data-testid="user-message-quote-card"
        >
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-text-tertiary">
            <Quote className="h-3.5 w-3.5 text-brand" />
            {t("chat.quote.title")}
          </div>
          <div className="border-l-2 border-brand/50 pl-2 text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words line-clamp-4">
            {quote}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col items-start gap-1.5">
        {visibleBody ? (
          <p
            className={cn("text-[15px] leading-relaxed text-text-primary whitespace-pre-wrap break-words", isLong && !expanded && "relative")}
            data-testid="user-message-text"
          >
            {visibleBody}
          </p>
        ) : null}
        {isLong ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-elevated/70 px-2.5 py-1 text-xs text-text-secondary transition-colors hover:border-brand/30 hover:text-text-primary"
            data-testid="user-message-collapse-toggle"
            aria-expanded={expanded}
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
            {expanded ? t("chat.userContent.collapseLong", { size: sizeLabel }) : t("chat.userContent.expandFull", { size: sizeLabel })}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default UserMessageContent;
