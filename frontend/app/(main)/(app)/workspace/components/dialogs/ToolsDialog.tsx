"use client";

import { useState } from "react";
import {
  Wrench,
  Plus,
  Check,
  Pencil,
  Trash2,
  Loader2,
  MessageSquare,
  Briefcase,
  PuzzleIcon,
} from "lucide-react";
import DialogShell, { THEMES } from "./DialogShell";
import { useTemplates } from "@/hooks/useTemplates";
import { getErrorMessage } from "@/lib/errors";

export default function ToolsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { templates, loading, createTemplate, updateTemplate, deleteTemplate } =
    useTemplates();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrefix, setNewPrefix] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrefix, setEditPrefix] = useState("");
  const [busy, setBusy] = useState(false);
  const theme = THEMES.orange;

  const handleCreate = async () => {
    if (!newName.trim() || !newPrefix.trim()) return;
    setBusy(true);
    try {
      await createTemplate(newName.trim(), newPrefix.trim());
      setNewName("");
      setNewPrefix("");
      setCreating(false);
    } catch (e) {
      alert(getErrorMessage(e, { fallbackMessage: "创建失败，请稍后重试。" }));
    } finally {
      setBusy(false);
    }
  };

  const handleUpdate = async (id: number) => {
    setBusy(true);
    try {
      await updateTemplate(id, {
        name: editName.trim(),
        prefix: editPrefix.trim(),
      });
      setEditing(null);
    } catch (e) {
      alert(getErrorMessage(e, { fallbackMessage: "更新失败，请稍后重试。" }));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定删除该模板？")) return;
    setBusy(true);
    try {
      await deleteTemplate(id);
    } catch (e) {
      alert(getErrorMessage(e, { fallbackMessage: "删除失败，请稍后重试。" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      title="模板工具箱"
      icon={<Briefcase className={`h-4 w-4 ${theme.primary}`} />}
      size="lg"
      theme={theme}
    >
      {/* 橙色工坊氛围 */}
      <div className={`mb-3 flex items-center gap-3 rounded-xl ${theme.primaryBg} ${theme.primaryBorder} border px-4 py-2.5`}>
        <PuzzleIcon className={`h-4 w-4 ${theme.primary}`} />
        <div className="flex-1">
          <p className="text-xs font-medium text-text-primary">工具工坊</p>
          <p className="text-[10px] text-text-tertiary">{templates.length} 个模板 · 打造你的专属 AI 助手</p>
        </div>
      </div>

      {/* 创建 - 橙色主题 */}
      {!creating ? (
        <button
          onClick={() => setCreating(true)}
          className={`mb-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed ${theme.primaryBorder} bg-surface-card py-2.5 text-sm text-text-secondary transition-colors hover:${theme.primaryBg} hover:${theme.primary}`}
        >
          <Plus className="h-4 w-4" />
          新建模板
        </button>
      ) : (
        <div className={`mb-4 space-y-2 rounded-xl border ${theme.primaryBorder} bg-surface-card p-3`}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="模板名称"
            className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-orange-500"
          />
          <textarea
            value={newPrefix}
            onChange={(e) => setNewPrefix(e.target.value)}
            placeholder="模板前缀 / 系统提示词"
            className="h-20 w-full resize-none rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-orange-500"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={busy || !newName.trim() || !newPrefix.trim()}
              className={`flex-1 rounded-lg ${theme.accent} py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50`}
            >
              {busy ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              ) : (
                "创建"
              )}
            </button>
            <button
              onClick={() => {
                setCreating(false);
                setNewName("");
                setNewPrefix("");
              }}
              className="flex-1 rounded-lg bg-surface-card py-2 text-xs text-text-secondary hover:text-text-primary"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 模板列表 */}
      <div className="space-y-2">
        {loading && templates.length === 0 && (
          <div className="py-6 text-center text-xs text-text-tertiary">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
            加载中...
          </div>
        )}
        {templates.map((t) => (
          <div
            key={t.id}
            className={`rounded-xl border border-surface-border bg-surface-card p-3 transition-colors hover:border-orange-500/15`}
          >
            {editing === t.id ? (
              <div className="space-y-2">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-lg border border-surface-border bg-surface px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-orange-500"
                />
                <textarea
                  value={editPrefix}
                  onChange={(e) => setEditPrefix(e.target.value)}
                  className="h-16 w-full resize-none rounded-lg border border-surface-border bg-surface px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-orange-500"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleUpdate(t.id)}
                    disabled={busy}
                    className={`rounded-lg ${theme.accent} px-3 py-1 text-xs text-white hover:opacity-90 disabled:opacity-50`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    className="rounded-lg bg-surface-card px-3 py-1 text-xs text-text-secondary"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2.5">
                <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${theme.primaryBg}`}>
                  <MessageSquare className={`h-3.5 w-3.5 ${theme.primary}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-text-primary">
                      {t.name}
                    </p>
                    {t.is_default && (
                      <span className={`rounded-full ${theme.primaryBg} px-1.5 py-0.5 text-[9px] ${theme.primary}`}>
                        默认
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-text-tertiary">
                    {t.prefix}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      setEditing(t.id);
                      setEditName(t.name);
                      setEditPrefix(t.prefix);
                    }}
                    className="rounded-md p-1 text-text-tertiary hover:bg-surface hover:text-text-primary"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="rounded-md p-1 text-text-tertiary hover:bg-surface hover:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {templates.length === 0 && !loading && (
          <div className="rounded-xl border border-dashed border-surface-border bg-surface-card p-8 text-center">
            <Briefcase className="mx-auto mb-2 h-8 w-8 text-text-tertiary/50" />
            <p className="text-xs text-text-tertiary">工具箱空空，创建一个模板吧</p>
          </div>
        )}
      </div>
    </DialogShell>
  );
}
