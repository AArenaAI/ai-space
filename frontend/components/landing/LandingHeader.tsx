"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MessageSquare, Menu, X, LogOut, User, Zap, Sparkles, Crown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import AuthAwareButton, { showLoginModal } from "./AuthAwareButton";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useCredits } from "@/hooks/useCredits";
import { useI18n } from "@/lib/i18n";

const navLinks = [
  { labelKey: "landing.nav.features", href: "#features" },
  { labelKey: "landing.nav.demo", href: "#demo" },
  { labelKey: "landing.nav.about", href: "#stats" },
  { labelKey: "landing.nav.pricing", href: "/pricing" },
];

export default function LandingHeader() {
  const { t } = useI18n();
  const themeCtx = useTheme();
  const theme = themeCtx?.theme || "light";
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { credits } = useCredits();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const readUser = () => {
      try {
        const s = localStorage.getItem("user");
        setUser(s ? JSON.parse(s) : null);
      } catch { setUser(null); }
    };
    readUser();
    window.addEventListener("storage", readUser);
    return () => window.removeEventListener("storage", readUser);
  }, []);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
    setDropdownOpen(false);
  };

  const avatarEl = (size: number, textSize: string) => {
    const src = user?.avatar;
    const initial = (user?.name || user?.email || "?").charAt(0).toUpperCase();
    return src ? (
      <img src={src} alt={user?.name || ""} className="w-full h-full object-cover" />
    ) : (
      <div className={cn("w-full h-full flex items-center justify-center bg-brand/10 text-brand font-semibold", textSize)}>
        {initial}
      </div>
    );
  };

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
        scrolled
          ? "bg-surface/80 backdrop-blur-xl border-b border-surface-border shadow-sm"
          : "bg-transparent"
      )}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5">
            <img src={theme === "dark" ? "/brand-dark-logo.png" : "/brand-light-logo.png"} alt="AI Space" className="w-8 h-8 rounded-xl object-cover" />
            <img src={theme === "dark" ? "/brand-dark-title.png" : "/brand-light-title.png"} alt="AI Space" className="h-6 w-auto object-contain" />
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                {t(link.labelKey)}
              </a>
            ))}
          </nav>

          {/* CTA */}
          <div className="hidden md:flex items-center gap-3">
            {user ? (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen((open) => !open)}
                  className="flex items-center justify-center w-9 h-9 rounded-full overflow-hidden border border-surface-border bg-surface-card hover:ring-2 hover:ring-brand/20 transition-all"
                >
                  {avatarEl(36, "text-xs")}
                </button>
                {dropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 w-[280px] rounded-2xl border border-surface-border bg-surface-elevated shadow-xl p-4 z-50 animate-fade-in">
                    {/* 头像 + 用户名 + 邮箱 */}
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full overflow-hidden border border-surface-border bg-surface-card shrink-0">
                        {avatarEl(40, "text-sm")}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-text-primary truncate">{user?.name || t("landing.user.default")}</p>
                        <p className="text-xs text-text-tertiary truncate">{user?.email || ""}</p>
                      </div>
                    </div>

                    {/* 计划状态 */}
                    <div className="mt-4 flex items-center justify-between">
                      <div className="text-sm">
                        <span className="text-text-tertiary">{t("landing.user.plan")}</span>
                        <span className="font-semibold text-text-primary">
                          {credits?.plan_tier ? (credits.plan_tier === "free" ? t("landing.user.freePlan") : credits.plan_tier) : t("landing.user.freePlan")}
                        </span>
                      </div>
                      <Link href="/pricing" onClick={() => setDropdownOpen(false)}>
                        <span className="inline-block text-[11px] px-3 py-1 rounded-full bg-gradient-to-r from-amber-100 to-purple-100 dark:from-amber-500/20 dark:to-purple-500/20 text-text-primary font-medium border border-transparent hover:opacity-80 transition-opacity cursor-pointer">
                          {t("landing.user.upgrade")}
                        </span>
                      </Link>
                    </div>

                    {/* 积分卡片 */}
                    <div className="mt-3 rounded-xl bg-purple-50/60 dark:bg-purple-500/[0.07] p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Zap className="w-3.5 h-3.5 text-teal-500" />
                          <span className="text-xs font-semibold text-text-primary">{t("landing.credits.basic")}</span>
                        </div>
                        <span className="text-xs font-mono text-text-primary">{(credits?.basic_credits_display ?? credits?.basic_credits ?? 0) / 100}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                          <span className="text-xs font-semibold text-text-primary">{t("landing.credits.advanced")}</span>
                        </div>
                        <span className="text-xs font-mono text-text-primary">{(credits?.advanced_credits_display ?? credits?.advanced_credits ?? 0) / 100}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Crown className="w-3.5 h-3.5 text-orange-500" />
                          <span className="text-xs font-semibold text-text-primary">{t("landing.credits.elite")}</span>
                        </div>
                        <span className="text-xs font-mono text-text-primary">{(credits?.elite_credits_display ?? credits?.elite_credits ?? 0) / 100}</span>
                      </div>
                    </div>

                    {/* 菜单项 */}
                    <div className="mt-3 space-y-0.5">
                      <Link href="/settings" onClick={() => setDropdownOpen(false)} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-card text-sm text-text-secondary hover:text-text-primary transition-colors">
                        <span>{t("landing.user.accountBilling")}</span>
                        <ChevronRight className="w-4 h-4 text-text-tertiary" />
                      </Link>
                      <Link href="/share" onClick={() => setDropdownOpen(false)} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-card text-sm text-text-secondary hover:text-text-primary transition-colors">
                        <span>{t("landing.user.sharedLinks")}</span>
                        <ChevronRight className="w-4 h-4 text-text-tertiary" />
                      </Link>
                      <button className="flex items-center justify-between w-full px-3 py-2 rounded-lg hover:bg-surface-card text-sm text-text-secondary hover:text-text-primary transition-colors">
                        <span>{t("landing.user.invite")}</span>
                        <ChevronRight className="w-4 h-4 text-text-tertiary" />
                      </button>
                    </div>

                    {/* divider + logout */}
                    <div className="mt-2 pt-2 border-t border-surface-border">
                      <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        {t("landing.user.logout")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <button
                  onClick={showLoginModal}
                  className="text-sm text-text-secondary hover:text-text-primary transition-colors px-3 py-2"
                >
                  {t("landing.nav.login")}
                </button>
                <AuthAwareButton
                  variant="primary"
                  className="!px-4 !py-2 !rounded-xl !shadow-brand/20 !text-sm"
                  icon={<MessageSquare className="w-4 h-4" />}
                >
                  {t("landing.nav.startChat")}
                </AuthAwareButton>
              </>
            )}
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-card transition-colors"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-surface/95 backdrop-blur-xl border-b border-surface-border">
          <div className="px-4 py-4 space-y-3">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="block text-sm text-text-secondary hover:text-text-primary py-2 transition-colors"
              >
                {t(link.labelKey)}
              </a>
            ))}
            <div className="pt-3 border-t border-surface-border space-y-2">
              {user ? (
                <>
                  <div className="flex items-center gap-3 px-3 py-2">
                    <div className="w-9 h-9 rounded-full overflow-hidden border border-surface-border bg-surface-card shrink-0">
                      {avatarEl(36, "text-xs")}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary truncate">{user?.name || t("landing.user.default")}</p>
                      <p className="text-xs text-text-tertiary truncate">{user?.email || ""}</p>
                    </div>
                  </div>

                  {/* 移动端：计划 + 积分 */}
                  <div className="px-3 py-2 rounded-xl bg-purple-50/60 dark:bg-purple-500/[0.07] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-tertiary">{t("landing.user.plan")}<span className="text-text-primary font-medium">{credits?.plan_tier ? (credits.plan_tier === "free" ? t("landing.user.freePlan") : credits.plan_tier) : t("landing.user.freePlan")}</span></span>
                      <Link href="/pricing" onClick={() => setMobileOpen(false)} className="text-[11px] px-2.5 py-0.5 rounded-full bg-gradient-to-r from-amber-100 to-purple-100 dark:from-amber-500/20 dark:to-purple-500/20 text-text-primary font-medium">
                        {t("landing.user.upgrade")}
                      </Link>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Zap className="w-3 h-3 text-teal-500" />
                        <span className="text-xs text-text-secondary">{t("landing.credits.basic")}</span>
                      </div>
                      <span className="text-xs font-mono text-text-primary">{(credits?.basic_credits_display ?? credits?.basic_credits ?? 0) / 100}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                          <span className="text-xs text-text-secondary">{t("landing.credits.advanced")}</span>
                        </div>
                        <span className="text-xs font-mono text-text-primary">{(credits?.advanced_credits_display ?? credits?.advanced_credits ?? 0) / 100}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Crown className="w-3.5 h-3.5 text-orange-500" />
                          <span className="text-xs text-text-secondary">{t("landing.credits.elite")}</span>
                        </div>
                        <span className="text-xs font-mono text-text-primary">{(credits?.elite_credits_display ?? credits?.elite_credits ?? 0) / 100}</span>
                    </div>
                  </div>

                  <Link href="/settings" onClick={() => setMobileOpen(false)} className="flex items-center justify-between px-3 py-2 rounded-xl text-sm text-text-secondary hover:bg-surface-card transition-colors">
                    <span>{t("landing.user.accountBilling")}</span>
                    <ChevronRight className="w-4 h-4 text-text-tertiary" />
                  </Link>
                  <Link href="/share" onClick={() => setMobileOpen(false)} className="flex items-center justify-between px-3 py-2 rounded-xl text-sm text-text-secondary hover:bg-surface-card transition-colors">
                    <span>{t("landing.user.sharedLinks")}</span>
                    <ChevronRight className="w-4 h-4 text-text-tertiary" />
                  </Link>

                  <button
                    onClick={() => { handleLogout(); setMobileOpen(false); }}
                    className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    {t("landing.user.logout")}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => { setMobileOpen(false); showLoginModal(); }}
                    className="block w-full text-left text-sm text-text-secondary hover:text-text-primary py-2"
                  >
                    {t("landing.nav.login")}
                  </button>
                  <AuthAwareButton
                    variant="primary"
                    className="!w-full !py-2.5 !rounded-xl"
                    icon={<MessageSquare className="w-4 h-4" />}
                  >
                    {t("landing.nav.startChat")}
                  </AuthAwareButton>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
