"use client";

import { useEffect } from "react";

export default function AuthInterceptor() {
  useEffect(() => {
    // 只在客户端执行
    if (typeof window === "undefined") return;

    const originalFetch = window.fetch;
    let redirecting = false;

    window.fetch = async function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const res = await originalFetch(input, init);

      // 检测 API 401 并且当前不在登录页
      if (
        res.status === 401 &&
        !redirecting &&
        typeof input === "string" &&
        input.startsWith("/api/") &&
        !window.location.pathname.startsWith("/login") &&
        !window.location.pathname.startsWith("/register")
      ) {
        redirecting = true;
        // 清除认证状态
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        // 跳转登录页，带上回来地址
        const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?returnUrl=${returnUrl}`;
      }

      return res;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
