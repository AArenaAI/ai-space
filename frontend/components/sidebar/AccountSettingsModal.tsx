"use client";

import { useEffect, useMemo, useState } from "react";
import { X, User, Mail, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AccountUser {
  id?: number;
  name?: string;
  email?: string;
  basic_credits?: number;
  advanced_credits?: number;
  elite_credits?: number;
  plan_tier?: string;
  default_workspace_id?: number;
}

interface AccountSettingsModalProps {
  isOpen: boolean;
  user: AccountUser | null;
  onClose: () => void;
  onUserUpdated: (user: AccountUser) => void;
  onAccountDeleted: () => void;
}

export default function AccountSettingsModal({
  isOpen,
  user,
  onClose,
  onUserUpdated,
  onAccountDeleted,
}: AccountSettingsModalProps) {
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(user?.name || "");
    setEmail(user?.email || "");
    setSaving(false);
    setDeleting(false);
    setConfirmDelete(false);
    setError("");
    setSuccess("");
    setToastVisible(false);
  }, [isOpen, user?.name, user?.email]);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose]);

  const hasChanges = useMemo(() => {
    return name.trim() !== (user?.name || "") || email.trim() !== (user?.email || "");
  }, [name, email, user?.name, user?.email]);

  if (!isOpen || !user) return null;

  const handleSave = async () => {
    const token = localStorage.getItem("token");
    if (!token || saving || !hasChanges) return;

    setSaving(true);
    setError("");
    setSuccess("");
    setToastVisible(false);

    try {
      const res = await fetch("/api/user/profile", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "保存失败");

      const nextUser = { ...user, ...data.user };
      localStorage.setItem("user", JSON.stringify(nextUser));
      onUserUpdated(nextUser);
      setSuccess("资料已更新");
      setToastVisible(true);
      setTimeout(() => setToastVisible(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
      setToastVisible(true);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    const token = localStorage.getItem("token");
    if (!token || deleting) return;

    setDeleting(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/user/account", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "删除账号失败");
      onAccountDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除账号失败");
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={onClose} />

      {toastVisible && (error || success) && (
        <div className="fixed left-1/2 top-6 z-[9999] w-[calc(100%-32px)] max-w-[420px] -translate-x-1/2">
          <div
            className={cn(
              "flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium text-white shadow-2xl ring-1 ring-white/15 animate-dialog-appear",
              error ? "bg-red-500" : "bg-emerald-500"
            )}
          >
            {error ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
            <span>{error || success}</span>
          </div>
        </div>
      )}

      <div className="relative w-full max-w-[520px] overflow-hidden rounded-2xl border border-surface-border bg-surface-elevated shadow-2xl animate-dialog-appear">
        <div className="flex items-center justify-between border-b border-surface-border px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">设置</h2>
            <p className="mt-1 text-sm text-text-secondary">管理你的账号资料</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-text-tertiary transition-colors hover:bg-surface-card hover:text-text-primary"
            title="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          <div className="mb-5 flex items-center gap-3 rounded-2xl bg-surface-card px-4 py-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
              <span className="text-base font-semibold">{(name || email || "U")[0]?.toUpperCase()}</span>
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-text-primary">{name || email}</div>
              <div className="truncate text-xs text-text-tertiary">{email}</div>
            </div>
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-sm font-medium text-text-secondary">
                <User className="h-4 w-4" />
                用户名
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="输入用户名"
                className="w-full rounded-xl border border-surface-border bg-surface-card px-4 py-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-brand/60"
              />
            </label>

            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-sm font-medium text-text-secondary">
                <Mail className="h-4 w-4" />
                邮箱
              </span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="输入邮箱"
                type="email"
                className="w-full rounded-xl border border-surface-border bg-surface-card px-4 py-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-brand/60"
              />
            </label>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving || !email.trim()}
              className="rounded-xl bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>

        <div className="border-t border-surface-border bg-surface-card/40 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-red-400">
                <Trash2 className="h-4 w-4" />
                删除账号
              </div>
              <p className="mt-1 text-xs leading-relaxed text-text-tertiary">
                删除后会清除账号、会话、文件、图片和工作区数据，无法恢复。
              </p>
            </div>
            <button
              onClick={() => setConfirmDelete(true)}
              className="shrink-0 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/15"
            >
              删除
            </button>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmDelete(false)} />
          <div className="relative w-full max-w-[380px] rounded-2xl border border-surface-border bg-surface-elevated p-6 shadow-2xl animate-dialog-appear">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-red-500/10 text-red-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <h3 className="text-base font-semibold text-text-primary">确认删除账号？</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">
              该操作不可撤销。删除后你将退出登录，账号相关数据会被移除。
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="rounded-xl border border-surface-border bg-surface-card px-4 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text-primary disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleting}
                className="rounded-xl bg-red-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                {deleting ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
