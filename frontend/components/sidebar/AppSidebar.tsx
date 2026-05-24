"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
function cleanPathname(p: string | null): string {
  let cleaned = (p ?? "").replace(/\.html$/, "").split("?")[0];
  // Express 静态服务给目录加 trailing slash，如 /workspace/ → /workspace
  if (cleaned !== "/") cleaned = cleaned.replace(/\/$/, "");
  return cleaned;
}
import { createPortal } from "react-dom";
import {
  MessageSquare, Palette, Presentation, LogIn, LogOut,
  PanelLeftClose, MessageSquarePlus, Search, ChevronRight,
  User, Trash2, MoreHorizontal, Pencil, Pin, PinOff, Link2, Check,
  FileText, LayoutGrid, X, Clock, Sparkles, Image, ImageIcon, Eraser,
  Type, ZoomIn, FolderKanban,
  Briefcase, FileCode, PenTool, BarChart3, Mail, ClipboardList, Terminal, GraduationCap, Languages,
  Zap, Shield, BookOpen, Wrench, Globe, Code2,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import InputDialog from "@/components/ui/InputDialog";
import { useTemplates } from "@/hooks/useTemplates";
import SidebarUserPanel from "./SidebarUserPanel";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { useTheme } from "@/components/theme/ThemeProvider";

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

interface ConversationSearchResult extends Conversation {
  matched_content?: string;
  matched_role?: string;
}

/* ───── 辅助函数 ───── */

function getTimeGroupLabel(dateStr: string, t: (key: string) => string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((nowDate.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return t("sidebar.time.today");
  if (diffDays === 1) return t("sidebar.time.yesterday");
  if (diffDays <= 7) return t("sidebar.time.last7days");
  if (diffDays <= 30) return t("sidebar.time.last30days");
  return `${date.getFullYear()}.${date.getMonth() + 1}`;
}

function groupConversationsByTime(conversations: Conversation[], t: (key: string) => string): Record<string, Conversation[]> {
  const groups: Record<string, Conversation[]> = {};
  for (const conv of conversations) {
    const label = getTimeGroupLabel(conv.updated_at, t);
    if (!groups[label]) groups[label] = [];
    groups[label].push(conv);
  }
  return groups;
}

function getGroupOrder(t: (key: string) => string): string[] {
  return [t("sidebar.time.today"), t("sidebar.time.yesterday"), t("sidebar.time.last7days"), t("sidebar.time.last30days")];
}

function sortConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => {
    if (a.pinned !== b.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

function sortGroupLabels(labels: string[], t: (key: string) => string): string[] {
  const groupOrder = getGroupOrder(t);
  const fixed = groupOrder.filter((g) => labels.includes(g));
  const months = labels
    .filter((l) => !groupOrder.includes(l))
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

async function fetchConversations(workspaceId?: number): Promise<Conversation[] | null> {
  const token = localStorage.getItem("token");
  if (!token) return [];
  try {
    const params = new URLSearchParams();
    if (workspaceId) params.set("workspace_id", String(workspaceId));
    params.set("limit", "200");
    const res = await fetch(`/api/conversations?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.conversations)) return data.conversations;
    return null;
  } catch { return null; }
}

async function searchConversations(keyword: string, workspaceId?: number, signal?: AbortSignal): Promise<ConversationSearchResult[]> {
  const token = localStorage.getItem("token");
  if (!token) return [];
  const q = keyword.trim();
  if (!q) return [];
  try {
    const params = new URLSearchParams({ q });
    if (workspaceId) params.set("workspace_id", String(workspaceId));
    const res = await fetch(`/api/conversations/search?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/* ───── 对话项右键菜单 ───── */

function ConvMenu({
  onRename, onTogglePin, pinned, onShare, onDelete,
}: {
  onRename: () => void; onTogglePin: () => void; pinned: boolean;
  onShare: () => void; onDelete: () => void;
}) {
  const { t } = useI18n();
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
            <button onClick={(e) => { e.stopPropagation(); onRename(); setOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors"><Pencil className="w-3.5 h-3.5" />{t("sidebar.menu.rename")}</button>
            <button onClick={(e) => { e.stopPropagation(); onTogglePin(); setOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors">{pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}{pinned ? t("sidebar.menu.unpin") : t("sidebar.menu.pin")}</button>
            <button onClick={(e) => { e.stopPropagation(); handleShare(); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors">{copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Link2 className="w-3.5 h-3.5" />}{copied ? t("sidebar.menu.copied") : t("sidebar.menu.share")}</button>
            <div className="mx-2 my-1 h-px bg-surface-border" />
            <button onClick={(e) => { e.stopPropagation(); onDelete(); setOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 className="w-3.5 h-3.5" />{t("sidebar.menu.delete")}</button>
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
  const { t } = useI18n();
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
      title: t("sidebar.panel.create"),
      items: [
        { icon: ImageIcon, label: t("sidebar.panel.ai_draw"), href: "/image", color: "text-purple-500", bg: "bg-purple-500/10" },
        { icon: Image, label: t("sidebar.panel.remove_bg"), href: "/image/edit?mode=remove-bg", color: "text-green-500", bg: "bg-green-500/10" },
        { icon: Eraser, label: t("sidebar.panel.replace_bg"), href: "/image/edit?mode=replace-bg", color: "text-purple-500", bg: "bg-purple-500/10" },
        { icon: Type, label: t("sidebar.panel.text_removal"), href: "/image/edit?mode=text-removal", color: "text-amber-500", bg: "bg-amber-500/10" },
        { icon: ZoomIn, label: t("sidebar.panel.upscale"), href: "/image/edit?mode=upscale", color: "text-cyan-500", bg: "bg-cyan-500/10" },
      ],
    },
  ];

  if (!open || !anchorEl) return null;

  return createPortal(
    <div
      className="fixed z-[60] w-[280px] rounded-2xl border border-surface-border bg-surface shadow-2xl py-4 px-3"
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

/* ───── AI工作悬浮面板 ───── */
function WorkHoverPanel({
  open, anchorEl, onClose, onMouseEnter, onMouseLeave,
}: {
  open: boolean; anchorEl: HTMLElement | null; onClose: () => void; onMouseEnter?: () => void; onMouseLeave?: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [skills, setSkills] = useState<Array<{ key: string; title?: string; display_name?: string; description: string; icon: string; tags?: string[]; is_meta?: boolean }>>([]);
  const [loading, setLoading] = useState(false);

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

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/skills")
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.skills)
            ? data.skills
            : [...(Array.isArray(data?.system_skills) ? data.system_skills : []), ...(Array.isArray(data?.custom_skills) ? data.custom_skills : [])];
        setSkills(list.filter((s: any) => !s.is_meta));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  const handleNavigate = (href: string) => {
    onClose();
    router.push(href);
  };

  const iconMap: Record<string, React.ElementType> = {
    zap: Zap, search: Search, shield: Shield, "file-code": FileCode,
    "book-open": BookOpen, wrench: Wrench, "pen-tool": PenTool,
    "message-square": MessageSquare, globe: Globe, briefcase: Briefcase,
    "code-2": Code2, "bar-chart": BarChart3, mail: Mail,
    "clipboard-list": ClipboardList, terminal: Terminal,
    "graduation-cap": GraduationCap, languages: Languages,
  };
  const colorMap: Record<string, string> = {
    zap: "text-yellow-500", search: "text-blue-500", shield: "text-red-500",
    "file-code": "text-cyan-500", "book-open": "text-amber-500", wrench: "text-slate-500",
    "pen-tool": "text-pink-500", "message-square": "text-green-500", globe: "text-sky-500",
    briefcase: "text-orange-500", "code-2": "text-indigo-500", "bar-chart": "text-emerald-500",
    mail: "text-rose-500", "clipboard-list": "text-violet-500", terminal: "text-teal-500",
    "graduation-cap": "text-lime-500", languages: "text-fuchsia-500",
  };
  const bgMap: Record<string, string> = {
    zap: "bg-yellow-500/10", search: "bg-blue-500/10", shield: "bg-red-500/10",
    "file-code": "bg-cyan-500/10", "book-open": "bg-amber-500/10", wrench: "bg-slate-500/10",
    "pen-tool": "bg-pink-500/10", "message-square": "bg-green-500/10", globe: "bg-sky-500/10",
    briefcase: "bg-orange-500/10", "code-2": "bg-indigo-500/10", "bar-chart": "bg-emerald-500/10",
    mail: "bg-rose-500/10", "clipboard-list": "bg-violet-500/10", terminal: "bg-teal-500/10",
    "graduation-cap": "bg-lime-500/10", languages: "bg-fuchsia-500/10",
  };

  if (!open || !anchorEl) return null;

  return createPortal(
    <div
      className="fixed z-[60] w-[280px] rounded-2xl border border-surface-border bg-surface shadow-2xl py-4 px-3"
      style={{
        top: pos.top,
        left: pos.left,
        animation: "slide-in-right 180ms ease-out",
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* AI PPT */}
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-text-primary mb-2 px-1">{t("sidebar.panel.tools")}</h3>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            // onClick={() => handleNavigate("/ppt")}
            title="coming soon"
            className="relative flex items-center gap-2.5 p-2.5 rounded-xl text-left transition-all duration-150 cursor-not-allowed opacity-60 group"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-surface-card">
              <Presentation className="w-4 h-4 text-text-tertiary" />
            </div>
            <span className="text-sm text-text-tertiary transition-colors">AI PPT</span>
            <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded-lg bg-surface-elevated border border-surface-border px-2 py-1 text-xs text-text-secondary opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
              coming soon
            </span>
          </button>
        </div>
      </div>

      {/* Skills */}
      <div className="border-t border-surface-border/40 pt-3">
        <h3 className="text-sm font-semibold text-text-primary mb-2 px-1">{t("sidebar.panel.agents")}</h3>
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <div className="w-5 h-5 border-2 border-surface-border border-t-brand rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 max-h-[50vh] overflow-y-auto pr-1">
            {skills.map((skill) => {
              const Icon = iconMap[skill.icon] || Sparkles;
              return (
                <button
                  key={skill.key}
                  // onClick={() => handleNavigate(`/skills/chat?key=${skill.key}`)}
                  title="coming soon"
                  className="relative flex items-center gap-2.5 p-2.5 rounded-xl text-left transition-all duration-150 cursor-not-allowed opacity-60 group"
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-surface-card">
                    <Icon className="w-4 h-4 text-text-tertiary" />
                  </div>
                  <span className="text-sm text-text-tertiary transition-colors truncate">{skill.title || skill.display_name || skill.key}</span>
                  <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded-lg bg-surface-elevated border border-surface-border px-2 py-1 text-xs text-text-secondary opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                    coming soon
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
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
  const { t } = useI18n();
  const themeCtx = useTheme();
  const theme = themeCtx?.theme || "light";
  const [collapsed, setCollapsed] = useState(false);
  const [expandedLabels, setExpandedLabels] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set([t("sidebar.time.today")]);
    try {
      const saved = localStorage.getItem("sidebar_expanded_labels");
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.length > 0) return new Set(arr);
      }
    } catch { /* ignore */ }
    return new Set([t("sidebar.time.today")]);
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sidebar-width");
      return saved ? Math.max(180, Math.min(500, Number(saved))) : 260;
    }
    return 260;
  });
  const isResizing = useRef(false);
  const [user, setUser] = useState<any>(null);
  const [conversations, setConversations] = useState<Conversation[]>(cachedConversations || []);
  const [loading, setLoading] = useState(cachedConversations === null);
  const [optimisticConvId, setOptimisticConvId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ConversationSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchSelectedIndex, setSearchSelectedIndex] = useState(-1);
  const searchListRef = useRef<HTMLDivElement>(null);
  const rawPathname = usePathname();
  const pathname = cleanPathname(rawPathname);
  const searchParams = useSearchParams();
  const routeConvId = searchParams.get("id");
  const currentConvId = optimisticConvId ?? routeConvId;
  const router = useRouter();
  const { templates, updateTemplate } = useTemplates();

  // 工作区
  const { workspaces, currentWS, loading: wsLoading, switchWorkspace, createWorkspace, deleteWorkspace, renameWorkspace } = useWorkspaces();

  /* 更多面板 */
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const moreTimerRef = useRef<NodeJS.Timeout | null>(null);

  /* AI工作面板 */
  const [workOpen, setWorkOpen] = useState(false);
  const workBtnRef = useRef<HTMLButtonElement>(null);
  const workTimerRef = useRef<NodeJS.Timeout | null>(null);

  const historyScrollRef = useRef<HTMLDivElement>(null);

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
      cachedConversations = next;
      return next;
    });
    restoreHistoryAnchor(anchor);
  }, [captureHistoryAnchor, restoreHistoryAnchor]);

  /* 收缩状态 tooltip */
  const [sidebarTooltip, setSidebarTooltip] = useState<{text: string; x: number; y: number} | null>(null);
  const showSidebarTooltip = (text: string) => (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setSidebarTooltip({ text, x: r.right + 8, y: r.top + r.height / 2 - 14 });
  };
  const hideSidebarTooltip = () => setSidebarTooltip(null);

  const handleMoreEnter = () => {
    if (moreTimerRef.current) clearTimeout(moreTimerRef.current);
    if (workTimerRef.current) clearTimeout(workTimerRef.current);
    setWorkOpen(false);
    setMoreOpen(true);
  };
  const handleMoreLeave = () => {
    moreTimerRef.current = setTimeout(() => setMoreOpen(false), 160);
  };

  const handleWorkEnter = () => {
    if (workTimerRef.current) clearTimeout(workTimerRef.current);
    if (moreTimerRef.current) clearTimeout(moreTimerRef.current);
    setMoreOpen(false);
    setWorkOpen(true);
  };
  const handleWorkLeave = () => {
    workTimerRef.current = setTimeout(() => setWorkOpen(false), 160);
  };

  /* 模板 */
  const [selectedTemplateId, setSelectedTemplateId] = useState(() => {
    if (typeof window !== "undefined") {
      return Number(localStorage.getItem("selected-template") || "0");
    }
    return 0;
  });

  /* 监听当前对话 ID：跟随 Next route state，不再轮询 location */
  useEffect(() => {
    setOptimisticConvId(null);
  }, [routeConvId]);

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
    const data = await fetchConversations(currentWS?.id);
    if (isFirstLoad) {
      const elapsed = Date.now() - startTime;
      if (elapsed < 600) await new Promise((r) => setTimeout(r, 600 - elapsed));
      setLoading(false);
    }
    if (data === null) return;
    if (isFirstLoad) {
      setConversations(data);
      cachedConversations = data;
    } else {
      updateConversationsStable(() => data);
    }
  }, [user, currentWS?.id, updateConversationsStable]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  /* ── 搜索 ── */
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || !user) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const data = await searchConversations(q, currentWS?.id, ctrl.signal);
        if (!ctrl.signal.aborted) {
          setSearchResults(data);
          setSearchLoading(false);
        }
      } catch {
        if (!ctrl.signal.aborted) setSearchLoading(false);
      }
    }, 280);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [searchQuery, user, currentWS?.id]);

  /* ── 关键词高亮 ── */
  function highlightKeywordParts(text: string, keyword: string): { text: string; isMatch: boolean }[] {
    if (!keyword.trim()) return [{ text, isMatch: false }];
    const parts = text.split(new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
    return parts.map((part) => ({
      text: part,
      isMatch: part.toLowerCase() === keyword.toLowerCase(),
    }));
  }

  /* ── 搜索键盘导航 ── */
  useEffect(() => {
    setSearchSelectedIndex(-1);
  }, [searchResults]);

  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSearchOpen(false);
        return;
      }
      if (searchResults.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSearchSelectedIndex((prev) => (prev + 1) % searchResults.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSearchSelectedIndex((prev) => (prev - 1 + searchResults.length) % searchResults.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const idx = searchSelectedIndex >= 0 ? searchSelectedIndex : 0;
        const conv = searchResults[idx];
        if (conv) {
          const convHref = conv.skill_key
            ? `/skills/chat?key=${conv.skill_key}&id=${conv.id}`
            : `/chat?id=${conv.id}`;
          setOptimisticConvId(String(conv.id));
          router.push(convHref, { scroll: false });
          setSearchOpen(false);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [searchOpen, searchResults, searchSelectedIndex, router]);

  useEffect(() => {
    if (searchSelectedIndex < 0 || !searchListRef.current) return;
    const el = searchListRef.current.querySelector(`[data-search-idx="${searchSelectedIndex}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [searchSelectedIndex]);

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
        title: d.title || t("sidebar.empty.new_chat"),
        model: d.model || "",
        pinned: !!d.pinned,
        created_at: d.created_at || now,
        updated_at: d.updated_at || now,
        skill_key: d.skill_key,
      };
      updateConversationsStable(prev => sortConversations([conv, ...prev.filter(c => c.id !== conv.id)]));
    };
    window.addEventListener("conversation-created", h);
    return () => window.removeEventListener("conversation-created", h);
  }, [loadConversations, t, updateConversationsStable]);
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
  // 工作区切换 / 登录登出时刷新
  useEffect(() => { const h = () => { cachedConversations = null; loadConversations(); }; window.addEventListener("workspace-changed", h); window.addEventListener("user-login", h); window.addEventListener("user-logout", h); return () => { window.removeEventListener("workspace-changed", h); window.removeEventListener("user-login", h); window.removeEventListener("user-logout", h); }; }, [loadConversations]);

  /* 操作 */
  const handleLogout = () => { localStorage.removeItem("token"); localStorage.removeItem("user"); import("@/lib/guestId").then(({ getGuestId }) => getGuestId()); setUser(null); setConversations([]); cachedConversations = null; window.location.href = "/"; };
  const handleNewChat = () => {
    const ts = Date.now();
    if (skillKey) {
      router.push(`/skills/chat?key=${skillKey}&t=${ts}`);
    } else {
      router.push(`/chat?t=${ts}`);
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
    try { const r = await fetch(`/api/conversations/${renameTarget.id}`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ title: newTitle }) }); if (r.ok) { const u = await r.json(); const next = conversations.map(c => c.id === u.id ? { ...c, title: u.title } : c); setConversations(next); cachedConversations = next; window.dispatchEvent(new CustomEvent("conversation-renamed", { detail: { id: u.id, title: u.title } })); } } catch {}
    setRenameTarget(null);
  };

  const handleTogglePin = async (conv: Conversation) => {
    const token = localStorage.getItem("token"); if (!token) return;
    try { const r = await fetch(`/api/conversations/${conv.id}`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ pinned: !conv.pinned }) }); if (r.ok) { const u = await r.json(); const next = sortConversations(conversations.map(c => c.id === u.id ? { ...c, pinned: u.pinned } : c)); setConversations(next); cachedConversations = next; } } catch {}
  };

  const handleShare = (conv: Conversation) => {
    const url = skillKey
      ? `${window.location.origin}/skills/chat?key=${skillKey}&id=${conv.id}`
      : `${window.location.origin}/chat?id=${conv.id}`;
    navigator.clipboard.writeText(url);
  };

  const handleOpenConversation = useCallback((conv: Conversation) => {
    const href = conv.skill_key
      ? `/skills/chat?key=${conv.skill_key}&id=${conv.id}`
      : `/chat?id=${conv.id}`;
    setOptimisticConvId(String(conv.id));
    router.push(href, { scroll: false });
  }, [router]);

  /* ── 拖拽调整宽度 ── */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.max(180, Math.min(500, startWidth + (ev.clientX - startX)));
      setSidebarWidth(newWidth);
      localStorage.setItem("sidebar-width", String(newWidth));
    };

    const onMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [sidebarWidth]);

  /* ── 渲染对话列表 ── */
  const renderConversationList = () => {
    if (loading) return <ConversationSkeleton />;
    if (conversations.length === 0) {
      return (
        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
          <div className="flex size-8 items-center justify-center rounded-full bg-surface-card border border-surface-border"><MessageSquare className="w-4 h-4 text-text-tertiary" /></div>
          <div className="space-y-1"><p className="text-xs text-text-secondary">{t("sidebar.empty.no_conversations")}</p><p className="text-[11px] text-text-tertiary">{user ? t("sidebar.empty.start_chat_hint") : t("sidebar.empty.login_hint")}</p></div>
        </div>
      );
    }

    const pinned = conversations.filter(c => c.pinned);
    const unpinned = conversations.filter(c => !c.pinned);
    const groups = groupConversationsByTime(unpinned, t);
    const sortedLabels = sortGroupLabels(Object.keys(groups), t);

    return (
      <div className="space-y-3">
        {pinned.length > 0 && (
          <div>
            <div className="px-3 py-1 text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t("sidebar.pinned")}</div>
            <div className="space-y-0.5">
              {pinned.map(conv => {
                const isActive = String(conv.id) === currentConvId;
                const skillMeta = conv.skill_key ? SKILL_ICON_MAP[conv.skill_key] : null;
                const IconComp = skillMeta ? skillMeta.icon : MessageSquare;
                const iconColor = isActive
                  ? (skillMeta ? skillMeta.color : "text-brand")
                  : "text-text-tertiary group-hover:text-text-secondary";
                return (
                  <div key={conv.id} role="button" tabIndex={0} data-conversation-row data-conversation-id={conv.id} onClick={() => handleOpenConversation(conv)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleOpenConversation(conv); } }} className={cn("group flex w-full cursor-pointer items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-200", isActive ? "bg-brand/10 text-brand" : "text-text-secondary hover:bg-surface-card hover:text-text-primary")}>
                    <IconComp className={cn("w-3.5 h-3.5 shrink-0 transition-all duration-200", iconColor)} />
                    <Pin className="w-3 h-3 shrink-0 text-brand" />
                    <span className={cn("flex-1 truncate text-left", isActive && "font-medium")}>{conv.title || t("sidebar.empty.new_chat")}</span>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity"><ConvMenu onRename={() => setRenameTarget(conv)} onTogglePin={() => handleTogglePin(conv)} pinned={conv.pinned} onShare={() => handleShare(conv)} onDelete={() => handleDelete(conv.id)} /></div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {sortedLabels.map(label => {
          const isExpanded = expandedLabels.has(label);
          return (
          <div key={label}>
            <button
              onClick={() => setExpandedLabels(prev => {
                const next = new Set(prev);
                if (next.has(label)) next.delete(label);
                else next.add(label);
                try {
                  localStorage.setItem("sidebar_expanded_labels", JSON.stringify(Array.from(next)));
                } catch { /* ignore */ }
                return next;
              })}
              className="flex items-center justify-between w-full px-3 py-1 text-[11px] font-medium text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors"
            >
              <span>{label}</span>
              <ChevronRight className={cn("w-3 h-3 transition-transform duration-200", isExpanded && "rotate-90")} />
            </button>
            {isExpanded && (
            <div className="space-y-0.5">
              {groups[label].map(conv => {
                const isActive = String(conv.id) === currentConvId;
                const skillMeta = conv.skill_key ? SKILL_ICON_MAP[conv.skill_key] : null;
                const IconComp = skillMeta ? skillMeta.icon : MessageSquare;
                const iconColor = isActive
                  ? (skillMeta ? skillMeta.color : "text-brand")
                  : "text-text-tertiary group-hover:text-text-secondary";
                return (
                  <div key={conv.id} role="button" tabIndex={0} data-conversation-row data-conversation-id={conv.id} onClick={() => handleOpenConversation(conv)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleOpenConversation(conv); } }} className={cn("group flex w-full cursor-pointer items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-200", isActive ? "bg-brand/10 text-brand" : "text-text-secondary hover:bg-surface-card hover:text-text-primary")}>
                    <IconComp className={cn("w-3.5 h-3.5 shrink-0 transition-all duration-200", iconColor)} />
                    <span className={cn("flex-1 truncate text-left", isActive && "font-medium")}>{conv.title || t("sidebar.empty.new_chat")}</span>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity"><ConvMenu onRename={() => setRenameTarget(conv)} onTogglePin={() => handleTogglePin(conv)} pinned={conv.pinned} onShare={() => handleShare(conv)} onDelete={() => handleDelete(conv.id)} /></div>
                  </div>
                );
              })}
            </div>
            )}
          </div>
          );
        })}
      </div>
    );
  };

  /* ═══════════════════ JSX ═══════════════════ */

  return (
    <>
      {/* 占位 div：与 fixed sidebar 保持同宽，撑开文档流 */}
      <div
        className="hidden md:block shrink-0 h-screen"
        style={{ width: collapsed ? 52 : sidebarWidth }}
      />
      {/* 侧边栏主体 */}
      <div
        className={cn("fixed left-0 top-0 z-40 flex flex-col h-screen bg-surface-elevated border-r border-surface-border rounded-r-2xl transition-[width] duration-200 ease-out", collapsed ? "w-[52px]" : "")}
        style={{ width: collapsed ? 52 : sidebarWidth }}
      >

        {/* —— Logo + 折叠 —— */}
        <div className="flex items-center h-12 px-3 shrink-0">
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <button type="button" onClick={handleNewChat} className="flex items-center gap-2">
                <img src={theme === "dark" ? "/brand-dark-logo.png" : "/brand-light-logo.png"} alt="AI Space" className="h-6 w-auto rounded-lg object-contain" />
                <img src={theme === "dark" ? "/brand-dark-title.png" : "/brand-light-title.png"} alt="AI Space" className="h-6 w-auto object-contain ml-1.5" />
              </button>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={() => { setSearchOpen(true); setSearchQuery(""); setSearchResults([]); }}
              className="mr-1 rounded-lg p-1.5 text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
              title={t("sidebar.tooltip.search")}
            >
              <Search className="w-4 h-4" />
            </button>
          )}
          {collapsed && (
            <div className="flex-1 flex justify-center">
              <button type="button" onClick={handleNewChat}>
                <img src={theme === "dark" ? "/brand-dark-logo.png" : "/brand-light-logo.png"} alt="AI Space" className="w-8 h-8 rounded-lg object-cover" />
              </button>
            </div>
          )}
          <button onClick={() => setCollapsed(!collapsed)} className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors">
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {/* ── 可滚动区域 ── */}
        {collapsed ? (
          <div className="flex-1 flex flex-col items-center overflow-visible">
            {/* 聊天 - 移到顶部，保留原新对话位置 */}
            <div className="pt-3 pb-2">
              <button
                type="button"
                onClick={handleNewChat}
                onMouseEnter={showSidebarTooltip(t("sidebar.tooltip.chat"))}
                onMouseLeave={hideSidebarTooltip}
                className={cn(
                  "p-2.5 rounded-xl transition-colors block",
                  pathname === "/chat" ? "bg-brand/10 text-brand" : "text-text-tertiary hover:bg-surface-card hover:text-text-primary"
                )}
              >
                <MessageSquare className={cn("w-5 h-5", pathname === "/chat" ? "text-brand" : "text-text-tertiary")} />
              </button>
            </div>

            {/* 功能分组 - 对齐展开状态的 px-3 py-2 */}
            <div className="py-2 flex flex-col items-center space-y-0.5">
              {/* workspace空间 */}
              <Link
                href="/workspace"
                onMouseEnter={showSidebarTooltip(t("sidebar.tooltip.workspace"))}
                onMouseLeave={hideSidebarTooltip}
                className={cn(
                  "p-2.5 rounded-xl transition-colors",
                  pathname === "/workspace" ? "bg-brand/10 text-brand" : "text-text-tertiary hover:bg-surface-card hover:text-text-primary"
                )}
              >
                <FolderKanban className={cn("w-5 h-5", pathname === "/workspace" ? "text-brand" : "text-text-tertiary")} />
              </Link>

              {/* AI工作 - hover 展开面板 */}
              <div
                onMouseEnter={handleWorkEnter}
                onMouseLeave={handleWorkLeave}
              >
                <button
                  ref={workBtnRef}
                  className={cn(
                    "p-2.5 rounded-xl transition-colors",
                    pathname === "/ppt" || pathname?.startsWith("/ppt/") || pathname === "/skills" || pathname?.startsWith("/skills/")
                      ? "bg-brand/10 text-brand"
                      : "text-text-tertiary hover:bg-surface-card hover:text-text-primary"
                  )}
                >
                  <Briefcase className={cn("w-5 h-5",
                    pathname === "/ppt" || pathname?.startsWith("/ppt/") || pathname === "/skills" || pathname?.startsWith("/skills/")
                      ? "text-orange-500"
                      : "text-text-tertiary"
                  )} />
                </button>
              </div>

              {/* 更多 - hover 展开面板，不需要 tooltip */}
              <div
                onMouseEnter={handleMoreEnter}
                onMouseLeave={handleMoreLeave}
              >
                <button
                  ref={moreBtnRef}
                  className={cn(
                    "p-2.5 rounded-xl transition-colors",
                    pathname === "/image" || pathname?.startsWith("/image/") || pathname === "/templates"
                      ? "bg-brand/10 text-brand"
                      : "text-text-tertiary hover:bg-surface-card hover:text-text-primary"
                  )}
                >
                  <LayoutGrid className={cn("w-5 h-5", pathname === "/image" || pathname?.startsWith("/image/") || pathname === "/templates" ? "text-brand" : "text-text-tertiary")} />
                </button>
              </div>

              {/* 收藏 */}
              <Link
                href="/favorites"
                onMouseEnter={showSidebarTooltip(t("sidebar.tooltip.favorites"))}
                onMouseLeave={hideSidebarTooltip}
                className={cn(
                  "p-2.5 rounded-xl transition-colors",
                  pathname === "/favorites" ? "bg-amber-400/10 text-amber-400" : "text-text-tertiary hover:bg-surface-card hover:text-text-primary"
                )}
              >
                <Star className={cn("w-5 h-5", pathname === "/favorites" ? "text-amber-400 fill-amber-400" : "text-text-tertiary")} />
              </Link>
            </div>

            {/* 分隔线 - 功能与历史分组之间 */}
            <div className="w-6 h-px bg-surface-border/40 my-2" />

            {/* 历史分组 - 点击展开侧边栏 */}
            <div className="py-2">
              <button
                onClick={() => setCollapsed(false)}
                onMouseEnter={showSidebarTooltip(t("sidebar.tooltip.history"))}
                onMouseLeave={hideSidebarTooltip}
                className="p-2.5 rounded-xl hover:bg-surface-card transition-colors"
              >
                <Clock className="w-5 h-5 text-text-tertiary" />
              </button>
            </div>
          </div>
        ) : (
          <div ref={historyScrollRef} className="flex-1 overflow-y-auto scrollbar-hide">
            {/* ▼ 聊天按钮 */}
            <div className="px-3 pt-3 pb-2">
              <button
                type="button"
                onClick={handleNewChat}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150",
                  pathname === "/chat"
                    ? "bg-brand/10 text-text-primary font-medium shadow-[inset_2px_0_0_0_var(--brand)]"
                    : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                )}
              >
                <MessageSquare className={cn("w-[18px] h-[18px] shrink-0 transition-colors", pathname === "/chat" ? "text-brand" : "text-text-tertiary")} />
                <span>{t("sidebar.nav.chat")}</span>
              </button>
            </div>

            {/* 分隔线 - 聊天与Agents之间 */}
            <div className="mx-3 h-px bg-surface-border/40" />

            {/* ▼ 功能分组 */}
            <div className="px-3 py-2">
              <div className="mb-2 px-1">
                <span className="text-sm font-bold text-text-tertiary/80 tracking-wide">Agents</span>
              </div>
              <div className="space-y-0.5">
                {/* workspace空间 */}
                <Link
                  href="/workspace"
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150",
                    pathname === "/workspace"
                      ? "bg-brand/10 text-text-primary font-medium shadow-[inset_2px_0_0_0_var(--brand)]"
                      : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                  )}
                >
                  <FolderKanban className={cn("w-[18px] h-[18px] shrink-0 transition-colors", pathname === "/workspace" ? "text-brand" : "text-text-tertiary")} />
                  <span>{t("sidebar.nav.workspace")}</span>
                </Link>

                {/* AI工作 - hover 展开 */}
                <div
                  onMouseEnter={handleWorkEnter}
                  onMouseLeave={handleWorkLeave}
                >
                  <button
                    ref={workBtnRef}
                    className={cn(
                      "flex items-center justify-between w-full px-3 py-2.5 rounded-xl text-sm transition-all duration-150",
                      pathname === "/ppt" || pathname?.startsWith("/ppt/") || pathname === "/skills" || pathname?.startsWith("/skills/")
                        ? "bg-brand/10 text-text-primary font-medium shadow-[inset_2px_0_0_0_var(--brand)]"
                        : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Briefcase className={cn("w-[18px] h-[18px] shrink-0 transition-colors",
                        pathname === "/ppt" || pathname?.startsWith("/ppt/") || pathname === "/skills" || pathname?.startsWith("/skills/")
                          ? "text-orange-500"
                          : "text-text-tertiary"
                      )} />
                      <span>{t("sidebar.nav.ai_work")}</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-text-tertiary" />
                  </button>
                </div>

                {/* 更多 - hover 展开 */}
                <div
                  onMouseEnter={handleMoreEnter}
                  onMouseLeave={handleMoreLeave}
                >
                  <button
                    ref={moreBtnRef}
                    className={cn(
                      "flex items-center justify-between w-full px-3 py-2.5 rounded-xl text-sm transition-all duration-150",
                      pathname === "/image" || pathname?.startsWith("/image/") || pathname === "/templates"
                        ? "bg-brand/10 text-text-primary font-medium shadow-[inset_2px_0_0_0_var(--brand)]"
                        : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <LayoutGrid className={cn("w-[18px] h-[18px] shrink-0 transition-colors", pathname === "/image" || pathname?.startsWith("/image/") || pathname === "/templates" ? "text-brand" : "text-text-tertiary")} />
                      <span>{t("sidebar.nav.ai_create")}</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-text-tertiary" />
                  </button>
                </div>

                {/* 收藏 */}
                <Link
                  href="/favorites"
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 w-full text-left",
                    pathname === "/favorites" ? "bg-amber-400/10 text-text-primary font-medium" : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                  )}
                >
                  <Star className={cn("w-[18px] h-[18px] shrink-0 transition-colors", pathname === "/favorites" ? "text-amber-400 fill-amber-400" : "text-text-tertiary")} />
                  <span>{t("sidebar.nav.favorites")}</span>
                </Link>
              </div>
            </div>

            {/* ▼ 历史分组 */}
            <div className="px-3 py-2">
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-sm font-bold text-text-tertiary/80 tracking-wide">{t("sidebar.nav.history")}</span>
              </div>
              {renderConversationList()}
            </div>
          </div>
        )}

        {/* 分隔线 - 历史与底部用户之间 */}
        <div className="shrink-0 mx-3 h-px bg-surface-border/40" />

        {/* —— 底部用户 —— */}
        <div className="shrink-0">
          <SidebarUserPanel
            user={user}
            collapsed={collapsed}
            onLogout={handleLogout}
            onOpenSettings={() => router.push("/settings")}
            onShowTooltip={showSidebarTooltip}
            onHideTooltip={hideSidebarTooltip}
          />
        </div>

        {/* 拖拽调整宽度手柄 - 仅展开状态显示 */}
        {!collapsed && (
          <div
            className="absolute top-0 right-0 z-50 w-2 h-full cursor-col-resize group"
            onMouseDown={handleMouseDown}
          >
            <div className="absolute inset-0 -left-1 -right-1 rounded-full transition-all duration-150 group-hover:bg-brand/30 group-active:bg-brand/50" />
          </div>
        )}
      </div>

      {/* 更多 hover 面板 */}
      <MoreHoverPanel open={moreOpen} anchorEl={moreBtnRef.current} onClose={() => setMoreOpen(false)} onMouseEnter={handleMoreEnter} onMouseLeave={handleMoreLeave} />

      {/* AI工作 hover 面板 */}
      <WorkHoverPanel open={workOpen} anchorEl={workBtnRef.current} onClose={() => setWorkOpen(false)} onMouseEnter={handleWorkEnter} onMouseLeave={handleWorkLeave} />

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
      <ConfirmDialog isOpen={!!deleteTarget} title={t("sidebar.dialog.delete_title")} description={t("sidebar.dialog.delete_desc")} confirmText={t("sidebar.dialog.delete_confirm")} cancelText={t("sidebar.dialog.cancel")} variant="danger" onConfirm={confirmDelete} onCancel={() => setDeleteTarget(null)} />
      <InputDialog isOpen={!!renameTarget} title={t("sidebar.dialog.rename_title")} defaultValue={renameTarget?.title || ""} placeholder={t("sidebar.dialog.rename_placeholder")} confirmText={t("sidebar.dialog.save")} cancelText={t("sidebar.dialog.cancel")} onConfirm={handleRename} onCancel={() => setRenameTarget(null)} />

      {/* ── 搜索弹窗 ── */}
      {searchOpen && createPortal(
        <div
          className="fixed inset-0 z-[80] flex items-start justify-center pt-[20vh]"
          onClick={() => setSearchOpen(false)}
        >
          {/* 遮罩 */}
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          {/* 弹窗内容 */}
          <div
            className="relative w-full max-w-xl mx-4 rounded-2xl bg-surface-card border border-surface-border shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 搜索框 */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-border">
              <Search className="w-5 h-5 text-text-tertiary shrink-0" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("sidebar.search.placeholder")}
                autoFocus
                className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="rounded-full p-1 text-text-tertiary hover:bg-surface-elevated hover:text-text-primary transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* 结果列表 */}
            <div ref={searchListRef} className="max-h-[50vh] overflow-auto">
              {!user ? (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <div className="flex size-10 items-center justify-center rounded-full bg-surface-elevated border border-surface-border">
                    <MessageSquare className="w-5 h-5 text-text-tertiary" />
                  </div>
                  <p className="text-sm text-text-secondary">{t("sidebar.search.login_required")}</p>
                </div>
              ) : searchQuery.trim() ? (
                searchLoading ? (
                  <div className="space-y-1 py-2">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
                        <div className="w-8 h-8 rounded-lg bg-surface-border shrink-0" />
                        <div className="flex-1 space-y-2">
                          <div className="h-3.5 w-1/3 rounded bg-surface-border" />
                          <div className="h-3 w-2/3 rounded bg-surface-border" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-12 text-center">
                    <div className="flex size-10 items-center justify-center rounded-full bg-surface-elevated border border-surface-border">
                      <Search className="w-5 h-5 text-text-tertiary" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-text-secondary">{t("sidebar.search.no_results")}</p>
                      <p className="text-xs text-text-tertiary">{t("sidebar.search.try_different")}</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-0.5 py-1">
                    <div className="px-4 py-2 text-xs text-text-tertiary border-b border-surface-border/40">
                      {t("sidebar.search.results_found")} {searchResults.length} {t("sidebar.search.results_count_suffix")}
                    </div>
                    {searchResults.map((conv, idx) => {
                      const convHref = conv.skill_key
                        ? `/skills/chat?key=${conv.skill_key}&id=${conv.id}`
                        : `/chat?id=${conv.id}`;
                      const skillMeta = conv.skill_key ? SKILL_ICON_MAP[conv.skill_key] : null;
                      const IconComp = skillMeta ? skillMeta.icon : MessageSquare;
                      const isSelected = idx === searchSelectedIndex;
                      return (
                        <button
                          key={conv.id}
                          type="button"
                          data-search-idx={idx}
                          onClick={() => {
                            setOptimisticConvId(String(conv.id));
                            router.push(convHref, { scroll: false });
                            setSearchOpen(false);
                          }}
                          onMouseEnter={() => setSearchSelectedIndex(idx)}
                          className={cn(
                            "group flex items-start gap-3 px-4 py-3 transition-colors",
                            isSelected ? "bg-surface-elevated" : "hover:bg-surface-elevated"
                          )}
                        >
                          <div className="flex size-8 items-center justify-center rounded-lg bg-brand/10 shrink-0 mt-0.5">
                            <IconComp className="w-4 h-4 text-brand" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-text-primary truncate">
                                {conv.title || t("sidebar.empty.new_chat")}
                              </span>
                              <span className="text-xs text-text-tertiary shrink-0">
                                {new Date(conv.updated_at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}
                              </span>
                            </div>
                            {conv.matched_content && (
                              <p className="mt-0.5 text-xs text-text-tertiary line-clamp-2 leading-relaxed">
                                {highlightKeywordParts(conv.matched_content, searchQuery).map((part, i) =>
                                  part.isMatch ? (
                                    <strong key={i} className="font-semibold text-text-primary">{part.text}</strong>
                                  ) : (
                                    <span key={i}>{part.text}</span>
                                  )
                                )}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )
              ) : (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <div className="flex size-10 items-center justify-center rounded-full bg-surface-elevated border border-surface-border">
                    <Search className="w-5 h-5 text-text-tertiary" />
                  </div>
                  <p className="text-sm text-text-secondary">{t("sidebar.search.enter_keyword")}</p>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
