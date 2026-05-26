"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { FolderKanban, Plus, Check, Trash2, Pencil, ExternalLink, ChevronDown } from "lucide-react";
import { useWorkspaces, Workspace } from "@/hooks/useWorkspaces";
import { useRouter } from "next/navigation";

interface WorkspacePickerProps {
  currentWS: Workspace | null;
  workspaces: Workspace[];
  onSwitch: (ws: Workspace) => void;
  onCreate: (name: string) => Promise<Workspace | null>;
  onDelete: (id: number) => Promise<boolean>;
  onRename: (id: number, name: string) => Promise<boolean>;
  collapsed?: boolean;
}

export default function WorkspacePicker({
  currentWS,
  workspaces,
  onSwitch,
  onCreate,
  onDelete,
  onRename,
  collapsed,
}: WorkspacePickerProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [newName, setNewName] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (buttonRef.current?.contains(e.target as Node)) return;
      if (document.getElementById("ws-picker-dropdown")?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (creating && inputRef.current) inputRef.current.focus();
  }, [creating]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const ws = await onCreate(name);
    if (ws) {
      setCreating(false);
      setNewName("");
      setOpen(false);
      onSwitch(ws);
    }
  };

  const handleRename = async () => {
    if (!renaming || !renaming.name.trim()) return;
    await onRename(renaming.id, renaming.name.trim());
    setRenaming(null);
  };

  const handleOpenWorkspacePage = () => {
    setOpen(false);
    router.push("/workspace");
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm transition-all duration-150",
          open
            ? "bg-surface-card text-text-primary"
            : "text-text-secondary hover:bg-surface-card/60 hover:text-text-primary"
        )}
      >
        <FolderKanban className="w-[18px] h-[18px] shrink-0 text-text-tertiary" />
        {!collapsed && (
          <>
            <span className="flex-1 truncate text-left">
              {currentWS?.name || "工作区"}
            </span>
            <ChevronDown className={cn(
              "w-3.5 h-3.5 text-text-tertiary transition-transform duration-200",
              open && "rotate-180"
            )} />
          </>
        )}
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            id="ws-picker-dropdown"
            className="fixed z-50 w-[240px] rounded-2xl border border-surface-border bg-surface-elevated shadow-2xl py-2 animate-fade-in"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            <div className="px-3 py-1.5 text-[11px] font-semibold text-text-tertiary/70 tracking-wide uppercase">
              工作区
            </div>

            <div className="max-h-[200px] overflow-y-auto">
              {workspaces.map((ws) => {
                const isActive = currentWS?.id === ws.id;
                const isRenaming = renaming?.id === ws.id;

                return (
                  <div
                    key={ws.id}
                    className="flex items-center gap-2 px-2"
                  >
                    {isRenaming ? (
                      <div className="flex-1 flex items-center gap-1 py-1">
                        <input
                          ref={inputRef}
                          className="flex-1 px-2 py-1 rounded-lg bg-surface-card border border-surface-border text-sm text-text-primary outline-none focus:border-brand"
                          value={renaming.name}
                          onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename();
                            if (e.key === "Escape") setRenaming(null);
                          }}
                        />
                        <button
                          onClick={handleRename}
                          className="p-1 rounded-md text-green-400 hover:bg-surface-card transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => { onSwitch(ws); setOpen(false); }}
                          className={cn(
                            "flex-1 flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all duration-150",
                            isActive
                              ? "bg-surface-card text-text-primary font-medium shadow-sm"
                              : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                          )}
                        >
                          <FolderKanban className={cn(
                            "w-3.5 h-3.5 shrink-0",
                            isActive ? "text-text-primary" : "text-text-tertiary"
                          )} />
                          <span className="flex-1 truncate text-left">{ws.name}</span>
                          {ws.is_default && (
                            <span className="text-[10px] text-text-tertiary bg-surface-card px-1.5 py-0.5 rounded">默认</span>
                          )}
                          {isActive && <Check className="w-3 h-3 text-text-primary shrink-0" />}
                        </button>
                        {/* 非默认 workspace 才展示操作按钮 */}
                        {!ws.is_default && (
                          <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100">
                            <button
                              onClick={(e) => { e.stopPropagation(); setRenaming({ id: ws.id, name: ws.name }); }}
                              className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
                              title="重命名"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (confirm(`确定删除工作区「${ws.name}」？`)) {
                                  await onDelete(ws.id);
                                }
                              }}
                              className="p-1 rounded-md text-text-tertiary hover:text-red-400 hover:bg-surface-card transition-colors"
                              title="删除"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 创建新工作区 */}
            {creating ? (
              <div className="px-2 pt-2 border-t border-surface-border mt-1">
                <div className="flex items-center gap-1 pb-1">
                  <input
                    ref={inputRef}
                    className="flex-1 px-2 py-1.5 rounded-lg bg-surface-card border border-surface-border text-sm text-text-primary outline-none focus:border-brand"
                    placeholder="输入工作区名称"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreate();
                      if (e.key === "Escape") { setCreating(false); setNewName(""); }
                    }}
                  />
                  <button onClick={handleCreate} className="p-1.5 rounded-md text-brand hover:bg-brand/10 transition-colors">
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="border-t border-surface-border mx-2 my-1" />
                <button
                  onClick={() => setCreating(true)}
                  className="flex items-center gap-2 w-full px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-card/60 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>新建工作区</span>
                </button>
              </>
            )}

            <div className="border-t border-surface-border mx-2 my-1" />
            <button
              onClick={handleOpenWorkspacePage}
              className="flex items-center gap-2 w-full px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-card/60 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>管理工作区</span>
            </button>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

// 本地 cn 工具函数，避免额外依赖
function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}
