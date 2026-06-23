"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

function isLikelyAlipay() {
  if (typeof navigator === "undefined") return false;
  return /AlipayClient/i.test(navigator.userAgent);
}

function AlipayMobilePaymentContent() {
  const searchParams = useSearchParams();
  const orderNo = searchParams?.get("order_no") || "";
  const [countdown, setCountdown] = useState(2);
  const authURL = useMemo(() => (orderNo ? `/api/payments/fubei/alipay/auth?order_no=${encodeURIComponent(orderNo)}` : ""), [orderNo]);
  const inAlipay = isLikelyAlipay();

  useEffect(() => {
    if (!orderNo || !authURL) return;
    const timer = window.setInterval(() => setCountdown((v) => Math.max(0, v - 1)), 1000);
    const jump = window.setTimeout(() => {
      window.location.href = authURL;
    }, 1200);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(jump);
    };
  }, [orderNo, authURL]);

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-5">
      <div className="w-full max-w-sm rounded-3xl border border-surface-border bg-surface-elevated p-6 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1677ff]/10 text-[#1677ff] text-xl font-bold">支</div>
        <h1 className="text-lg font-semibold text-text-primary">AI Space 支付宝支付</h1>
        {orderNo ? (
          <>
            <p className="mt-2 text-xs text-text-tertiary break-all">订单号：{orderNo}</p>
            <div className="mt-6 flex items-center justify-center gap-2 text-sm text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在进入支付宝授权与支付
            </div>
            {!inAlipay && (
              <p className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                建议使用支付宝扫码打开本页面；如果当前浏览器无法拉起支付，请复制链接到支付宝中打开。
              </p>
            )}
            <a href={authURL} className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-[#1677ff] px-4 py-3 text-sm font-medium text-white">
              {countdown > 0 ? `${countdown} 秒后自动继续` : "继续支付"}
            </a>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-text-secondary">缺少订单号，请回到 AI Space 重新创建支付订单。</p>
            <Link href="/pricing" className="mt-5 inline-flex rounded-xl bg-surface-card border border-surface-border px-4 py-2 text-sm text-text-primary">
              返回会员套餐页
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function AlipayMobilePaymentPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface flex items-center justify-center text-sm text-text-secondary">正在加载支付页...</div>}>
      <AlipayMobilePaymentContent />
    </Suspense>
  );
}
