"use client";

import Link from "next/link";
import { Github, MessageSquare } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";

export default function LandingFooter() {
  const themeCtx = useTheme();
  const theme = themeCtx?.theme || "light";
  return (
    <footer className="border-t border-surface-border bg-surface-elevated/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href="/" className="flex items-center gap-2.5 mb-3">
              <img src={theme === "dark" ? "/brand-dark-logo.png" : "/brand-light-logo.png"} alt="AI Space" className="w-8 h-8 rounded-xl object-cover" />
              <img src={theme === "dark" ? "/brand-dark-title.png" : "/brand-light-title.png"} alt="AI Space" className="h-6 w-auto object-contain" />
            </Link>
            <p className="text-sm text-text-secondary leading-relaxed">
              AI 聚合平台，让每个人都能便捷地使用全球最好的 AI 模型。
            </p>
          </div>

          {/* Links */}
          <div>
            <h4 className="text-sm font-semibold text-text-primary mb-3">功能</h4>
            <ul className="space-y-2">
              {[
                { label: "AI 聊天", href: "/chat" },
                { label: "AI 画图", href: "/image" },
                { label: "AI PPT", href: "/ppt" },
                { label: "AI 技能", href: "/skills" },
              ].map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-text-secondary hover:text-text-primary transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-text-primary mb-3">关于</h4>
            <ul className="space-y-2">
              {[
                { label: "产品介绍", href: "#features" },
                { label: "模型列表", href: "#models" },
                { label: "数据统计", href: "#stats" },
              ].map((l) => (
                <li key={l.label}>
                  <a href={l.href} className="text-sm text-text-secondary hover:text-text-primary transition-colors">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-text-primary mb-3">联系</h4>
            <div className="flex gap-3">
              <a href="#" className="w-9 h-9 rounded-lg bg-surface-card border border-surface-border flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors">
                <Github className="w-4 h-4" />
              </a>
              <a href="#" className="w-9 h-9 rounded-lg bg-surface-card border border-surface-border flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors">
                <MessageSquare className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-surface-border flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-text-tertiary">
            &copy; {new Date().getFullYear()} AI Space. All rights reserved.
          </p>
          <div className="flex gap-4">
            <a href="#" className="text-xs text-text-tertiary hover:text-text-secondary transition-colors">隐私政策</a>
            <a href="#" className="text-xs text-text-tertiary hover:text-text-secondary transition-colors">服务条款</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
