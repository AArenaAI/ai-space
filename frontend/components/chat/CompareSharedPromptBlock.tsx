"use client";

import { memo, useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import type { Message } from "@/lib/chatTypes";
import UserMessageContent from "./UserMessageContent";

type CompareSharedPromptBlockProps = {
  message: Message;
  imageLoadFailedLabel: string;
  canEdit?: boolean;
  isLoading?: boolean;
  onEditUserMessage?: (message: Message, content: string) => Promise<void>;
};

function CompareSharedPromptBlock({ message, imageLoadFailedLabel, canEdit = false, isLoading = false, onEditUserMessage }: CompareSharedPromptBlockProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.content || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditing) setDraft(message.content || "");
  }, [isEditing, message.content]);

  const save = async () => {
    if (!onEditUserMessage || saving) return;
    const next = draft.trim();
    if (!next) {
      setError("消息内容不能为空");
      return;
    }
    if (next === (message.content || "").trim()) {
      setIsEditing(false);
      setError(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onEditUserMessage(message, next);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "编辑消息失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="group/compare-user relative rounded-2xl rounded-br-sm bg-surface-elevated px-4 py-3 text-text-primary shadow-sm">
      {isEditing ? (
        <div className="flex flex-col gap-2" data-testid="chat-user-message-edit-form">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-[96px] w-full resize-y rounded-xl border border-surface-border bg-surface-card px-3 py-2 text-sm leading-relaxed text-text-primary outline-none focus:border-brand"
            autoFocus
          />
          {error ? <div className="text-xs text-red-500">{error}</div> : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setIsEditing(false); setError(null); setDraft(message.content || ""); }}
              className="rounded-lg border border-surface-border px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
              disabled={saving}
              data-testid="chat-user-message-edit-cancel"
            >
              取消
            </button>
            <button
              type="button"
              onClick={save}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
              disabled={saving}
              data-testid="chat-user-message-edit-save"
            >
              {saving ? "保存中" : "保存并重新生成"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <UserMessageContent message={message} imageLoadFailedLabel={imageLoadFailedLabel} />
          {canEdit && onEditUserMessage && !isLoading ? (
            <button
              type="button"
              onClick={() => { setDraft(message.content || ""); setError(null); setIsEditing(true); }}
              className="absolute -right-2 -top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-surface-border bg-surface-card text-text-tertiary opacity-0 shadow-sm transition hover:text-text-primary group-hover/compare-user:opacity-100"
              data-testid="chat-user-message-edit-action"
              aria-label="编辑消息"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

export default memo(CompareSharedPromptBlock);
