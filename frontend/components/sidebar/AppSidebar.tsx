"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  MessageSquare, Palette, Presentation, LogIn, LogOut,
  PanelLeftClose, MessageSquarePlus, Search, ChevronRight,
  User, Trash2, MoreHorizontal, Pencil, Pin, PinOff, Link2, Check,
  FileText, LayoutGrid, X, Clock, Sparkles, Image, Eraser,
  Briefcase, FileCode, PenTool, BarChart3, Mail, ClipboardList, Terminal, GraduationCap, Languages,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import InputDialog from "@/components/ui/InputDialog";
import { useTemplates } from "@/hooks/useTemplates";
import SidebarUserPanel from "./SidebarUserPanel";

// 模块级缓存：避免组件重新挂载时历史记录反复闪烁
let cachedConversations: Conversation[] | null = null;

interface Conversation {
  id: number;
  title: string;
  model: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  skill_key?: string;
}

/* ───── 辅助函数 ───── */

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

/* ───── 技能图标映射 ───── */

const SKILL_ICON_MAP: Record<string, { icon: React.ElementType; color: string }> = {
  "ceo-strategist":   { icon: Briefcase,       color: "text-amber-400" },
  "code-reviewer":    { icon: FileCode,        color: "text-emerald-400" },
  "creative-writer":  { icon: PenTool,         color: "text-pink-400" },
  "data-analyst":     { icon: BarChart3,       color: "text-violet-400" },
  "email-drafter":    { icon: Mail,            color: "text-teal-400" },
  "meeting-minutes":  { icon: ClipboardList,   color: "text-teal-400" },
  "prompt-engineer":  { icon: Terminal,        color: "text-orange-400" },
  "thesis-assistant": { icon: GraduationCap,   color: "text-blue-400" },
  "translator":       { icon: Languages,       color: "text-indigo-400" },
};

