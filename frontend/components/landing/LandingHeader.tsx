"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MessageSquare, Menu, X, LogOut, User } from "lucide-react";
import { cn } from "@/lib/utils";
import AuthAwareButton, { showLoginModal } from "./AuthAwareButton";
import { useTheme } from "@/components/theme/ThemeProvider";

const navLinks = [
  { label: "功能", href: "#features" },
  { label: "演示", href: "#demo" },
  { label: "关于", href: "#stats" },
  { label: "价格", href: "/pricing" },
];

export default function LandingHeader() {
  const themeCtx = useTheme();
  const theme = themeCtx?.theme || "light";
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
      <div className={cn("w-full h-full flex items-center justify-center bg-brand/10 text-brand font-bold", textSize)}>
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
                {link.label}
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
                  <div className="absolute right-0 top-full mt-2 w-64 rounded-2xl border border-surface-border bg-surface-elevated shadow-xl p-4 z-50 animate-fade-in">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full overflow-hidden border border-surface-border bg-surface-card shrink-0">
                        {avatarEl(40, "text-sm")}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-text-primary truncate">{user?.name || "用户"}</p>
                        <p className="text-xs text-text-tertiary truncate">{user?.email || ""}</p>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-surface-border">
                      <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        退出登录
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
                  登录
                </button>
                <AuthAwareButton
                  variant="primary"
                  className="!px-4 !py-2 !rounded-xl !shadow-brand/20 !text-sm"
                  icon={<MessageSquare className="w-4 h-4" />}
                >
                  开始聊天
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
                {link.label}
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
                      <p className="text-sm font-medium text-text-primary truncate">{user?.name || "用户"}</p>
                      <p className="text-xs text-text-tertiary truncate">{user?.email || ""}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => { handleLogout(); setMobileOpen(false); }}
                    className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    退出登录
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => { setMobileOpen(false); showLoginModal(); }}
                    className="block w-full text-left text-sm text-text-secondary hover:text-text-primary py-2"
                  >
                    登录
                  </button>
                  <AuthAwareButton
                    variant="primary"
                    className="!w-full !py-2.5 !rounded-xl"
                    icon={<MessageSquare className="w-4 h-4" />}
                  >
                    开始聊天
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
