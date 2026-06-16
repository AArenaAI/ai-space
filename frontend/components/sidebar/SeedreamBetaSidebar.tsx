"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Clapperboard,
  FileText,
  FolderOpen,
  ImageIcon,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Video,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import SidebarUserPanel from "@/components/sidebar/SidebarUserPanel";
import { useSeedreamProjects } from "@/app/(main)/(seedream-beta)/seedream-beta/useSeedreamProjects";

const SIDEBAR_WIDTH_KEY = "seedream-beta-sidebar-width";

const NAV_GROUPS = [
  {
    titleKey: "seedreamBeta.sidebar.creation",
    items: [
      { icon: Wand2, labelKey: "seedreamBeta.workflowTab", href: "/seedream-beta?tab=workflow", matchPath: "/seedream-beta", matchQuery: "tab=workflow" },
      { icon: FileText, labelKey: "seedreamBeta.workflow.scriptTitle", href: "/seedream-beta?tab=workflow&mode=script", matchPath: "/seedream-beta", matchQuery: "tab=workflow&mode=script" },
      { icon: Library, labelKey: "seedreamBeta.workflow.assetsTitle", href: "/seedream-beta?tab=workflow&mode=assets", matchPath: "/seedream-beta", matchQuery: "tab=workflow&mode=assets" },
      { icon: Clapperboard, labelKey: "seedreamBeta.workflow.storyboardVideoTitle", href: "/seedream-beta?tab=workflow&mode=storyboardVideo", matchPath: "/seedream-beta", matchQuery: "tab=workflow&mode=storyboardVideo" },
      { icon: ImageIcon, labelKey: "seedreamBeta.workflow.storyboardImageTitle", href: "/seedream-beta?tab=workflow&mode=storyboardImage", matchPath: "/seedream-beta", matchQuery: "tab=workflow&mode=storyboardImage" },
    ],
  },
  {
    titleKey: "seedreamBeta.sidebar.production",
    items: [
      { icon: ImageIcon, labelKey: "seedreamBeta.imageTab", href: "/seedream-beta?tab=image", matchPath: "/seedream-beta", matchQuery: "tab=image" },
      { icon: Video, labelKey: "seedreamBeta.videoTab", href: "/seedream-beta?tab=video", matchPath: "/seedream-beta", matchQuery: "tab=video" },
      { icon: Sparkles, labelKey: "seedreamBeta.sidebar.queue", href: "/seedream-beta?tab=workflow&mode=storyboardImage", matchPath: "/seedream-beta", matchQuery: "tab=workflow&mode=storyboardImage" },
    ],
  },
];

function cleanPathname(pathname: string | null): string {
  let cleaned = (pathname ?? "").replace(/\.html$/, "").split("?")[0];
  if (cleaned !== "/") cleaned = cleaned.replace(/\/$/, "");
  return cleaned;
}

function getQuery(href: string): string | undefined {
  const idx = href.indexOf("?");
  return idx >= 0 ? href.slice(idx + 1) : undefined;
}

