"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import AppSidebar from "@/components/sidebar/AppSidebar";
import ChatWrapper from "@/components/chat/ChatWrapper";
import MobileNav from "@/components/mobile/MobileNav";
import LoginModal from "@/components/auth/LoginModal";

function useAuth() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  const check = useCallback(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    setIsLoggedIn(!!token);
  }, []);

  useEffect(() => {
    check();
    const handler = () => check();
    window.addEventListener("auth-changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("auth-changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, [check]);

  return { isLoggedIn, check };
}

export default function ChatPage() {
  const router = useRouter();
  const { t } = useI18n();
  const { isLoggedIn, check } = useAuth();
  const [showLogin, setShowLogin] = useState(false);

  // 检测登录状态
  // useEffect(() => {
  //   if (isLoggedIn === false) {
  //     // 直接访问 /chat 未登录时，跳转到首页
  //     router.replace("/");
  //   }
  // }, [isLoggedIn, router]);

  // 未加载完成时显示占位
  if (isLoggedIn === null) {
    return (
      <div className="flex flex-col h-screen bg-surface items-center justify-center">
        <div className="w-10 h-10 rounded-xl bg-surface-card border border-surface-border flex items-center justify-center animate-pulse">
          <span className="text-sm font-bold text-text-primary">AI</span>
        </div>
        <p className="text-sm text-text-secondary mt-3">{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-surface-elevated overflow-hidden">
      {/* 移动端导航栏 */}
      <MobileNav />

      {/* 主区域：侧边栏 + 聊天 */}
      <div className="flex flex-1 min-h-0">
        <div className="hidden md:block shrink-0">
          <AppSidebar />
        </div>
        <main className="flex-1 min-w-0 overflow-hidden bg-surface shadow-lg shadow-black/5">
          <ChatWrapper />
        </main>
      </div>
    </div>
  );
}
