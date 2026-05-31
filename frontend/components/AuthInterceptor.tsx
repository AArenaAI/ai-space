"use client";

import { useEffect } from "react";
import { getGuestId, clearGuestId } from "@/lib/guestId";
import { normalizeError } from "@/lib/errors";
import { toast } from "sonner";

export default function AuthInterceptor() {
  useEffect(() => {
    // 只在客户端执行
    if (typeof window === "undefined") return;

    // 初始化 guest ID（如果已登录则清除）
    const token = localStorage.getItem("token");
    if (token) {
      clearGuestId();
    } else {
      getGuestId(); // 保证存在
    }

    const originalFetch = window.fetch;
    let redirecting = false;
    let lastToastKey = "";
    let lastToastAt = 0;
    const shouldToastOnce = (key: string) => {
      const now = Date.now();
      if (lastToastKey === key && now - lastToastAt < 2500) return false;
      lastToastKey = key;
      lastToastAt = now;
      return true;
    };

    window.fetch = async function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const url = typeof input === "string" ? input : input.toString();
      const isApi = url.startsWith("/api/") || url.startsWith(window.location.origin + "/api/");

      // 给本域 API 请求自动添加 X-Guest-ID
      if (isApi) {
        const headers = new Headers(init?.headers);
        const hasAuth = headers.has("Authorization") || (init?.headers as Record<string, string>)?.["Authorization"];
        // 只有在未携带 Authorization 时才发送 guest ID（避免已登录用户被误识别为匿名）
        if (!hasAuth) {
          const guestId = getGuestId();
          if (guestId) {
            headers.set("X-Guest-ID", guestId);
          }
        }
        init = { ...init, headers };
      }

      const res = await originalFetch(input, init);

      // 检测 API 401 并且当前不在登录页
      // if (
      //   res.status === 401 &&
      //   !redirecting &&
      //   typeof input === "string" &&
      //   input.startsWith("/api/") &&
      //   !window.location.pathname.startsWith("/login") &&
      //   !window.location.pathname.startsWith("/register")
      // ) {
      //   redirecting = true;
      //   // 清除认证状态
      //   localStorage.removeItem("token");
      //   localStorage.removeItem("user");
      //   // 跳转登录页，带上回来地址
      //   const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
      //   window.location.href = `/login?returnUrl=${returnUrl}`;
      // }

      // 只全局处理跨模块通用错误，业务错误交给具体页面，避免重复 toast。
      if (isApi && [400, 401, 403, 409, 429].includes(res.status)) {
        try {
          const clone = res.clone();
          const data = await clone.json();
          if (data && typeof data === "object") {
            const code = String((data as any).error || (data as any).code || "");
            const handledGlobalCodes = new Set(["guest_id_required", "guest_limit_exceeded", "file_not_ready", "login_required"]);
            if (handledGlobalCodes.has(code) && shouldToastOnce(`${code}:${res.status}`)) {
              const userError = normalizeError(data, { httpStatus: res.status });
              if (userError.severity === "info") toast.info(userError.message, { description: userError.title, duration: 4200 });
              else if (userError.severity === "warning") toast.warning(userError.message, { description: userError.title, duration: 4200 });
              else toast.error(userError.message, { description: userError.title, duration: 4200 });
            }
          }
        } catch {
          // 非 JSON 响应，忽略
        }
      }

      return res;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
