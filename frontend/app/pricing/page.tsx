"use client";

import Link from "next/link";
import {
  Check,
  ChevronDown,
  FileText,
  Flame,
  ImageIcon,
  Infinity,
  Languages,
  Loader2,
  Mic,
  Minus,
  PenLine,
  Sparkles,
  Star,
  Video,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

type TierKey = "basic" | "advanced";
type TierModel = { id: string; name: string; provider?: string; tier?: TierKey };

type PaymentModalState = {
  orderNo: string;
  planName: string;
  amountDisplay: number;
  qrDataUrl: string;
  status: string;
};

type Plan = {
  id: "basic" | "plus" | "ultra";
  name: string;
  tagline: string;
  price: string;
  priceNote: string;
  yearlyNote?: string;
  icon: any;
  badge?: string;
  current?: boolean;
  popular?: boolean;
  credits: { basic: string; advanced: string };
  models: string[];
  work: Array<{ label: string; enabled: boolean }>;
  creation: Array<{ label: string; enabled: boolean }>;
  service: Array<{ label: string; enabled: boolean }>;
  benefitGroups: Array<{ title: string; note?: string; items: Array<{ label: string; enabled?: boolean }> }>;
  cta: string;
};

const modelChips = ["GPT-5.5", "Claude", "Gemini", "DeepSeek", "Kimi", "Seedance", "Seedream"];

const plans: Plan[] = [
  {
    id: "basic",
    name: "Basic",
    tagline: "适合日常问答与轻量工作",
    price: "内测价",
    priceNote: "以订单确认金额为准",
    yearlyNote: "年付优惠开放中",
    icon: Flame,
    badge: "入门",
    credits: { basic: "100", advanced: "25" },
    models: ["GPT Mini", "Gemini Flash", "DeepSeek Flash", "更多..."],
    work: [
      { label: "基础与部分高级模型", enabled: true },
      { label: "写作助手 / 翻译", enabled: true },
      { label: "文档阅读", enabled: true },
    ],
    creation: [
      { label: "图像生成", enabled: true },
      { label: "视频生成", enabled: false },
      { label: "AI 漫剧 Studio", enabled: false },
    ],
    service: [
      { label: "无广告体验", enabled: true },
      { label: "标准速度", enabled: true },
    ],
    benefitGroups: [
      { title: "100 基础积分 / 月", items: [{ label: "GPT Mini" }, { label: "Gemini Flash" }, { label: "DeepSeek Flash" }, { label: "Kimi 轻量模型" }, { label: "更多基础模型..." }] },
      { title: "25 高级积分 / 月", items: [{ label: "GPT 5.5 轻量使用" }, { label: "Gemini Pro 轻量使用" }, { label: "DeepSeek Pro 轻量使用" }, { label: "高级模型按实际消耗扣除" }] },
      { title: "AI 工作", items: [{ label: "多模型聊天" }, { label: "写作助手" }, { label: "文本翻译" }, { label: "文档阅读器" }, { label: "PDF / Word / PPT 摘要" }, { label: "基础联网搜索" }] },
      { title: "图像和视频生成", items: [{ label: "图像生成" }, { label: "参考图生成" }, { label: "基础图像编辑" }, { label: "视频生成", enabled: false }, { label: "AI 漫剧 Studio", enabled: false }] },
      { title: "高级功能", items: [{ label: "ChatPDF" }, { label: "AI PDF / 图片 / 网页翻译器" }, { label: "AI 图片生成 / 编辑器" }, { label: "思考模式" }, { label: "Artifacts" }, { label: "音频转文本", enabled: false }, { label: "允许商业使用", enabled: false }] },
      { title: "支持", items: [{ label: "网页端使用" }, { label: "标准速度队列" }, { label: "无广告体验" }] },
    ],
    cta: "选择 Basic",
  },
  {
    id: "plus",
    name: "Plus",
    tagline: "最适合高频创作与日常 AI 工作",
    price: "内测价",
    priceNote: "以订单确认金额为准",
    yearlyNote: "最推荐 · 年付更划算",
    icon: Star,
    badge: "最推荐",
    popular: true,
    credits: { basic: "300", advanced: "100" },
    models: ["GPT-5.5", "Gemini Pro", "DeepSeek Pro", "Kimi", "更多..."],
    work: [
      { label: "高级模型优先使用", enabled: true },
      { label: "文档阅读 / 多语言翻译", enabled: true },
      { label: "实时语音翻译", enabled: true },
    ],
    creation: [
      { label: "图像生成 / 图像编辑", enabled: true },
      { label: "视频生成", enabled: true },
      { label: "AI 漫剧 Studio", enabled: true },
    ],
    service: [
      { label: "优先速度", enabled: true },
      { label: "商用使用", enabled: true },
    ],
    benefitGroups: [
      { title: "300 基础积分 / 月", items: [{ label: "GPT Mini" }, { label: "Gemini Flash" }, { label: "DeepSeek Flash" }, { label: "Kimi 轻量模型" }, { label: "更多基础模型..." }] },
      { title: "100 高级积分 / 月", note: "适合日常高频创作与复杂模型调用。", items: [{ label: "GPT 5.5" }, { label: "GPT 5.5 Pro" }, { label: "Gemini Pro" }, { label: "DeepSeek Pro" }, { label: "Kimi K2.5 / K2.6" }, { label: "更多高级模型..." }] },
      { title: "精英能力", items: [{ label: "Deep Research" }, { label: "Scholar Research" }, { label: "AI PPT" }, { label: "网站生成器" }, { label: "复杂文档分析" }] },
      { title: "图像和视频生成", items: [{ label: "图像生成" }, { label: "参考图生成" }, { label: "图像编辑工具" }, { label: "去背景 / 换背景" }, { label: "文字移除 / 局部重绘" }, { label: "Seedance 视频生成" }, { label: "分段成片" }, { label: "更多..." }] },
      { title: "高级功能", items: [{ label: "YouTube 总结" }, { label: "AI 创意工作室" }, { label: "AI 图片生成 / 编辑器" }, { label: "ChatPDF" }, { label: "AI PDF / 图片 / 网页翻译器" }, { label: "AI 朗读" }, { label: "数据分析" }, { label: "思考模式" }, { label: "Artifacts" }, { label: "智能联网" }, { label: "人工智能作家" }, { label: "音频转文本" }, { label: "允许商业使用" }] },
      { title: "支持", items: [{ label: "优先速度队列" }, { label: "多设备登录" }, { label: "商用使用" }, { label: "会员额度自动发放" }] },
    ],
    cta: "升级 Plus",
  },
  {
    id: "ultra",
    name: "Ultra",
    tagline: "专业重度用户与高频生产",
    price: "内测价",
    priceNote: "以订单确认金额为准",
    yearlyNote: "专业额度包",
    icon: Infinity,
    badge: "专业",
    credits: { basic: "∞", advanced: "260" },
    models: ["全部基础模型", "全部高级模型", "高负载任务", "更多..."],
    work: [
      { label: "全模型访问", enabled: true },
      { label: "复杂文档与长任务", enabled: true },
      { label: "实时语音翻译", enabled: true },
    ],
    creation: [
      { label: "图像生成 / 编辑", enabled: true },
      { label: "视频生成", enabled: true },
      { label: "AI 漫剧 Studio", enabled: true },
    ],
    service: [
      { label: "最快速度", enabled: true },
      { label: "商用使用", enabled: true },
    ],
    benefitGroups: [
      { title: "无限基础积分 / 月", items: [{ label: "全部基础模型" }, { label: "GPT Mini" }, { label: "Gemini Flash" }, { label: "DeepSeek Flash" }, { label: "Kimi 轻量模型" }, { label: "更多基础模型..." }] },
      { title: "260 高级积分 / 月", note: "面向重度模型调用、长文档和高频生产。", items: [{ label: "GPT 5.5" }, { label: "GPT 5.5 Pro" }, { label: "Gemini Pro" }, { label: "DeepSeek Pro" }, { label: "Kimi K2.7 Code" }, { label: "所有高级模型" }] },
      { title: "精英能力", items: [{ label: "Deep Research" }, { label: "Scholar Research" }, { label: "AI PPT" }, { label: "网站生成器" }, { label: "长任务与复杂推理" }, { label: "批量生产工作流" }] },
      { title: "图像和视频生成", items: [{ label: "GPT Image / 高级图像生成" }, { label: "参考图生成" }, { label: "图像编辑工具" }, { label: "去背景 / 换背景" }, { label: "文字移除 / 局部重绘" }, { label: "Seedance 视频生成" }, { label: "高频分段成片" }, { label: "AI 漫剧 Studio" }, { label: "资产 / 分镜 / 视频链路" }, { label: "更多..." }] },
      { title: "高级功能", items: [{ label: "YouTube 总结" }, { label: "AI 创意工作室" }, { label: "AI 图片生成 / 编辑器" }, { label: "ChatPDF" }, { label: "多文档分析" }, { label: "AI PDF / 图片 / 网页翻译器" }, { label: "AI 朗读" }, { label: "数据分析" }, { label: "思考模式" }, { label: "Artifacts" }, { label: "智能联网" }, { label: "人工智能作家" }, { label: "音频转文本" }, { label: "允许商业使用" }] },
      { title: "支持", items: [{ label: "最快速度队列" }, { label: "更多设备登录" }, { label: "商用使用" }, { label: "专业额度包" }, { label: "优先体验新模型" }] },
    ],
    cta: "选择 Ultra",
  },
];

const fallbackTierModels: Record<TierKey, TierModel[]> = {
  basic: [
    { id: "gpt-5.4-mini", name: "GPT 5.4 Mini" },
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
    { id: "deepseek-v4-flash", name: "DeepSeek-V4 Flash" },
    { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash" },
  ],
  advanced: [
    { id: "gpt-5.4", name: "GPT 5.4" },
    { id: "gpt-5.5", name: "GPT 5.5" },
    { id: "gpt-5.5-pro", name: "GPT 5.5 Pro" },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "deepseek-v4-pro", name: "DeepSeek-V4 Pro" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
  ],
};

const advancedFeatureGroups = [
  {
    title: "AI 工作",
    subtitle: "面向日常办公、资料处理与跨语言协作",
    items: [
      { icon: PenLine, name: "写作助手", desc: "文章、邮件、方案与长文改写" },
      { icon: Languages, name: "文本翻译", desc: "多语言文本翻译与润色" },
      { icon: Mic, name: "实时语音翻译", desc: "会议与对话场景实时转译" },
      { icon: FileText, name: "文档阅读器", desc: "PDF / Word / PPT 资料阅读、摘要与问答" },
    ],
  },
  {
    title: "AI 创作",
    subtitle: "面向图像、视频、漫剧与视觉编辑工作流",
    items: [
      { icon: ImageIcon, name: "图像生成", desc: "文生图、参考图与创意视觉生成" },
      { icon: Video, name: "视频生成", desc: "Seedance 视频生成与分段成片" },
      { icon: Sparkles, name: "漫剧 Studio", desc: "剧情、资产、分镜、视频一体化生产" },
      { icon: Wand2, name: "图像编辑工具", desc: "去背景、换背景、文字移除、放大与局部重绘" },
    ],
  },
];

const comparisonGroups = [
  {
    title: "AI 模型",
    rows: [
      ["GPT 系列", "支持", "支持"],
      ["Claude / Gemini / DeepSeek / Kimi", "支持", "不支持"],
      ["多模型统一入口", "支持", "不支持"],
      ["模型对比回答", "支持", "不支持"],
    ],
  },
  {
    title: "文档与翻译",
    rows: [
      ["文档阅读器", "支持", "部分支持"],
      ["文本翻译", "支持", "支持"],
      ["实时语音翻译", "支持", "不支持"],
      ["PDF / Word / PPT 资料问答", "支持", "部分支持"],
    ],
  },
  {
    title: "AI 创作",
    rows: [
      ["图像生成 / 编辑", "支持", "部分支持"],
      ["视频生成", "支持", "不支持"],
      ["AI 漫剧 Studio", "支持", "不支持"],
      ["分镜 / 资产 / 视频链路", "支持", "不支持"],
    ],
  },
];

const faqs = [
  ["基础额度和高级额度有什么区别？", "基础额度面向轻量模型和日常问答；高级额度面向更强模型、复杂推理和创作任务。不同模型会按实际消耗扣除对应额度。"],
  ["会员额度和内测额度是否互通？", "不互通。内测额度是独立钱包，用于 beta 测试；正式会员额度按会员套餐发放和消耗。"],
  ["图像和视频生成如何扣费？", "图像、视频和高级创作能力会按所选模型、任务类型和生成成本扣除额度，页面会逐步补充更详细的消耗说明。"],
  ["支付后多久开通？", "支付宝扫码支付成功后，系统会通过订单轮询和回调自动开通会员；如果页面未刷新，可重新进入账户或定价页查看状态。"],
  ["支持退款或发票吗？", "正式付费开放后会补充退款、发票和订单管理规则。内测阶段如遇支付问题，请联系管理员处理。"],
  ["后续新增模型会包含在会员里吗？", "AI Space 会持续接入新模型。新增模型会按成本归入基础、高级或更高等级额度池，具体以页面展示为准。"],
];

function FeatureLine({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className={`flex items-start gap-2 text-[12px] ${enabled ? "text-[#111827]" : "text-[#a1a1aa]"}`}>
      {enabled ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span>{label}</span>
    </div>
  );
}

function CompareValue({ value }: { value: string }) {
  if (value === "支持") return <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[#111827] px-2 text-[11px] font-medium text-white">✓</span>;
  if (value === "部分支持") return <span className="text-xs font-medium text-[#71717a]">部分支持</span>;
  return <span className="text-xs text-[#a1a1aa]">—</span>;
}

export default function PricingPage() {
  const [tierModels, setTierModels] = useState<Record<TierKey, TierModel[]>>(fallbackTierModels);
  const [payment, setPayment] = useState<PaymentModalState | null>(null);
  const [paymentLoadingPlan, setPaymentLoadingPlan] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState("");
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/models/tiers")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        const incoming = data?.tier_models;
        if (!incoming || cancelled) return;
        setTierModels({
          basic: Array.isArray(incoming.basic) && incoming.basic.length ? incoming.basic : fallbackTierModels.basic,
          advanced: Array.isArray(incoming.advanced) && incoming.advanced.length ? incoming.advanced : fallbackTierModels.advanced,
        });
      })
      .catch(() => {
        if (!cancelled) setTierModels(fallbackTierModels);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!payment?.orderNo || payment.status === "paid") return;
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : "";
    if (!token) return;
    const timer = window.setInterval(() => {
      fetch(`/api/payments/orders/${encodeURIComponent(payment.orderNo)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data?.status) return;
          setPayment((prev) => (prev && prev.orderNo === payment.orderNo ? { ...prev, status: data.status } : prev));
          if (data.status === "paid") window.dispatchEvent(new Event("auth-changed"));
        })
        .catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [payment?.orderNo, payment?.status]);

  async function startAlipayCheckout(plan: Plan) {
    setPaymentError("");
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : "";
    if (!token) {
      window.location.href = `/login?returnUrl=${encodeURIComponent("/pricing")}`;
      return;
    }
    setPaymentLoadingPlan(plan.id);
    try {
      const res = await fetch("/api/payments/fubei/alipay/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan_code: plan.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "创建支付订单失败");
      const qrDataUrl = await QRCode.toDataURL(data.mobile_pay_url, {
        margin: 1,
        width: 240,
        color: { dark: "#0b0b0c", light: "#ffffff" },
      });
      setPayment({
        orderNo: data.order_no,
        planName: data.plan_name || plan.id,
        amountDisplay: data.amount_display || data.amount_cents / 100,
        qrDataUrl,
        status: data.status || "pending",
      });
    } catch (err: any) {
      setPaymentError(err?.message || "创建支付订单失败");
    } finally {
      setPaymentLoadingPlan(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f7f8] text-[#111827]">
      <nav className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[#e5e7eb] bg-white/90 px-6 backdrop-blur">
        <Link href="/chat" className="text-sm font-semibold tracking-tight hover:text-[#374151]">← 返回 AI Space</Link>
        <div className="hidden items-center gap-6 text-sm text-[#71717a] md:flex">
          <a href="#plans" className="hover:text-[#111827]">套餐</a>
          <a href="#features" className="hover:text-[#111827]">功能</a>
          <a href="#compare" className="hover:text-[#111827]">对比</a>
          <a href="#faq" className="hover:text-[#111827]">FAQ</a>
        </div>
        <span className="text-xs text-[#9ca3af]">Pricing</span>
      </nav>

      <main className="mx-auto max-w-7xl px-5 py-12 md:px-8">
        <section className="mx-auto max-w-4xl text-center">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-[#374151] shadow-sm ring-1 ring-[#e5e7eb]">
            <Sparkles className="h-4 w-4" />
            多模型会员 · AI 工作台 · 创作工具
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-[-0.045em] md:text-6xl">一个会员，解锁主流 AI 模型与创作工具</h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-[#6b7280]">
            GPT、Claude、Gemini、DeepSeek、Kimi 等模型统一入口。会员额度可用于聊天、文档、翻译、图像、视频和 AI 漫剧创作。
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-2">
            {modelChips.map((model) => (
              <span key={model} className="rounded-full bg-white px-3.5 py-2 text-sm font-medium text-[#374151] ring-1 ring-[#e5e7eb]">{model}</span>
            ))}
          </div>
          <div className="mt-8 inline-flex rounded-full bg-white p-1.5 shadow-sm ring-1 ring-[#e5e7eb]">
            <button className="rounded-full bg-[#111827] px-5 py-2 text-sm font-semibold text-white">个人</button>
            <button className="rounded-full px-5 py-2 text-sm font-semibold text-[#71717a]">团队稍后开放</button>
          </div>
        </section>

        <section id="plans" className="mx-auto mt-14 grid max-w-6xl grid-cols-1 gap-6 md:grid-cols-3">
          {plans.map((plan) => {
            const Icon = plan.icon;
            const isPopular = !!plan.popular;
            return (
              <div key={plan.id} className={`relative flex flex-col rounded-[28px] border bg-white p-5 shadow-sm transition-all ${isPopular ? "border-[#111827] shadow-[0_24px_60px_rgba(15,23,42,0.16)]" : "border-[#e5e7eb] hover:border-[#cbd5e1]"}`}>
                {plan.badge && (
                  <div className={`absolute right-5 top-5 rounded-full px-3 py-1 text-xs font-semibold ${isPopular ? "bg-[#111827] text-white" : "bg-[#f1f2f4] text-[#374151]"}`}>{plan.badge}</div>
                )}
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#f5f6f8]"><Icon className="h-5 w-5" /></div>
                <div className="mt-5">
                  <h2 className="text-xl font-semibold tracking-[-0.03em]">{plan.name}</h2>
                  <p className="mt-1 min-h-10 text-sm leading-5 text-[#6b7280]">{plan.tagline}</p>
                </div>
                <div className="mt-5 border-t border-[#eef0f3] pt-5">
                  <div className="text-3xl font-semibold tracking-[-0.04em]">{plan.price}</div>
                  <div className="mt-1 text-xs text-[#9ca3af]">{plan.priceNote}</div>
                  {plan.yearlyNote && <div className="mt-3 inline-flex rounded-full bg-[#f1f2f4] px-3 py-1 text-xs font-medium text-[#374151]">{plan.yearlyNote}</div>}
                </div>

                <button
                  disabled={plan.current || paymentLoadingPlan === plan.id}
                  onClick={() => !plan.current && startAlipayCheckout(plan)}
                  className={`mt-5 flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold transition-colors ${plan.current ? "cursor-default bg-[#f1f2f4] text-[#9ca3af]" : isPopular ? "bg-[#111827] text-white hover:bg-[#374151]" : "border border-[#d1d5db] bg-white text-[#111827] hover:bg-[#f5f6f8]"}`}
                >
                  {paymentLoadingPlan === plan.id && <Loader2 className="h-4 w-4 animate-spin" />}
                  {paymentLoadingPlan === plan.id ? "创建订单中" : plan.cta}
                </button>

                <div className="mt-6 flex-1 border-t border-[#eef0f3] pt-5">
                  <div className="space-y-6 text-sm">
                    {plan.benefitGroups.map((group) => (
                      <div key={group.title}>
                        <div className="mb-2 py-1 text-sm font-semibold text-[#111827]">
                          {group.title}
                        </div>
                        {group.note && <p className="mb-2 text-[11px] leading-5 text-[#8a8f98]">{group.note}</p>}
                        <div className="space-y-2.5">
                          {group.items.map((item) => (
                            <FeatureLine key={item.label} label={item.label} enabled={item.enabled !== false} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </section>

        <section id="features" className="mt-12 rounded-[30px] border border-[#e5e7eb] bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#9ca3af]">Advanced features</div>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">会员额度覆盖整个 AI 工作台</h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-[#6b7280]">不只是模型对话，也覆盖侧边栏里的 AI 工作与 AI 创作入口。</p>
          </div>
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {advancedFeatureGroups.map((group) => (
              <div key={group.title} className="rounded-[24px] bg-[#f5f6f8] p-5">
                <div className="mb-4">
                  <div className="text-base font-semibold">{group.title}</div>
                  <p className="mt-1 text-sm text-[#6b7280]">{group.subtitle}</p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.name} className="rounded-2xl bg-white p-4 shadow-sm">
                        <div className="flex items-center gap-2"><Icon className="h-4 w-4" /><span className="text-sm font-semibold">{item.name}</span></div>
                        <p className="mt-2 text-xs leading-5 text-[#6b7280]">{item.desc}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8 rounded-[30px] border border-[#e5e7eb] bg-white p-6 shadow-sm md:p-8">
          <h2 className="text-xl font-semibold tracking-[-0.03em]">模型等级说明</h2>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-[22px] bg-[#f5f6f8] p-5">
              <div className="font-semibold">☕ 基础模型</div>
              <p className="mt-2 text-sm leading-6 text-[#6b7280]">{tierModels.basic.map((model) => model.name).join("、")}</p>
            </div>
            <div className="rounded-[22px] bg-[#f5f6f8] p-5">
              <div className="font-semibold">🔥 高级模型</div>
              <p className="mt-2 text-sm leading-6 text-[#6b7280]">{tierModels.advanced.map((model) => model.name).join("、")}</p>
            </div>
          </div>
        </section>

        <section id="compare" className="mt-12 rounded-[30px] border border-[#e5e7eb] bg-white p-6 shadow-sm md:p-8">
          <div className="text-center">
            <h2 className="text-3xl font-semibold tracking-[-0.04em]">完整功能比较</h2>
            <p className="mt-3 text-sm text-[#6b7280]">比较 AI Space Plus 与单一模型订阅的差异。</p>
          </div>
          <div className="mt-8 overflow-hidden rounded-[24px] border border-[#e5e7eb]">
            <div className="grid grid-cols-[1.2fr_0.9fr_0.9fr] bg-[#f5f6f8] px-4 py-4 text-sm font-semibold md:px-6">
              <div>功能项</div>
              <div className="text-center">AI Space Plus</div>
              <div className="text-center">ChatGPT Plus</div>
            </div>
            {comparisonGroups.map((group) => (
              <div key={group.title}>
                <div className="border-t border-[#e5e7eb] bg-white px-4 py-3 text-sm font-semibold md:px-6">{group.title}</div>
                {group.rows.map(([name, aiSpace, chatgpt]) => (
                  <div key={name} className="grid grid-cols-[1.2fr_0.9fr_0.9fr] items-center border-t border-[#eef0f3] px-4 py-3 text-sm md:px-6">
                    <div className="text-[#374151]">{name}</div>
                    <div className="text-center"><CompareValue value={aiSpace} /></div>
                    <div className="text-center"><CompareValue value={chatgpt} /></div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section id="faq" className="mx-auto mt-12 max-w-3xl">
          <div className="text-center">
            <h2 className="text-3xl font-semibold tracking-[-0.04em]">常见问题解答</h2>
            <p className="mt-3 text-sm leading-6 text-[#6b7280]">AI Space 致力于提供稳定、安全、透明的 AI 服务。请勿共享、转售或滥用账号额度。</p>
          </div>
          <div className="mt-7 overflow-hidden rounded-[26px] border border-[#e5e7eb] bg-white shadow-sm">
            {faqs.map(([q, a], idx) => {
              const open = openFaq === idx;
              return (
                <button key={q} onClick={() => setOpenFaq(open ? null : idx)} className="block w-full border-b border-[#eef0f3] px-5 py-4 text-left last:border-b-0">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-semibold">{q}</span>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-[#9ca3af] transition-transform ${open ? "rotate-180" : ""}`} />
                  </div>
                  {open && <p className="mt-3 text-sm leading-6 text-[#6b7280]">{a}</p>}
                </button>
              );
            })}
          </div>
        </section>
      </main>

      {payment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-[32px] bg-white p-6 text-center shadow-2xl">
            <button onClick={() => setPayment(null)} className="absolute right-4 top-4 rounded-full bg-[#f5f6f8] p-2 text-[#71717a] hover:text-[#111827]"><X className="h-5 w-5" /></button>
            <div className="mx-auto inline-flex rounded-full bg-[#eaf2ff] px-3 py-1 text-xs font-semibold text-[#1677ff]">支付宝 ALIPAY</div>
            <h2 className="mt-4 text-xl font-semibold tracking-[-0.03em]">确认订单</h2>
            <p className="mt-1 text-sm text-[#6b7280]">AI Space {payment.planName} 会员套餐</p>
            <div className="mt-4 text-4xl font-semibold tracking-[-0.05em]">¥{payment.amountDisplay.toFixed(2)}</div>
            <div className="mx-auto mt-5 flex h-[260px] w-[260px] items-center justify-center rounded-[24px] border border-[#e5e7eb] bg-white p-3">
              <img src={payment.qrDataUrl} alt="支付宝支付二维码" className="h-full w-full" />
            </div>
            <p className="mt-4 text-sm text-[#374151]">请使用手机支付宝扫码完成付款</p>
            <p className="mt-1 text-xs text-[#9ca3af]">订单号：{payment.orderNo} · 二维码有效期约 15 分钟</p>
            {payment.status === "paid" ? (
              <div className="mt-5 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">支付成功，会员已开通</div>
            ) : (
              <div className="mt-5 flex items-center justify-center gap-2 rounded-2xl bg-[#f5f6f8] px-4 py-3 text-sm text-[#6b7280]"><Loader2 className="h-4 w-4 animate-spin" />正在等待支付结果</div>
            )}
          </div>
        </div>
      )}

      {paymentError && !payment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[30px] bg-white p-6 text-center shadow-2xl">
            <h2 className="text-lg font-semibold tracking-[-0.03em]">暂时无法创建支付订单</h2>
            <p className="mt-3 text-sm leading-6 text-red-500">{paymentError}</p>
            <button onClick={() => setPaymentError("")} className="mt-5 w-full rounded-full bg-[#111827] px-4 py-3 text-sm font-semibold text-white hover:bg-[#374151]">我知道了</button>
          </div>
        </div>
      )}
    </div>
  );
}
