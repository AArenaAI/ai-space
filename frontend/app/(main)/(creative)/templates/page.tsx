"use client";

import { useState, useEffect } from "react";
import { useTemplates, Template } from "@/hooks/useTemplates";
import { Plus, Pencil, Trash2, Check, X, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { getErrorMessage } from "@/lib/errors";

export default function TemplatesPage() {
  const { t } = useI18n();
  const { templates, loading, createTemplate, updateTemplate, deleteTemplate } = useTemplates();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrefix, setEditPrefix] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrefix, setNewPrefix] = useState("");

  const handleCreate = async () => {
    if (!newName.trim() || !newPrefix.trim()) {
      toast.error(t("prompts.fill.required"));
      return;
    }
    try {
      await createTemplate(newName.trim(), newPrefix.trim());
      setNewName("");
      setNewPrefix("");
      setCreating(false);
      toast.success(t("prompts.create.success"));
    } catch (err) {
      toast.error(getErrorMessage(err, { fallbackMessage: t("prompts.create.error") }));
    }
  };

  const startEdit = (tpl: Template) => {
    setEditingId(tpl.id);
    setEditName(tpl.name);
    setEditPrefix(tpl.prefix);
  };

  const saveEdit = async (id: number) => {
    if (!editName.trim() || !editPrefix.trim()) {
      toast.error(t("prompts.fill.required"));
      return;
    }
    try {
      await updateTemplate(id, { name: editName.trim(), prefix: editPrefix.trim() });
      setEditingId(null);
      toast.success(t("prompts.save.success"));
    } catch (err) {
      toast.error(getErrorMessage(err, { fallbackMessage: t("prompts.save.error") }));
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t("prompts.delete.confirm"))) return;
    try {
      await deleteTemplate(id);
      toast.success(t("prompts.delete.success"));
    } catch (err) {
      toast.error(getErrorMessage(err, { fallbackMessage: t("prompts.delete.error") }));
    }
  };

  const setDefault = async (id: number, isDefault: boolean) => {
    try {
      await updateTemplate(id, { is_default: !isDefault });
    } catch (err) {
      toast.error(getErrorMessage(err, { fallbackMessage: t("prompts.setDefault.error") }));
    }
  };

  return (
    <div className="h-full flex flex-col bg-surface">
      <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">{t("prompts.title")}</h1>
          <p className="text-sm text-text-secondary mt-0.5">{t("prompts.subtitle")}</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          {t("prompts.new")}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-text-secondary">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            {t("common.loading")}
          </div>
        ) : templates.length === 0 && !creating ? (
          <div className="text-center py-16">
            <FileText className="w-12 h-12 mx-auto mb-4 text-text-tertiary" />
            <p className="text-text-secondary">{t("prompts.empty")}</p>
            <p className="text-sm text-text-tertiary mt-1">{t("prompts.empty.hint")}</p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-4">
            {/* 新建模板表单 */}
            {creating && (
              <div className="rounded-xl border border-surface-border bg-surface-elevated p-4 animate-fade-in">
                <h3 className="text-sm font-medium text-text-primary mb-3">{t("prompts.create.title")}</h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-text-secondary mb-1 block">{t("prompts.create.name")}</label>
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder={t("prompts.create.name.placeholder")}
                      className="w-full px-3 py-2 rounded-lg border border-surface-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text-secondary mb-1 block">{t("prompts.create.prefix")}</label>
                    <textarea
                      value={newPrefix}
                      onChange={(e) => setNewPrefix(e.target.value)}
                      placeholder={t("prompts.create.prefix.placeholder")}
                      rows={4}
                      className="w-full px-3 py-2 rounded-lg border border-surface-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 resize-vertical"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setCreating(false)}
                      className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-surface-card transition-colors"
                    >
                      {t("prompts.create.cancel")}
                    </button>
                    <button
                      onClick={handleCreate}
                      className="px-4 py-1.5 rounded-lg bg-brand text-white text-sm font-medium hover:opacity-90"
                    >
                      {t("prompts.create.submit")}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 模板列表 */}
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className={cn(
                  "rounded-xl border p-4 transition-colors",
                  tpl.is_default
                    ? "border-brand/40 bg-brand/5"
                    : "border-surface-border bg-surface-elevated"
                )}
              >
                {editingId === tpl.id ? (
                  <div className="space-y-3">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-surface-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
                    />
                    <textarea
                      value={editPrefix}
                      onChange={(e) => setEditPrefix(e.target.value)}
                      rows={4}
                      className="w-full px-3 py-2 rounded-lg border border-surface-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 resize-vertical"
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditingId(null)} className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-surface-card transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                      <button onClick={() => saveEdit(tpl.id)} className="px-3 py-1.5 rounded-lg bg-brand text-white text-sm font-medium hover:opacity-90">
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-text-primary">{tpl.name}</h3>
                        {tpl.is_default && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand/10 text-brand font-medium">{t("prompts.default")}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setDefault(tpl.id, tpl.is_default)}
                          className={cn(
                            "px-2 py-1 text-[11px] rounded-lg transition-colors",
                            tpl.is_default
                              ? "text-text-tertiary"
                              : "text-text-secondary hover:bg-surface-card"
                          )}
                          title={tpl.is_default ? t("prompts.unsetDefault") : t("prompts.setDefault")}
                        >
                          {tpl.is_default ? t("prompts.unsetDefault") : t("prompts.setDefault")}
                        </button>
                        <button
                          onClick={() => startEdit(tpl)}
                          className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(tpl.id)}
                          className="p-1.5 rounded-lg text-text-tertiary hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-text-tertiary leading-relaxed whitespace-pre-wrap line-clamp-3">
                      {tpl.prefix}
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
