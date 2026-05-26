"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  User,
  Palette,
  FileText,
  Check,
  ChevronDown,
  Search,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/components/theme/ThemeProvider";
import { cn } from "@/lib/utils";
import TemplatesPage from "@/app/(main)/templates/page";

type Tab = "general" | "templates";

/* ═══════════════════ 账户 ═══════════════════ */

function AccountSection() {
  const { t } = useI18n();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const raw = localStorage.getItem("user");
    if (raw) {
      try {
        setUser(JSON.parse(raw));
      } catch { /* ignore */ }
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    router.push("/login");
  };

  const name = user?.name || "";
  const email = user?.email || "";

  return (
    <div>
      <h2 className="text-lg font-semibold text-text-primary">{t("account.title")}</h2>

      <div className="mt-6">
        <div className="flex items-center justify-between rounded-2xl bg-surface-card px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
              <span className="text-base font-semibold">
                {(name || email || "U")[0]?.toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-text-primary">
                {name || email}
              </div>
              <div className="truncate text-xs text-text-tertiary">{email}</div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="shrink-0 rounded-xl border border-surface-border bg-surface-elevated px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-card hover:text-text-primary"
          >
            {t("account.logout")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ 外观 ═══════════════════ */

function ThemeDropdown() {
  const { t } = useI18n();
  const themeCtx = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const themes = [
    { id: "light" as const, label: t("appearance.theme.light") },
    { id: "dark" as const, label: t("appearance.theme.dark") },
    { id: "green" as const, label: t("appearance.theme.green") },
  ];

  const current = themes.find((th) => th.id === themeCtx?.theme);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between rounded-xl border border-surface-border bg-surface-card px-4 py-3 text-sm text-text-primary transition-colors hover:border-surface-border/80"
      >
        <span>{current?.label}</span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-text-tertiary transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-full rounded-xl border border-surface-border bg-surface-elevated shadow-xl py-1 animate-fade-in">
          {themes.map((theme) => (
            <button
              key={theme.id}
              onClick={() => {
                themeCtx?.setTheme(theme.id);
                setOpen(false);
              }}
              className={cn(
                "flex items-center justify-between w-full px-4 py-2.5 text-sm transition-colors",
                themeCtx?.theme === theme.id
                  ? "bg-purple-500/10 text-text-primary"
                  : "text-text-secondary hover:bg-surface-card"
              )}
            >
              <span>{theme.label}</span>
              {themeCtx?.theme === theme.id && (
                <Check className="w-4 h-4 text-text-primary" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LanguageDropdown() {
  const { language, setLanguage, languages, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const currentLang = languages.find((l) => l.code === language);

  const filtered = useMemo(() => {
    if (!search.trim()) return languages;
    const q = search.trim().toLowerCase();
    return languages.filter(
      (l) =>
        l.label.toLowerCase().includes(q) ||
        l.labelEn.toLowerCase().includes(q)
    );
  }, [search, languages]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between rounded-xl border border-surface-border bg-surface-card px-4 py-3 text-sm text-text-primary transition-colors hover:border-surface-border/80"
      >
        <div className="flex items-center gap-2">
          <span>{currentLang?.label}</span>
          <span className="text-text-tertiary text-xs">({currentLang?.labelEn})</span>
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-text-tertiary transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-full rounded-xl border border-surface-border bg-surface-elevated shadow-xl py-2 animate-fade-in">
          <div className="px-3 pb-2">
            <div className="flex items-center gap-2 rounded-lg bg-surface-card px-3 py-2">
              <Search className="w-4 h-4 text-text-tertiary shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("appearance.language.search")}
                className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-auto">
            {filtered.map((lang) => (
              <button
                key={lang.code}
                onClick={() => {
                  setLanguage(lang.code);
                  setOpen(false);
                  setSearch("");
                }}
                className={cn(
                  "flex flex-col w-full px-4 py-2.5 text-left transition-colors",
                  language === lang.code
                    ? "bg-purple-500/10 text-text-primary"
                    : "text-text-secondary hover:bg-surface-card"
                )}
              >
                <span className="text-sm">{lang.label}</span>
                <span className="text-xs text-text-tertiary">{lang.labelEn}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-4 py-3 text-sm text-text-tertiary">
                {t("appearance.language.noResults")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AppearanceSection() {
  const { t } = useI18n();

  return (
    <div>
      <h2 className="text-lg font-semibold text-text-primary">{t("appearance.title")}</h2>

      <div className="mt-6 divide-y divide-surface-border">
        <div className="flex items-center justify-between py-4 gap-4">
          <span className="text-sm text-text-primary shrink-0">{t("appearance.theme")}</span>
          <div className="w-52">
            <ThemeDropdown />
          </div>
        </div>
        <div className="flex items-center justify-between py-4 gap-4">
          <span className="text-sm text-text-primary shrink-0">{t("appearance.language")}</span>
          <div className="w-52">
            <LanguageDropdown />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ 主页面 ═══════════════════ */

export default function SettingsPage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<Tab>("general");

  const navItems: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "general", label: t("settings.nav.general"), icon: User },
    { id: "templates", label: t("settings.nav.templates"), icon: FileText },
  ];

  return (
    <div className="flex h-full bg-surface-elevated">
      {/* 左侧导航 */}
      <aside className="w-60 flex flex-col shrink-0">
        <nav className="flex-1 px-3 pb-6 pt-6 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-base transition-all",
                  activeTab === item.id
                    ? "bg-surface-card text-text-primary font-medium shadow-sm"
                    : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* 右侧内容 */}
      <main
        className={cn(
          "flex-1",
          activeTab === "templates" ? "overflow-hidden" : "overflow-auto"
        )}
      >
        {activeTab === "general" && (
          <div className="max-w-2xl mx-auto px-8 py-8 space-y-10">
            <AccountSection />
            <AppearanceSection />
          </div>
        )}
        {activeTab === "templates" && (
          <div className="h-full">
            <TemplatesPage />
          </div>
        )}
      </main>
    </div>
  );
}
