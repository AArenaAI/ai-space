"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MessageSquare, Menu, X } from "lucide-react";
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

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