async function fetchConversations(): Promise<Conversation[]> {
  const token = localStorage.getItem("token");
  if (!token) return [];
  try {
    const res = await fetch("/api/conversations", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

/* ───── 对话项右键菜单 ───── */

function ConvMenu({
  onRename, onTogglePin, pinned, onShare, onDelete,
}: {
  onRename: () => void; onTogglePin: () => void; pinned: boolean;
  onShare: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: rect.right - 144 });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (buttonRef.current?.contains(e.target as Node)) return;
      if (document.getElementById("conv-menu-dropdown")?.contains(e.target as Node)) return;
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
          <div id="conv-menu-dropdown" className="fixed z-50 w-36 rounded-xl border border-surface-border bg-surface-elevated shadow-xl py-1 animate-fade-in" style={{ top: menuPos.top, left: menuPos.left }}>
            <button onClick={(e) => { e.stopPropagation(); onRename(); setOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors"><Pencil className="w-3.5 h-3.5" />重命名</button>
            <button onClick={(e) => { e.stopPropagation(); onTogglePin(); setOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors">{pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}{pinned ? "取消置顶" : "置顶"}</button>
            <button onClick={(e) => { e.stopPropagation(); handleShare(); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors">{copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Link2 className="w-3.5 h-3.5" />}{copied ? "已复制" : "分享"}</button>
            <div className="mx-2 my-1 h-px bg-surface-border" />
            <button onClick={(e) => { e.stopPropagation(); onDelete(); setOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 className="w-3.5 h-3.5" />删除</button>
          </div>
        </>, document.body
      )}
    </>
  );
}

/* ───── "更多" hover 展开面板 ───── */

function MoreHoverPanel({
  open, anchorEl, onClose, onMouseEnter, onMouseLeave,
}: {
  open: boolean; anchorEl: HTMLElement | null; onClose: () => void; onMouseEnter?: () => void; onMouseLeave?: () => void;
}) {
  const router = useRouter();
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (open && anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      setPos({ top: rect.top, left: rect.right + 8 });
    }
  }, [open, anchorEl]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleNavigate = (href: string) => {
    onClose();
    router.push(href);
  };

  const groups = [
    {
      title: "创建",
      items: [
        { icon: Image, label: "背景移除", href: "/image/edit?mode=remove-bg", color: "text-green-500", bg: "bg-green-500/10" },
        { icon: Eraser, label: "背景替换", href: "/image/edit?mode=replace-bg", color: "text-purple-500", bg: "bg-purple-500/10" },
      ],
    },
    {
      title: "模板",
      items: [
        { icon: FileText, label: "回答模板", href: "/templates", color: "text-blue-500", bg: "bg-blue-500/10" },
      ],
    },
  ];

  if (!open || !anchorEl) return null;

  return createPortal(
    <div
      className="fixed z-[60] w-[280px] rounded-2xl border border-surface-border bg-surface-elevated shadow-2xl py-4 px-3"
      style={{
        top: pos.top,
        left: pos.left,
        animation: "slide-in-right 180ms ease-out",
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {groups.map((group) => (
        <div key={group.title} className="mb-4 last:mb-0">
          <h3 className="text-sm font-semibold text-text-primary mb-2 px-1">{group.title}</h3>
          <div className="grid grid-cols-2 gap-1.5">
            {group.items.map((item) => (
              <button
                key={item.label}
                onClick={() => handleNavigate(item.href)}
                className="flex items-center gap-2.5 p-2.5 rounded-xl text-left transition-all duration-150 hover:bg-surface-card group"
              >
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", item.bg)}>
                  <item.icon className={cn("w-4 h-4", item.color)} />
                </div>
                <span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>,
    document.body
  );
}

/* ───── 骨架屏 ───── */

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

/* ───── 主组件 ───── */

export default function AppSidebar({ skillKey }: { skillKey?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [conversations, setConversations] = useState<Conversation[]>(cachedConversations || []);
  const [loading, setLoading] = useState(cachedConversations === null);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const { templates, updateTemplate } = useTemplates();

  /* 更多面板 */
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const moreTimerRef = useRef<NodeJS.Timeout | null>(null);

  /* 收缩状态 tooltip */
  const [sidebarTooltip, setSidebarTooltip] = useState<{text: string; x: number; y: number} | null>(null);
  const showSidebarTooltip = (text: string) => (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setSidebarTooltip({ text, x: r.right + 8, y: r.top + r.height / 2 - 14 });
  };
  const hideSidebarTooltip = () => setSidebarTooltip(null);

  const handleMoreEnter = () => {
    if (moreTimerRef.current) clearTimeout(moreTimerRef.current);
    setMoreOpen(true);
  };
  const handleMoreLeave = () => {
    moreTimerRef.current = setTimeout(() => setMoreOpen(false), 400);
  };

  /* 模板 */
  const [selectedTemplateId, setSelectedTemplateId] = useState(() => {
    if (typeof window !== "undefined") {
      return Number(localStorage.getItem("selected-template") || "0");
    }
    return 0;
  });

  /* 监听当前对话 ID */
  useEffect(() => {
    if (typeof window !== "undefined") {
      const updateConvId = () => {
        setCurrentConvId(new URLSearchParams(window.location.search).get("id"));
      };
      updateConvId();
      window.addEventListener("popstate", updateConvId);
      const interval = setInterval(updateConvId, 500);
      return () => {
        window.removeEventListener("popstate", updateConvId);
        clearInterval(interval);
      };
    }
  }, [pathname]);

  /* 用户信息 */
  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (stored) { try { setUser(JSON.parse(stored)); } catch {} }
  }, []);

  /* 加载对话 */
  const loadConversations = useCallback(async () => {
    if (!user) { setConversations([]); setLoading(false); return; }
    const isFirstLoad = cachedConversations === null;
    if (isFirstLoad) setLoading(true);
    const startTime = Date.now();
    const data = await fetchConversations();
    if (isFirstLoad) {
      const elapsed = Date.now() - startTime;
      if (elapsed < 600) await new Promise((r) => setTimeout(r, 600 - elapsed));
      setLoading(false);
    }
    setConversations(data);
    cachedConversations = data;
  }, [user]);

  useEffect(() => { loadConversations(); }, [loadConversations]);
  useEffect(() => { const h = () => loadConversations(); window.addEventListener("conversation-created", h); return () => window.removeEventListener("conversation-created", h); }, [loadConversations]);

  /* 操作 */
  const handleLogout = () => { localStorage.removeItem("token"); localStorage.removeItem("user"); setUser(null); setConversations([]); cachedConversations = null; window.location.href = "/"; };
  const handleNewChat = () => {
    if (skillKey) {
      router.push(`/skills/chat?key=${skillKey}&t=` + Date.now());
    } else {
      router.push("/chat?t=" + Date.now());
    }
  };
  const handleDelete = (id: number) => { setDeleteTarget(id); };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const token = localStorage.getItem("token"); if (!token) return;
    try { const r = await fetch(`/api/conversations/${deleteTarget}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }); if (r.ok) { const next = conversations.filter(c => c.id !== deleteTarget); setConversations(next); cachedConversations = next; if (String(deleteTarget) === currentConvId) {
      if (skillKey) {
        router.push(`/skills/chat?key=${skillKey}`);
      } else {
        router.push("/chat");
      }
    } } } catch {}
    setDeleteTarget(null);
  };

  const handleRename = async (newTitle: string) => {
    if (!renameTarget) return;
    const token = localStorage.getItem("token"); if (!token) return;
    try { const r = await fetch(`/api/conversations/${renameTarget.id}`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ title: newTitle }) }); if (r.ok) { const u = await r.json(); const next = conversations.map(c => c.id === u.id ? { ...c, title: u.title } : c); setConversations(next); cachedConversations = next; } } catch {}
    setRenameTarget(null);
  };

  const handleTogglePin = async (conv: Conversation) => {
    const token = localStorage.getItem("token"); if (!token) return;
    try { const r = await fetch(`/api/conversations/${conv.id}`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ pinned: !conv.pinned }) }); if (r.ok) { const u = await r.json(); const next = conversations.map(c => c.id === u.id ? { ...c, pinned: u.pinned } : c).sort((a, b) => { if (a.pinned !== b.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0); return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(); }); setConversations(next); cachedConversations = next; } } catch {}
  };

  const handleShare = (conv: Conversation) => {
    const url = skillKey
      ? `${window.location.origin}/skills/chat?key=${skillKey}&id=${conv.id}`
      : `${window.location.origin}/chat?id=${conv.id}`;
    navigator.clipboard.writeText(url);
  };

  /* ── 渲染对话列表 ── */
  const renderConversationList = () => {
    if (loading) return <ConversationSkeleton />;
    if (conversations.length === 0) {
      return (
        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
          <div className="flex size-8 items-center justify-center rounded-full bg-surface-card border border-surface-border"><MessageSquare className="w-4 h-4 text-text-tertiary" /></div>
          <div className="space-y-1"><p className="text-xs text-text-secondary">暂无对话</p><p className="text-[11px] text-text-tertiary">{user ? "点击上方按钮开始聊天" : "登录后保存聊天历史"}</p></div>
        </div>
      );
    }

    const pinned = conversations.filter(c => c.pinned);
    const unpinned = conversations.filter(c => !c.pinned);
    const groups = groupConversationsByTime(unpinned);
    const sortedLabels = sortGroupLabels(Object.keys(groups));

    return (
      <div className="space-y-3">
        {pinned.length > 0 && (
          <div>
            <div className="px-3 py-1 text-[11px] font-medium text-text-tertiary uppercase tracking-wider">置顶</div>
            <div className="space-y-0.5">
              {pinned.map(conv => {
                const isActive = String(conv.id) === currentConvId;
                const convHref = conv.skill_key
                  ? `/skills/chat?key=${conv.skill_key}&id=${conv.id}`
                  : `/chat?id=${conv.id}`;
                const skillMeta = conv.skill_key ? SKILL_ICON_MAP[conv.skill_key] : null;
                const IconComp = skillMeta ? skillMeta.icon : MessageSquare;
                const iconColor = isActive
                  ? (skillMeta ? skillMeta.color : "text-brand")
                  : "text-text-tertiary group-hover:text-text-secondary";
                return (
                  <Link key={conv.id} href={convHref} className={cn("group flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-200", isActive ? "bg-brand/15 text-text-primary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),inset_2px_0_0_0_var(--brand)]" : "text-text-secondary hover:bg-surface-card/70 hover:text-text-primary")}>
                    <IconComp className={cn("w-3.5 h-3.5 shrink-0 transition-all duration-200", iconColor)} />
                    <Pin className="w-3 h-3 shrink-0 text-brand" />
                    <span className={cn("flex-1 truncate text-left", isActive && "font-medium")}>{conv.title || "新对话"}</span>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity"><ConvMenu onRename={() => setRenameTarget(conv)} onTogglePin={() => handleTogglePin(conv)} pinned={conv.pinned} onShare={() => handleShare(conv)} onDelete={() => handleDelete(conv.id)} /></div>
                  </Link>
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
                const convHref = conv.skill_key
                  ? `/skills/chat?key=${conv.skill_key}&id=${conv.id}`
                  : `/chat?id=${conv.id}`;
                const skillMeta = conv.skill_key ? SKILL_ICON_MAP[conv.skill_key] : null;
                const IconComp = skillMeta ? skillMeta.icon : MessageSquare;
                const iconColor = isActive
                  ? (skillMeta ? skillMeta.color : "text-brand")
                  : "text-text-tertiary group-hover:text-text-secondary";
                return (
                  <Link key={conv.id} href={convHref} className={cn("group flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-200", isActive ? "bg-brand/15 text-text-primary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),inset_2px_0_0_0_var(--brand)]" : "text-text-secondary hover:bg-surface-card/70 hover:text-text-primary")}>
                    <IconComp className={cn("w-3.5 h-3.5 shrink-0 transition-all duration-200", iconColor)} />
                    <span className={cn("flex-1 truncate text-left", isActive && "font-medium")}>{conv.title || "新对话"}</span>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity"><ConvMenu onRename={() => setRenameTarget(conv)} onTogglePin={() => handleTogglePin(conv)} pinned={conv.pinned} onShare={() => handleShare(conv)} onDelete={() => handleDelete(conv.id)} /></div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  /* ═══════════════════ JSX ═══════════════════ */

  return (
    <>
      {/* 侧边栏主体 */}
      <div className={cn("flex flex-col h-full bg-surface-elevated border-r border-surface-border transition-all duration-200 ease-out", collapsed ? "w-[52px]" : "w-[260px]")}>

        {/* ── Logo + 折叠 ── */}
        <div className="flex items-center h-12 px-3 border-b border-surface-border shrink-0">
          {!collapsed && <Link href="/chat" className="flex-1"><span className="text-sm font-semibold text-text-primary tracking-tight">AI Space</span></Link>}
          <button onClick={() => setCollapsed(!collapsed)} className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors">
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {/* ── 可滚动区域 ── */}
        {collapsed ? (
          <div className="flex-1 flex flex-col items-center overflow-visible">
            {/* 新对话 - 对齐展开状态的 px-3 pt-3 pb-2 */}
            <div className="pt-3 pb-2">
              <button
                onClick={handleNewChat}
                onMouseEnter={showSidebarTooltip("新对话")}
                onMouseLeave={hideSidebarTooltip}
                className="p-2.5 rounded-xl hover:bg-surface-card transition-colors"
              >
                <MessageSquarePlus className="w-5 h-5 text-brand" />
              </button>
            </div>

            {/* 功能分组 - 对齐展开状态的 px-3 py-2 */}
            <div className="py-2 flex flex-col items-center space-y-0.5">
              {/* 聊天 */}
              <Link
                href="/chat"
                onMouseEnter={showSidebarTooltip("聊天")}
                onMouseLeave={hideSidebarTooltip}
                className={cn(
                  "p-2.5 rounded-xl transition-colors",
                  pathname === "/chat" ? "bg-surface-card" : "hover:bg-surface-card"
                )}
              >
                <MessageSquare className={cn("w-5 h-5", pathname === "/chat" ? "text-brand" : "text-text-tertiary")} />
              </Link>

              {/* AI 画图 */}
              <Link
                href="/image"
                onMouseEnter={showSidebarTooltip("AI 画图")}
                onMouseLeave={hideSidebarTooltip}
                className={cn(
                  "p-2.5 rounded-xl transition-colors",
                  pathname === "/image" || pathname?.startsWith("/image/") ? "bg-surface-card" : "hover:bg-surface-card"
                )}
              >
                <Palette className={cn("w-5 h-5", pathname === "/image" || pathname?.startsWith("/image/") ? "text-purple-500" : "text-text-tertiary")} />
              </Link>

              {/* AI PPT */}
              <Link
                href="/ppt"
                onMouseEnter={showSidebarTooltip("AI PPT")}
                onMouseLeave={hideSidebarTooltip}
                className={cn(
                  "p-2.5 rounded-xl transition-colors",
                  pathname === "/ppt" || pathname?.startsWith("/ppt/") ? "bg-surface-card" : "hover:bg-surface-card"
                )}
              >
                <Presentation className={cn("w-5 h-5", pathname === "/ppt" || pathname?.startsWith("/ppt/") ? "text-orange-500" : "text-text-tertiary")} />
              </Link>

              {/* AI技能中心 */}
              <Link
                href="/skills"
                onMouseEnter={showSidebarTooltip("AI技能中心")}
                onMouseLeave={hideSidebarTooltip}
                className={cn(
                  "p-2.5 rounded-xl transition-colors",
                  pathname === "/skills" || pathname?.startsWith("/skills/") ? "bg-surface-card" : "hover:bg-surface-card"
                )}
              >
                <Sparkles className={cn("w-5 h-5", pathname === "/skills" || pathname?.startsWith("/skills/") ? "text-cyan-500" : "text-text-tertiary")} />
              </Link>

              {/* 更多 - hover 展开面板，不需要 tooltip */}
              <div
                onMouseEnter={handleMoreEnter}
                onMouseLeave={handleMoreLeave}
              >
                <button
                  ref={moreBtnRef}
                  className="p-2.5 rounded-xl hover:bg-surface-card transition-colors"
                >
                  <LayoutGrid className="w-5 h-5 text-text-tertiary" />
                </button>
              </div>
            </div>

            {/* 分隔线 - 功能与历史分组之间 */}
            <div className="w-6 h-px bg-surface-border/40 my-2" />

            {/* 历史分组 - 点击展开侧边栏 */}
            <div className="py-2">
              <button
                onClick={() => setCollapsed(false)}
                onMouseEnter={showSidebarTooltip("历史聊天")}
                onMouseLeave={hideSidebarTooltip}
                className="p-2.5 rounded-xl hover:bg-surface-card transition-colors"
              >
                <Clock className="w-5 h-5 text-text-tertiary" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto scrollbar-hide">
            {/* ▼ 新对话大按钮（Sider 风格） */}
            <div className="px-3 pt-3 pb-2">
              <button
                onClick={handleNewChat}
                className="flex items-center gap-3 w-full px-4 py-3 rounded-2xl bg-surface-card border border-surface-border shadow-sm hover:shadow-md hover:border-brand/30 transition-all duration-200 group"
              >
                <div className="w-8 h-8 rounded-xl bg-brand/10 flex items-center justify-center shrink-0 group-hover:bg-brand/20 transition-colors">
                  <MessageSquarePlus className="w-[18px] h-[18px] text-brand" />
                </div>
                <span className="text-sm font-semibold text-text-primary">新对话</span>
              </button>
            </div>

            {/* ▼ 功能分组 */}
            <div className="px-3 py-2">
              <div className="mb-1.5 px-1">
                <span className="text-[11px] font-semibold text-text-tertiary/70 tracking-wide">功能</span>
              </div>
              <div className="space-y-0.5">
                {/* 聊天 */}
                <Link
                  href="/chat"
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150",
                    pathname === "/chat"
                      ? "bg-surface-card text-text-primary font-medium shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                      : "text-text-secondary hover:bg-surface-card/60 hover:text-text-primary"
                  )}
                >
                  <MessageSquare className={cn("w-[18px] h-[18px] shrink-0 transition-colors", pathname === "/chat" ? "text-brand" : "text-text-tertiary")} />
                  <span>聊天</span>
                </Link>

                {/* AI 画图 - 一级功能 */}
                <Link
                  href="/image"
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150",
                    pathname === "/image" || pathname?.startsWith("/image/")
                      ? "bg-surface-card text-text-primary font-medium shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                      : "text-text-secondary hover:bg-surface-card/60 hover:text-text-primary"
                  )}
                >
                  <Palette className={cn("w-[18px] h-[18px] shrink-0 transition-colors", pathname === "/image" || pathname?.startsWith("/image/") ? "text-purple-500" : "text-text-tertiary")} />
                  <span>AI 画图</span>
                </Link>

                {/* AI PPT - 一级功能 */}
                <Link
                  href="/ppt"
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150",
                    pathname === "/ppt" || pathname?.startsWith("/ppt/")
                      ? "bg-surface-card text-text-primary font-medium shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                      : "text-text-secondary hover:bg-surface-card/60 hover:text-text-primary"
                  )}
                >
                  <Presentation className={cn("w-[18px] h-[18px] shrink-0 transition-colors", pathname === "/ppt" || pathname?.startsWith("/ppt/") ? "text-orange-500" : "text-text-tertiary")} />
                  <span>AI PPT</span>
                </Link>

                {/* AI技能中心 */}
                <Link
                  href="/skills"
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150",
                    pathname === "/skills" || pathname?.startsWith("/skills/")
                      ? "bg-surface-card text-text-primary font-medium shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                      : "text-text-secondary hover:bg-surface-card/60 hover:text-text-primary"
                  )}
                >
                  <Sparkles className={cn("w-[18px] h-[18px] shrink-0 transition-colors", pathname === "/skills" || pathname?.startsWith("/skills/") ? "text-cyan-500" : "text-text-tertiary")} />
                  <span>AI技能中心</span>
                </Link>

                {/* 更多 - hover 展开 */}
                <div
                  onMouseEnter={handleMoreEnter}
                  onMouseLeave={handleMoreLeave}
                >
                  <button
                    ref={moreBtnRef}
                    className="flex items-center justify-between w-full px-3 py-2.5 rounded-xl text-sm text-text-secondary hover:bg-surface-card/60 hover:text-text-primary transition-all duration-150"
                  >
                    <div className="flex items-center gap-3">
                      <LayoutGrid className="w-[18px] h-[18px] shrink-0 text-text-tertiary" />
                      <span>更多</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-text-tertiary" />
                  </button>
                </div>
              </div>
            </div>

            {/* ▼ 历史分组 */}
            <div className="px-3 py-2">
              <div className="flex items-center justify-between mb-1.5 px-1">
                <span className="text-[11px] font-semibold text-text-tertiary/70 tracking-wide">历史</span>
                <button className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors">
                  <Search className="w-3.5 h-3.5" />
                </button>
              </div>
              {renderConversationList()}
            </div>
          </div>
        )}

        {/* ── 底部用户 ── */}
        <div className="border-t border-surface-border shrink-0">
          <SidebarUserPanel
            user={user}
            collapsed={collapsed}
            onLogout={handleLogout}
            onShowTooltip={showSidebarTooltip}
            onHideTooltip={hideSidebarTooltip}
          />
        </div>
      </div>

      {/* 更多 hover 面板 */}
      <MoreHoverPanel open={moreOpen} anchorEl={moreBtnRef.current} onClose={() => setMoreOpen(false)} onMouseEnter={handleMoreEnter} onMouseLeave={handleMoreLeave} />

      {/* 收缩状态 tooltip */}
      {sidebarTooltip && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-[100] px-2.5 py-1.5 rounded-lg bg-surface-card border border-surface-border text-xs text-text-primary whitespace-nowrap shadow-lg pointer-events-none"
          style={{ top: sidebarTooltip.y, left: sidebarTooltip.x }}
        >
          {sidebarTooltip.text}
        </div>,
        document.body
      )}

      {/* 弹窗 */}
      <ConfirmDialog isOpen={!!deleteTarget} title="删除对话" description="删除后，该对话将不可恢复。" confirmText="删除" cancelText="取消" variant="danger" onConfirm={confirmDelete} onCancel={() => setDeleteTarget(null)} />
      <InputDialog isOpen={!!renameTarget} title="重命名对话" defaultValue={renameTarget?.title || ""} placeholder="输入新的对话名称" confirmText="保存" cancelText="取消" onConfirm={handleRename} onCancel={() => setRenameTarget(null)} />
    </>
  );
}
