"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  MessageSquare,
  Palette,
  Presentation,
  LogIn,
  Menu,
  X,
  MessageSquarePlus,
  User,
  Search,
  Trash2,
  Pencil,
  Pin,
  PinOff,
  Link2,
  Check,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import InputDialog from "@/components/ui/InputDialog";
import { createPortal } from "react-dom";
import { useTheme } from "@/components/theme/ThemeProvider";

const navItems = [
  { icon: MessageSquare, label: "聊天", href: "/chat" },
  { icon: Palette, label: "画图", href: "/image" },
  { icon: Presentation, label: "PPT", href: "/ppt" },
];

// 模块级缓存：避免组件重新挂载时历史记录反复闪烁
let cachedConversationsMobile: Conversation[] | null = null;

interface Conversation {
  id: number;
  title: string;
  model: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

function getTimeGroupLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((nowDate.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays <= 7) return "七天内";
  if (diffDays <= 30) return "30天内";
  return `${date.getFullYear()}.${date.getMonth() + 1}`;
}

function groupConversationsByTime(conversations: Conversation[]): Record<string, Conversation[]> {
  const groups: Record<string, Conversation[]> = {};
  for (const conv of conversations) {
    const label = getTimeGroupLabel(conv.updated_at);
    if (!groups[label]) groups[label] = [];
    groups[label].push(conv);
  }
  return groups;
}

const GROUP_ORDER = ["今天", "昨天", "七天内", "30天内"];

function sortConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => {
    if (a.pinned !== b.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

function sortGroupLabels(labels: string[]): string[] {
  const fixed = GROUP_ORDER.filter((g) => labels.includes(g));
  const months = labels
    .filter((l) => !GROUP_ORDER.includes(l))
    .sort((a, b) => {
      const [ay, am] = a.split(".").map(Number);
      const [by, bm] = b.split(".").map(Number);
      if (ay !== by) return by - ay;
      return bm - am;
    });
  return [...fixed, ...months];
}

async function fetchConversations(): Promise<Conversation[]> {
  const token = localStorage.getItem("token");
  if (!token) return [];
  try {
    const res = await fetch("/api/conversations?limit=200", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.conversations)) return data.conversations;
    return [];
  } catch {
    return [];
  }
}

function ConvMenu({
  onRename, onTogglePin, pinned, onShare, onDelete,
}: {
  onRename: () => void; onTogglePin: () => void; pinned: boolean; onShare: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 144) });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (buttonRef.current?.contains(e.target as Node)) return;
      if (document.getElementById("mobile-conv-menu")?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleShare = () => { onShare(); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <>
      <button ref={buttonRef} onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(!open); }} className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors">
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div id="mobile-conv-menu" className="fixed z-50 w-36 rounded-xl border border-surface-border bg-surface-elevated shadow-xl py-1 animate-fade-in" style={{ top: menuPos.top, left: menuPos.left }}>
            <button onClick={(e) => { e.stopPropagation(); onRename(); setOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors"><Pencil className="w-3.5 h-3.5" /> 重命名</button>
            <button onClick={(e) => { e.stopPropagation(); onTogglePin(); setOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors">{pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}{pinned ? "取消置顶" : "置顶"}</button>
            <button onClick={(e) => { e.stopPropagation(); handleShare(); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors">{copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Link2 className="w-3.5 h-3.5" />}{copied ? "已复制" : "分享"}</button>
            <div className="mx-2 my-1 h-px bg-surface-border" />
            <button onClick={(e) => { e.stopPropagation(); onDelete(); setOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 className="w-3.5 h-3.5" /> 删除</button>
          </div>
        </>, document.body
      )}
    </>
  );
}

function ConversationSkeleton() {
  const widths = ["w-[70%]", "w-[55%]", "w-[80%]", "w-[45%]", "w-[65%]"];
  return (
    <div className="space-y-2 px-2 py-4">
      {widths.map((w, i) => (
        <div key={i} className="flex items-center gap-2 px-3 py-2 animate-pulse">
          <div className="w-3.5 h-3.5 rounded-sm bg-surface-border shrink-0" />
          <div className={cn("h-3.5 rounded-sm bg-surface-border", w)} />
        </div>
      ))}
    </div>
  );
}

export default function MobileNav() {
  const themeCtx = useTheme();
  const theme = themeCtx?.theme || "light";
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState<{ name?: string; email?: string } | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>(cachedConversationsMobile || []);
  const [loading, setLoading] = useState(cachedConversationsMobile === null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const drawerRef = useRef<HTMLDivElement>(null);
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);

  const captureHistoryAnchor = useCallback(() => {
    const container = historyScrollRef.current;
    if (!container) return null;
    const containerTop = container.getBoundingClientRect().top;
    const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-conversation-row]"));
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom >= containerTop) {
        return {
          id: row.dataset.conversationId,
          offset: rect.top - containerTop,
        };
      }
    }
    return null;
  }, []);

  const restoreHistoryAnchor = useCallback((anchor: { id?: string; offset: number } | null) => {
    if (!anchor?.id) return;
    requestAnimationFrame(() => {
      const container = historyScrollRef.current;
      const row = container?.querySelector<HTMLElement>(`[data-conversation-id="${anchor.id}"]`);
      if (!container || !row) return;
      const containerTop = container.getBoundingClientRect().top;
      const nextOffset = row.getBoundingClientRect().top - containerTop;
      container.scrollTop += nextOffset - anchor.offset;
    });
  }, []);

  const updateConversationsStable = useCallback((updater: (prev: Conversation[]) => Conversation[]) => {
    const anchor = captureHistoryAnchor();
    setConversations(prev => {
      const next = updater(prev);
      cachedConversationsMobile = next;
      return next;
    });
    restoreHistoryAnchor(anchor);
  }, [captureHistoryAnchor, restoreHistoryAnchor]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateConvId = () => setCurrentConvId(new URLSearchParams(window.location.search).get("id"));
    updateConvId();
    window.addEventListener("popstate", updateConvId);
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    window.history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      window.dispatchEvent(new Event("aipool-route-change"));
      return result;
    };
    window.history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      window.dispatchEvent(new Event("aipool-route-change"));
      return result;
    };
    window.addEventListener("aipool-route-change", updateConvId);
    return () => {
      window.removeEventListener("popstate", updateConvId);
      window.removeEventListener("aipool-route-change", updateConvId);
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    };
  }, [pathname]);
  useEffect(() => { const s = localStorage.getItem("user"); if (s) try { setUser(JSON.parse(s)); } catch {} }, []);
  
  const loadConversations = useCallback(async () => {
    if (!user) { setConversations([]); setLoading(false); return; }
    const isFirstLoad = cachedConversationsMobile === null;
    if (isFirstLoad) setLoading(true);
    const start = Date.now(); const data = await fetchConversations();
    if (isFirstLoad) {
      const elapsed = Date.now() - start;
      if (elapsed < 600) await new Promise(r => setTimeout(r, 600 - elapsed));
      setLoading(false);
    }
    setConversations(data);
    cachedConversationsMobile = data;
  }, [user]);
  
  useEffect(() => { loadConversations(); }, [loadConversations]);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d?.id) {
        loadConversations();
        return;
      }
      const now = new Date().toISOString();
      const conv: Conversation = {
        id: Number(d.id),
        title: d.title || "新对话",
        model: d.model || "",
        pinned: !!d.pinned,
        created_at: d.created_at || now,
        updated_at: d.updated_at || now,
      };
      updateConversationsStable(prev => sortConversations([conv, ...prev.filter(c => c.id !== conv.id)]));
    };
    window.addEventListener("conversation-created", h);
    return () => window.removeEventListener("conversation-created", h);
  }, [loadConversations, updateConversationsStable]);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.id != null && d?.title != null) {
        const targetId = typeof d.id === "string" ? Number(d.id) : d.id;
        updateConversationsStable(prev => prev.map(c => c.id === targetId ? { ...c, title: d.title } : c));
      }
    };
    window.addEventListener("conversation-renamed", h);
    return () => window.removeEventListener("conversation-renamed", h);
  }, [updateConversationsStable]);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.id == null) return;
      const targetId = typeof d.id === "string" ? Number(d.id) : d.id;
      const updatedAt = d.updated_at || new Date().toISOString();
      updateConversationsStable(prev => sortConversations(prev.map(c => c.id === targetId ? { ...c, updated_at: updatedAt } : c)));
    };
    window.addEventListener("conversation-updated", h);
    return () => window.removeEventListener("conversation-updated", h);
  }, [updateConversationsStable]);
  
  useEffect(() => { document.body.style.overflow = menuOpen ? "hidden" : ""; return () => { document.body.style.overflow = ""; }; }, [menuOpen]);
  useEffect(() => { if (!menuOpen) return; const h = (e: MouseEvent) => { if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) setMenuOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, [menuOpen]);

  const handleLogout = () => { localStorage.removeItem("token"); localStorage.removeItem("user"); import("@/lib/guestId").then(({ getGuestId }) => getGuestId()); setUser(null); setConversations([]); cachedConversationsMobile = null; setMenuOpen(false); router.push("/login"); };
  const handleNewChat = () => { router.push(`/chat?t=${Date.now()}`); setMenuOpen(false); };
  const handleOpenConversation = useCallback((conv: Conversation) => {
    setCurrentConvId(String(conv.id));
    router.push(`/chat?id=${conv.id}`, { scroll: false });
    setMenuOpen(false);
  }, [router]);

  const handleDelete = async (id: number) => {
    const token = localStorage.getItem("token"); if (!token) return;
    try { await fetch(`/api/conversations/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }); const next = conversations.filter(c => c.id !== id); setConversations(next); cachedConversationsMobile = next; if (String(id) === currentConvId) router.push("/chat", { scroll: false }); } catch {}
    setDeleteTarget(null);
  };
  const handleRename = async (newTitle: string) => {
    if (!renameTarget) return; const token = localStorage.getItem("token"); if (!token) return;
    try { const r = await fetch(`/api/conversations/${renameTarget.id}`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ title: newTitle }) }); if (r.ok) { const u = await r.json(); const next = conversations.map(c => c.id === u.id ? { ...c, title: u.title } : c); setConversations(next); cachedConversationsMobile = next; window.dispatchEvent(new CustomEvent("conversation-renamed", { detail: { id: u.id, title: u.title } })); } } catch {}
    setRenameTarget(null);
  };
  const handleTogglePin = async (conv: Conversation) => {
    const token = localStorage.getItem("token"); if (!token) return;
    try { const r = await fetch(`/api/conversations/${conv.id}`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ pinned: !conv.pinned }) }); if (r.ok) { const u = await r.json(); const next = sortConversations(conversations.map(c => c.id === u.id ? { ...c, pinned: u.pinned } : c)); setConversations(next); cachedConversationsMobile = next; } } catch {}
  };
  const handleShareConv = (conv: Conversation) => { const url = `${window.location.origin}/chat?id=${conv.id}`; navigator.clipboard.writeText(url); };

  return (
    <>
      <header className="md:hidden flex items-center justify-between h-12 px-3 border-b border-surface-border bg-surface shrink-0">
        <button onClick={() => setMenuOpen(!menuOpen)} className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors" aria-label="菜单">
          {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
        <button type="button" onClick={handleNewChat} className="flex items-center gap-2">
          <img src={theme === "dark" ? "/brand-dark-logo.png" : "/brand-light-logo.png"} alt="AI Space" className="w-7 h-7 rounded-lg object-cover" />
          <img src={theme === "dark" ? "/brand-dark-title.png" : "/brand-light-title.png"} alt="AI Space" className="h-5 w-auto object-contain" />
        </button>
        {user ? (
          <div className="w-7 h-7 rounded-full bg-brand/10 flex items-center justify-center"><User className="w-3.5 h-3.5 text-brand" /></div>
        ) : (
          <Link href="/login" className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-brand hover:bg-brand/5 transition-colors"><LogIn className="w-3.5 h-3.5" /><span className="font-medium">登录</span></Link>
        )}
      </header>

      {menuOpen && <div className="md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />}

      <div ref={drawerRef} className={cn("md:hidden fixed top-0 left-0 z-50 h-full w-[300px] bg-surface border-r border-surface-border shadow-2xl transition-transform duration-300 ease-out flex flex-col", menuOpen ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex items-center justify-between h-12 px-3 border-b border-surface-border shrink-0">
          <div className="flex items-center gap-2">
            <img src={theme === "dark" ? "/brand-dark-logo.png" : "/brand-light-logo.png"} alt="AI Space" className="w-7 h-7 rounded-lg object-cover" />
            <img src={theme === "dark" ? "/brand-dark-title.png" : "/brand-light-title.png"} alt="AI Space" className="h-5 w-auto object-contain" />
          </div>
          <button onClick={() => setMenuOpen(false)} className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"><X className="w-4 h-4" /></button>
        </div>

        <div className="shrink-0 py-2 px-2 space-y-0.5 border-b border-surface-border">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className={cn("flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150", active ? "bg-surface-card text-text-primary border-l-2 border-brand" : "text-text-secondary hover:bg-surface-card hover:text-text-primary")}>
                <item.icon className="w-4 h-4 shrink-0" /><span>{item.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="shrink-0 flex items-center justify-between px-3 h-10 border-b border-surface-border">
          <span className="text-sm font-medium text-text-primary">对话历史</span>
          <button onClick={handleNewChat} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-surface-card transition-colors"><MessageSquarePlus className="w-3.5 h-3.5" />新对话</button>
        </div>

        <div ref={historyScrollRef} className="flex-1 overflow-y-auto px-2 py-1">
          {!user ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center"><MessageSquare className="w-5 h-5 text-text-tertiary" /><p className="text-xs text-text-tertiary">登录后查看对话历史</p></div>
          ) : loading ? (
            <ConversationSkeleton />
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center"><MessageSquare className="w-5 h-5 text-text-tertiary" /><p className="text-xs text-text-secondary">暂无对话</p><p className="text-[11px] text-text-tertiary">点击新对话开始聊天</p></div>
          ) : (
            <div className="space-y-2 py-1">
              {(() => {
                const pinned = conversations.filter(c => c.pinned);
                const unpinned = conversations.filter(c => !c.pinned);
                const groups = groupConversationsByTime(unpinned);
                const sortedLabels = sortGroupLabels(Object.keys(groups));
                return (
                  <>
                    {pinned.length > 0 && (
                      <div>
                        <div className="px-3 py-1 text-[11px] font-medium text-text-tertiary uppercase tracking-wider">置顶</div>
                        <div className="space-y-0.5">
                          {pinned.map(conv => {
                            const isActive = String(conv.id) === currentConvId;
                            return (
                              <div key={conv.id} role="button" tabIndex={0} data-conversation-row data-conversation-id={conv.id} onClick={() => handleOpenConversation(conv)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleOpenConversation(conv); } }} className={cn("group flex w-full cursor-pointer items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors", isActive ? "bg-surface-card text-text-primary" : "text-text-secondary hover:bg-surface-card hover:text-text-primary")}>
                                <MessageSquare className="w-3.5 h-3.5 shrink-0 text-text-tertiary" /><Pin className="w-3 h-3 shrink-0 text-brand" /><span className="flex-1 truncate text-left">{conv.title || "新对话"}</span>
                                <div className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}><ConvMenu onRename={() => setRenameTarget(conv)} onTogglePin={() => handleTogglePin(conv)} pinned={conv.pinned} onShare={() => handleShareConv(conv)} onDelete={() => setDeleteTarget(conv.id)} /></div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {sortedLabels.map(label => (
                      <div key={label}>
                        <div className="px-3 py-1 text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{label}</div>
                        <div className="space-y-0.5">
                          {groups[label].map(conv => {
                            const isActive = String(conv.id) === currentConvId;
                            return (
                              <div key={conv.id} role="button" tabIndex={0} data-conversation-row data-conversation-id={conv.id} onClick={() => handleOpenConversation(conv)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleOpenConversation(conv); } }} className={cn("group flex w-full cursor-pointer items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors", isActive ? "bg-surface-card text-text-primary" : "text-text-secondary hover:bg-surface-card hover:text-text-primary")}>
                                <MessageSquare className="w-3.5 h-3.5 shrink-0 text-text-tertiary" /><span className="flex-1 truncate text-left">{conv.title || "新对话"}</span>
                                <div className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}><ConvMenu onRename={() => setRenameTarget(conv)} onTogglePin={() => handleTogglePin(conv)} pinned={conv.pinned} onShare={() => handleShareConv(conv)} onDelete={() => setDeleteTarget(conv.id)} /></div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          )}
        </div>

        <div className="shrink-0 p-3 border-t border-surface-border">
          {user ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-3 py-2"><div className="w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center"><User className="w-4 h-4 text-brand" /></div><div className="min-w-0 flex-1"><p className="text-sm text-text-primary truncate">{user.name || user.email}</p><p className="text-[11px] text-text-tertiary truncate">{user.email}</p></div></div>
              <button onClick={handleLogout} className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors">退出登录</button>
            </div>
          ) : (
            <Link href="/login" onClick={() => setMenuOpen(false)} className="flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors"><LogIn className="w-4 h-4" />登录 / 注册</Link>
          )}
        </div>
      </div>

      <ConfirmDialog isOpen={!!deleteTarget} title="删除对话" description="删除后，该对话将不可恢复。" confirmText="删除" cancelText="取消" variant="danger" onConfirm={() => deleteTarget && handleDelete(deleteTarget)} onCancel={() => setDeleteTarget(null)} />
      <InputDialog isOpen={!!renameTarget} title="重命名对话" defaultValue={renameTarget?.title || ""} placeholder="输入新的对话名称" confirmText="保存" cancelText="取消" onConfirm={handleRename} onCancel={() => setRenameTarget(null)} />
    </>
  );
}