export default function SeedreamBetaSidebar() {
  const { t } = useI18n();
  const rawPathname = usePathname();
  const pathname = cleanPathname(rawPathname);
  const searchParams = useSearchParams();
  const [collapsed, setCollapsed] = useState(false);
  const [user, setUser] = useState<any>(null);

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return 260;
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? Math.max(220, Math.min(500, Number(saved))) : 280;
  });
  const isResizing = useRef(false);
  const displayWidth = collapsed ? 52 : sidebarWidth;

  const {
    projects,
    activeProjectId,
    setActiveProjectId,
    createProject,
    deleteProject,
    renameProject,
  } = useSeedreamProjects(t("seedreamBeta.projects.newProject"));

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    const refreshUser = () => {
      const stored = localStorage.getItem("user");
      if (!stored) {
        setUser(null);
        return;
      }
      try {
        setUser(JSON.parse(stored));
      } catch {
        setUser(null);
      }
    };
    refreshUser();
    window.addEventListener("storage", refreshUser);
    return () => window.removeEventListener("storage", refreshUser);
  }, []);

  const handleCreateProject = () => {
    const title = newTitle.trim() || t("seedreamBeta.projects.newProject");
    createProject(title);
    setCreating(false);
    setNewTitle("");
  };

  const handleRenameProject = (id: string) => {
    renameProject(id, renameTitle);
    setRenaming(null);
    setRenameTitle("");
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.max(220, Math.min(500, startWidth + moveEvent.clientX - startX));
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <div className="relative flex h-full shrink-0 flex-col border-r border-surface-border bg-surface-elevated" style={{ width: displayWidth }}>
      <div className={cn("flex px-3 py-3", collapsed ? "flex-col items-center gap-2" : "items-center justify-between")}>
        {!collapsed && (
          <div className="min-w-0">
            <Link
              href="/create"
              className="mb-1 inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-medium text-text-tertiary transition-colors hover:bg-surface-card hover:text-text-primary"
              title="返回创作中心"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回创作中心
            </Link>
            <div className="truncate text-sm font-semibold text-text-primary">{t("seedreamBeta.navLabel")}</div>
          </div>
        )}
        {collapsed && (
          <Link
            href="/create"
            className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-surface-card hover:text-text-primary"
            title="返回创作中心"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-surface-card hover:text-text-primary"
          title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {!collapsed && (
        <div className="border-b border-surface-border/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t("seedreamBeta.projects.title")}</span>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="rounded-lg p-1 text-text-tertiary hover:bg-surface-card hover:text-text-primary"
              title={t("seedreamBeta.projects.create")}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {creating && (
            <div className="mb-2 flex items-center gap-1">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={t("seedreamBeta.projects.newProject")}
                className="min-w-0 flex-1 rounded-lg border border-surface-border bg-surface-elevated px-2 py-1 text-xs text-text-primary outline-none focus:border-brand"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateProject();
                  if (e.key === "Escape") { setCreating(false); setNewTitle(""); }
                }}
                autoFocus
              />
              <button type="button" onClick={handleCreateProject} className="rounded-lg p-1 text-brand hover:bg-brand/10">
                <Check className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
            {projects.map((project) => (
              <div
                key={project.id}
                className={cn(
                  "group flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm transition-colors",
                  activeProjectId === project.id
                    ? "bg-brand/10 text-brand"
                    : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                )}
              >
                {renaming === project.id ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1">
                    <input
                      type="text"
                      value={renameTitle}
                      onChange={(e) => setRenameTitle(e.target.value)}
                      className="min-w-0 flex-1 rounded border border-surface-border bg-surface-elevated px-1.5 py-0.5 text-xs text-text-primary outline-none focus:border-brand"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameProject(project.id);
                        if (e.key === "Escape") { setRenaming(null); setRenameTitle(""); }
                      }}
                      autoFocus
                    />
                    <button type="button" onClick={() => handleRenameProject(project.id)} className="rounded p-0.5 text-brand hover:bg-brand/10">
                      <Check className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setActiveProjectId(project.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <FolderOpen className="h-4 w-4 shrink-0" />
                      <span className="truncate">{project.title}</span>
                    </button>
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => { setRenaming(project.id); setRenameTitle(project.title); }}
                        className="rounded p-0.5 text-text-tertiary hover:bg-surface-card hover:text-text-primary"
                        title={t("seedreamBeta.projects.rename")}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteProject(project.id)}
                        className="rounded p-0.5 text-text-tertiary hover:bg-red-50 hover:text-red-500"
                        title={t("seedreamBeta.projects.deleted")}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {projects.length === 0 && !creating && (
              <div className="px-2.5 py-2 text-xs text-text-tertiary">{t("seedreamBeta.noProjects")}</div>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.titleKey} className="mb-4">
            {!collapsed && (
              <div className="mb-1 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t(group.titleKey)}</div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const itemQuery = getQuery(item.href);
                const expected = new URLSearchParams(itemQuery || "");
                const currentTab = searchParams.get("tab") || "workflow";
                const currentMode = searchParams.get("mode") || "";
                const expectedTab = expected.get("tab") || "workflow";
                const expectedMode = expected.get("mode") || "";
                const isActive = pathname === item.matchPath && currentTab === expectedTab && currentMode === expectedMode;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.labelKey}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-brand/10 text-brand"
                        : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                    )}
                    title={collapsed ? t(item.labelKey) : undefined}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {!collapsed && <span className="truncate">{t(item.labelKey)}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto border-t border-surface-border/60">
        <SidebarUserPanel user={user} collapsed={collapsed} />
      </div>

      {!collapsed && (
        <div
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-brand/20"
          onMouseDown={handleMouseDown}
        />
      )}
    </div>
  );
}
