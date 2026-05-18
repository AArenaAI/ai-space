"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePPT, PPTConfig, FullSlide, PPTImageJob } from "@/hooks/usePPT";
import {
  Loader2,
  Wand2,
  ChevronRight,
  ChevronLeft,
  Download,
  RotateCcw,
  Image as ImageIcon,
  FileText,
  Check,
  Eye,
  Trash2,
  AlertCircle,
  Sparkles,
  SlidersHorizontal,
  LayoutTemplate,
  Users,
  Target,
  ImagePlus,
  Gauge,
  Zap,
  Crown,
  MessageSquareQuote,
  Send,
  Home,
  MoreHorizontal,
  Clock,
} from "lucide-react";

type Step = "topic" | "chat" | "config" | "outline" | "preview";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  type?: "text" | "options" | "outline_card" | "progress" | "ppt_card";
  options?: { label: string; value: string; field?: string }[];
  data?: any;
}

const SUGGESTIONS = [
  "AI 时代的教育变革",
  "2024 年终总结汇报",
  "产品发布会策划",
  "新能源行业分析",
  "团队工作汇报",
];

const PAGE_COUNT_OPTIONS = [5, 8, 10, 12, 15, 20];

const TEMPLATE_OPTIONS = [
  { id: "modern", name: "现代简约", color: "#3B82F6" },
  { id: "business", name: "商务专业", color: "#10B981" },
  { id: "creative", name: "创意活力", color: "#F59E0B" },
  { id: "tech", name: "科技未来", color: "#8B5CF6" },
  { id: "elegant", name: "高雅经典", color: "#EC4899" },
  { id: "minimal", name: "极简原本", color: "#6B7280" },
];

const AUDIENCE_OPTIONS = [
  "企业管理层",
  "学生/教育",
  "投资人",
  "客户/合作伙伴",
  "技术团队",
  "公众/消费者",
];

const PURPOSE_OPTIONS = [
  "工作汇报",
  "项目宣讲",
  "客户提案",
  "培训讲座",
  "市场分析",
  "产品介绍",
];

const IMAGE_OPTIONS = [
  { value: "none", label: "不生成图片" },
  { value: "cover", label: "仅封面" },
  { value: "key_slides", label: "关键页配图" },
  { value: "all", label: "全部配图" },
];

const QUALITY_OPTIONS = [
  { value: "fast", label: "快速", icon: Zap, desc: "几分钟完成" },
  { value: "standard", label: "标准", icon: Gauge, desc: "平衡质量与速度" },
  { value: "premium", label: "高级", icon: Crown, desc: "最佳效果" },
];

export default function PPTPage() {
  const {
    task,
    outline,
    slides,
    imageJobs,
    loading,
    error,
    createTask,
    generateOutline,
    confirmOutline,
    startPolling,
    stopPolling,
    getPPT,
    rewriteSlide,
    regenerateImage,
    exportPPT,
    listPPTs,
    deletePPT,
    getImageJobs,
    setError,
    setOutline,
  } = usePPT();

  const [step, setStep] = useState<Step>("topic");
  const [topicInput, setTopicInput] = useState("");
  const [config, setConfig] = useState<PPTConfig>({
    topic: "",
    templateId: "modern",
    slideCount: 8,
    language: "zh-CN",
    audience: "",
    purpose: "",
    extraContent: "",
    referenceUrl: "",
    withImages: "key_slides",
    withNotes: true,
    qualityMode: "standard",
  });
  const [editSlide, setEditSlide] = useState<FullSlide | null>(null);
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [showRewriteDialog, setShowRewriteDialog] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [history, setHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showImageJobs, setShowImageJobs] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [activeTab, setActiveTab] = useState<"template" | "history">("template");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(t);
    }
  }, [error, setError]);

  useEffect(() => {
    if (step === "preview" && task) {
      getImageJobs(task.id);
      const iv = setInterval(() => getImageJobs(task.id), 5000);
      return () => clearInterval(iv);
    }
  }, [step, task, getImageJobs]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, step]);

  const loadHistory = useCallback(async () => {
    const ppts = await listPPTs();
    setHistory(ppts);
  }, [listPPTs]);

  useEffect(() => {
    if (step === "topic") {
      loadHistory();
    }
  }, [step, loadHistory]);

  const loadPPT = useCallback(
    async (id: number) => {
      await getPPT(id);
      setShowHistory(false);
      setStep("preview");
      setCurrentPage(1);
    },
    [getPPT]
  );

  const handleTopicSubmit = useCallback(() => {
    if (!topicInput.trim()) {
      setError("请输入 PPT 主题");
      return;
    }
    const topic = topicInput.trim();
    setConfig((c) => ({ ...c, topic }));
    setTopicInput("");

    const userMsg: ChatMessage = { id: Date.now() + "u", role: "user", content: topic };

    // 简单判断：如果 topic 很短或很笼统，给出选项
    const isVague = topic.length <= 8;
    if (isVague) {
      setMessages([
        userMsg,
        {
          id: Date.now() + "a1",
          role: "assistant",
          content: `仅给出"${topic}"过于笼统，需明确范围、受众及侧重点等细节以便精准生成内容。`,
          type: "text",
        },
        {
          id: Date.now() + "a2",
          role: "assistant",
          content: "",
          type: "options",
          options: [
            { label: "工作汇报", value: "工作汇报", field: "purpose" },
            { label: "项目宣讲", value: "项目宣讲", field: "purpose" },
            { label: "客户提案", value: "客户提案", field: "purpose" },
            { label: "培训讲座", value: "培训讲座", field: "purpose" },
            { label: "市场分析", value: "市场分析", field: "purpose" },
            { label: "产品介绍", value: "产品介绍", field: "purpose" },
          ],
        },
      ]);
    } else {
      setMessages([
        userMsg,
        {
          id: Date.now() + "a1",
          role: "assistant",
          content: `收到，我将为您制作关于"${topic}"的PPT。您可以补充更多细节，或直接开始生成。`,
          type: "text",
        },
      ]);
    }
    setStep("chat");
  }, [topicInput, setError]);

  const handleChatSend = useCallback(() => {
    if (!chatInput.trim()) return;
    const text = chatInput.trim();
    setChatInput("");
    setMessages((prev) => [
      ...prev,
      { id: Date.now() + "u", role: "user", content: text },
    ]);
    // 模拟 AI 回复
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + "a",
          role: "assistant",
          content: "已记录您的需求。确认配置无误后，点击下方的「生成 PPT」按钮开始制作。",
          type: "text",
        },
      ]);
    }, 600);
  }, [chatInput]);

  const handleOptionSelect = useCallback((opt: { label: string; value: string; field?: string }) => {
    if (opt.field) {
      setConfig((c) => ({ ...c, [opt.field as keyof PPTConfig]: opt.value } as PPTConfig));
    }
    setMessages((prev) => {
      const next = prev.filter((m) => m.type !== "options");
      return [
        ...next,
        { id: Date.now() + "r", role: "assistant", content: `已选择：${opt.label}`, type: "text" },
      ];
    });
  }, []);

  const startGeneration = useCallback(async () => {
    setMessages((prev) => [
      ...prev,
      { id: Date.now() + "g", role: "assistant", content: "正在生成内容大纲...", type: "progress" },
    ]);
    const id = await createTask(config);
    if (id) {
      const o = await generateOutline(id);
      if (o) {
        setMessages((prev) => [
          ...prev.filter((m) => m.type !== "progress"),
          {
            id: Date.now() + "o",
            role: "assistant",
            content: "大纲已生成",
            type: "outline_card",
            data: o,
          },
        ]);
        setStep("outline");
      }
    }
  }, [config, createTask, generateOutline]);

  const handleConfigSubmit = useCallback(async () => {
    const id = await createTask(config);
    if (id) {
      setStep("outline");
      await generateOutline(id);
    }
  }, [config, createTask, generateOutline]);

  const handleConfirmOutline = useCallback(async () => {
    if (!task) return;
    stopPolling();
    const data = await confirmOutline(task.id, outline || undefined);
    if (data?.slides) {
      setStep("preview");
      setCurrentPage(1);
      if (data.status === "generating_images") {
        startPolling(task.id, () => {
          stopPolling();
          getPPT(task.id);
        });
      }
    }
  }, [task, outline, confirmOutline, startPolling, stopPolling, getPPT]);

  const handleRewrite = useCallback(async () => {
    if (!task || !editSlide || !rewriteInstruction.trim()) return;
    await rewriteSlide(task.id, editSlide.page, rewriteInstruction);
    setShowRewriteDialog(false);
    setRewriteInstruction("");
  }, [task, editSlide, rewriteInstruction, rewriteSlide]);

  const handleRegenImage = useCallback(
    async (page: number) => {
      if (!task) return;
      await regenerateImage(task.id, page);
    },
    [task, regenerateImage]
  );

  const currentSlide = slides.find((s) => s.page === currentPage);
  const totalPages = slides.length;

  const stepLabels: Record<Step, string> = {
    topic: "输入主题",
    chat: "对话配置",
    config: "配置选项",
    outline: "大纲确认",
    preview: "预览编辑",
  };

  const stepOrder: Step[] = ["topic", "chat", "config", "outline", "preview"];

  const isGenerating = loading && step === "chat";

  return (
    <div className="flex h-full flex-col bg-surface-elevated text-text-primary dark:bg-surface">
      <div className="flex-1 overflow-auto px-6 py-6 md:px-10 md:py-8">
        <div className="mx-auto max-w-5xl">
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 text-red-500 rounded-xl text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {/* ========== Step 1: 首页（输入+历史） ========== */}
          {step === "topic" && (
            <div className="flex flex-col items-center max-w-4xl mx-auto">
              {/* Logo + 标题 */}
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand/10 text-brand mb-4">
                  <Sparkles className="w-7 h-7" />
                </div>
                <h1 className="text-3xl font-bold mb-2">智能 PPT 制作</h1>
                <p className="text-text-secondary">输入主题，AI 为您生成精美演示文稿</p>
              </div>

              {/* 输入框 */}
              <div className="w-full max-w-2xl">
                <div className="relative flex flex-col rounded-2xl border border-surface-border bg-surface-card transition-all duration-300 focus-within:border-brand/50 focus-within:shadow-[0_0_0_1px_rgba(59,130,246,0.1)]">
                  <textarea
                    value={topicInput}
                    onChange={(e) => setTopicInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleTopicSubmit();
                      }
                    }}
                    placeholder="今天想创建什么 PPT?"
                    rows={3}
                    className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] outline-none placeholder:text-text-tertiary min-h-[80px] max-h-[200px] leading-relaxed text-text-primary"
                  />
                  <div className="flex items-center justify-between px-3 pb-3">
                    <span className="text-xs text-text-tertiary">{topicInput.length}/200</span>
                    <button
                      onClick={handleTopicSubmit}
                      disabled={!topicInput.trim()}
                      className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200 ${
                        topicInput.trim()
                          ? "bg-brand text-white hover:bg-brand-hover"
                          : "bg-surface-elevated text-text-tertiary cursor-not-allowed"
                      }`}
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-text-tertiary">e.g.</span>
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setTopicInput(s)}
                      className="px-3 py-1 rounded-full text-xs border border-surface-border bg-surface-card text-text-secondary hover:border-brand/50 hover:text-brand transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab */}
              <div className="w-full mt-10">
                <div className="flex items-center gap-6 border-b border-surface-border mb-6">
                  <button
                    onClick={() => setActiveTab("template")}
                    className={`pb-2 text-sm font-medium transition-colors ${
                      activeTab === "template"
                        ? "text-text-primary border-b-2 border-text-primary"
                        : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    模板
                  </button>
                  <button
                    onClick={() => setActiveTab("history")}
                    className={`pb-2 text-sm font-medium transition-colors ${
                      activeTab === "history"
                        ? "text-text-primary border-b-2 border-text-primary"
                        : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    历史
                  </button>
                </div>

                {activeTab === "template" && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {TEMPLATE_OPTIONS.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          setConfig((c) => ({ ...c, templateId: t.id }));
                          setTopicInput(`使用${t.name}模板制作PPT`);
                        }}
                        className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-surface-border bg-surface-card hover:border-brand/50 transition-all"
                      >
                        <div
                          className="w-10 h-10 rounded-xl"
                          style={{
                            background: `linear-gradient(135deg, ${t.color}33, ${t.color}66)`,
                          }}
                        />
                        <span className="text-xs">{t.name}</span>
                      </button>
                    ))}
                  </div>
                )}

                {activeTab === "history" && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {history.length === 0 && (
                      <div className="col-span-full text-center py-12 text-text-secondary text-sm">
                        暂无历史记录
                      </div>
                    )}
                    {history.map((h: any) => {
                      const isIncomplete = !["completed", "partial_completed"].includes(h.status);
                      return (
                        <div
                          key={h.id}
                          className="group relative rounded-2xl border border-surface-border bg-surface-card overflow-hidden hover:border-brand/30 transition-all"
                        >
                          {/* 缩略图区域 */}
                          <div className="relative h-40 bg-gradient-to-br from-surface-elevated to-surface flex items-center justify-center">
                            {isIncomplete ? (
                              <div className="flex flex-col items-center gap-2">
                                <img src="/logo.png" alt="AI Space" className="w-10 h-10 rounded-lg object-cover opacity-50" />
                                <span className="text-xs text-text-tertiary">{h.title || h.topic}</span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center gap-2">
                                <FileText className="w-10 h-10 text-text-tertiary" />
                                <span className="text-xs text-text-tertiary">{h.title || h.topic}</span>
                              </div>
                            )}
                            {isIncomplete && (
                              <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                                <Loader2 className="w-6 h-6 text-white animate-spin" />
                              </div>
                            )}
                          </div>
                          {/* 信息区 */}
                          <div className="p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{h.title || h.topic}</p>
                                <p className="text-xs text-text-tertiary mt-0.5">
                                  {new Date(h.created_at).toLocaleDateString("zh-CN")}
                                </p>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                }}
                                className="p-1 rounded-lg hover:bg-surface text-text-tertiary shrink-0"
                              >
                                <MoreHorizontal className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          {/* 点击加载 */}
                          <button
                            onClick={() => loadPPT(h.id)}
                            className="absolute inset-0 z-10"
                            aria-label="打开"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========== Step 2: 聊天式交互 ========== */}
          {step === "chat" && (
            <div className="flex flex-col h-[calc(100vh-140px)] max-w-3xl mx-auto">
              {/* 顶部栏 */}
              <div className="flex items-center justify-between mb-4 shrink-0">
                <button
                  onClick={() => {
                    setStep("topic");
                    setMessages([]);
                  }}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
                >
                  <Home className="w-4 h-4" />
                  返回主页
                </button>
                <div className="px-3 py-1.5 rounded-xl bg-surface-card border border-surface-border text-sm">
                  {config.topic}
                </div>
              </div>

              {/* 消息列表 */}
              <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                {messages.map((msg) => {
                  if (msg.role === "user") {
                    return (
                      <div key={msg.id} className="flex justify-end">
                        <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-brand/10 text-text-primary text-[15px]">
                          {msg.content}
                        </div>
                      </div>
                    );
                  }

                  if (msg.type === "options" && msg.options) {
                    return (
                      <div key={msg.id} className="flex justify-start">
                        <div className="max-w-[90%] space-y-3">
                          <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm bg-surface-card border border-surface-border text-[15px]">
                            {msg.content}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {msg.options.map((opt) => (
                              <button
                                key={opt.value}
                                onClick={() => handleOptionSelect(opt)}
                                className="px-4 py-2 rounded-xl text-sm border border-surface-border bg-surface-card text-text-secondary hover:border-brand/50 hover:text-brand transition-colors"
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (msg.type === "progress") {
                    return (
                      <div key={msg.id} className="flex justify-start">
                        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl rounded-tl-sm bg-surface-card border border-surface-border">
                          <Loader2 className="w-4 h-4 text-brand animate-spin" />
                          <span className="text-sm text-text-secondary">{msg.content}</span>
                        </div>
                      </div>
                    );
                  }

                  if (msg.type === "outline_card" && msg.data) {
                    const o = msg.data;
                    return (
                      <div key={msg.id} className="flex justify-start">
                        <div className="w-full max-w-lg rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
                          <div className="p-4 border-b border-surface-border">
                            <h3 className="font-semibold">{o.title}</h3>
                            <p className="text-xs text-text-secondary mt-1">{o.slides?.length || 0} 页</p>
                          </div>
                          <div className="p-3 space-y-1 max-h-[200px] overflow-y-auto">
                            {(o.slides || []).slice(0, 5).map((s: any) => (
                              <div key={s.page} className="flex items-center gap-2 text-sm">
                                <span className="shrink-0 w-5 h-5 flex items-center justify-center text-[10px] rounded-md bg-surface border border-surface-border">
                                  {s.page}
                                </span>
                                <span className="truncate">{s.title}</span>
                              </div>
                            ))}
                            {(o.slides || []).length > 5 && (
                              <p className="text-xs text-text-tertiary pl-7">...还有 {(o.slides || []).length - 5} 页</p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-tl-sm bg-surface-card border border-surface-border text-[15px]">
                        {msg.content}
                      </div>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>

              {/* 底部输入 */}
              <div className="mt-4 shrink-0">
                <div className="relative flex flex-col rounded-2xl border border-surface-border bg-surface-card transition-all focus-within:border-brand/50">
                  <textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleChatSend();
                      }
                    }}
                    placeholder="补充更多细节..."
                    rows={2}
                    className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-[15px] outline-none placeholder:text-text-tertiary min-h-[60px] max-h-[160px] leading-relaxed text-text-primary"
                  />
                  <div className="flex items-center justify-between px-3 pb-3">
                    <span className="text-xs text-text-tertiary">{chatInput.length}/200</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={startGeneration}
                        disabled={loading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
                      >
                        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                        生成 PPT
                      </button>
                      <button
                        onClick={handleChatSend}
                        disabled={!chatInput.trim()}
                        className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all ${
                          chatInput.trim()
                            ? "bg-brand text-white hover:bg-brand-hover"
                            : "bg-surface-elevated text-text-tertiary cursor-not-allowed"
                        }`}
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========== Step 3: 配置选项（保留） ========== */}
          {step === "config" && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="flex items-center gap-3 mb-2">
                <button
                  onClick={() => setStep("topic")}
                  className="p-2 rounded-xl hover:bg-surface transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div>
                  <h2 className="text-xl font-semibold">配置选项</h2>
                  <p className="text-sm text-text-secondary">为「{config.topic}」定制您的 PPT</p>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium flex items-center gap-2">
                  <LayoutTemplate className="w-4 h-4 text-text-secondary" />
                  模板风格
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                  {TEMPLATE_OPTIONS.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setConfig((c) => ({ ...c, templateId: t.id }))}
                      className={`flex flex-col items-center gap-2 p-3 rounded-2xl border transition-all ${
                        config.templateId === t.id
                          ? "border-brand bg-brand/5"
                          : "border-surface-border bg-surface-card hover:border-surface-border/80"
                      }`}
                    >
                      <div
                        className="w-8 h-8 rounded-xl"
                        style={{
                          background: `linear-gradient(135deg, ${t.color}33, ${t.color}66)`,
                        }}
                      />
                      <span className="text-xs">{t.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium">页数</label>
                <div className="flex flex-wrap gap-2">
                  {PAGE_COUNT_OPTIONS.map((n) => (
                    <button
                      key={n}
                      onClick={() => setConfig((c) => ({ ...c, slideCount: n }))}
                      className={`px-4 py-2 rounded-xl text-sm border transition-colors ${
                        config.slideCount === n
                          ? "bg-brand text-white border-brand"
                          : "border-surface-border bg-surface-card text-text-secondary hover:border-brand/50"
                      }`}
                    >
                      {n} 页
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium">语言</label>
                <div className="flex gap-2">
                  {[
                    { value: "zh-CN", label: "中文" },
                    { value: "en-US", label: "English" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setConfig((c) => ({ ...c, language: opt.value }))}
                      className={`px-4 py-2 rounded-xl text-sm border transition-colors ${
                        config.language === opt.value
                          ? "bg-brand text-white border-brand"
                          : "border-surface-border bg-surface-card text-text-secondary hover:border-brand/50"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Users className="w-4 h-4 text-text-secondary" />
                  受众
                </label>
                <div className="flex flex-wrap gap-2">
                  {AUDIENCE_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      onClick={() =>
                        setConfig((c) => ({
                          ...c,
                          audience: c.audience === opt ? "" : opt,
                        }))
                      }
                      className={`px-3 py-1.5 rounded-xl text-sm border transition-colors ${
                        config.audience === opt
                          ? "bg-brand/10 text-brand border-brand/30"
                          : "border-surface-border bg-surface-card text-text-secondary hover:border-brand/50"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Target className="w-4 h-4 text-text-secondary" />
                  用途
                </label>
                <div className="flex flex-wrap gap-2">
                  {PURPOSE_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      onClick={() =>
                        setConfig((c) => ({
                          ...c,
                          purpose: c.purpose === opt ? "" : opt,
                        }))
                      }
                      className={`px-3 py-1.5 rounded-xl text-sm border transition-colors ${
                        config.purpose === opt
                          ? "bg-brand/10 text-brand border-brand/30"
                          : "border-surface-border bg-surface-card text-text-secondary hover:border-brand/50"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium flex items-center gap-2">
                  <ImagePlus className="w-4 h-4 text-text-secondary" />
                  配图策略
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {IMAGE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setConfig((c) => ({ ...c, withImages: opt.value }))}
                      className={`px-3 py-2.5 rounded-2xl text-sm border text-center transition-colors ${
                        config.withImages === opt.value
                          ? "bg-brand/10 text-brand border-brand/30"
                          : "border-surface-border bg-surface-card text-text-secondary hover:border-brand/50"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-text-secondary" />
                  质量模式
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {QUALITY_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setConfig((c) => ({ ...c, qualityMode: opt.value }))}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border transition-colors ${
                          config.qualityMode === opt.value
                            ? "bg-brand/10 text-brand border-brand/30"
                            : "border-surface-border bg-surface-card text-text-secondary hover:border-brand/50"
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                        <span className="text-sm font-medium">{opt.label}</span>
                        <span className="text-xs text-text-tertiary">{opt.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-3 p-4 rounded-2xl border border-surface-border bg-surface-card">
                <MessageSquareQuote className="w-5 h-5 text-text-secondary" />
                <div className="flex-1">
                  <p className="text-sm font-medium">生成演讲者备注</p>
                  <p className="text-xs text-text-tertiary">为每页幻灯片生成演讲提示</p>
                </div>
                <button
                  onClick={() => setConfig((c) => ({ ...c, withNotes: !c.withNotes }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    config.withNotes ? "bg-brand" : "bg-surface-border"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                      config.withNotes ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </div>

              <div className="flex justify-between pt-4">
                <button
                  onClick={() => setStep("topic")}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-surface-border hover:bg-surface transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  返回
                </button>
                <button
                  onClick={handleConfigSubmit}
                  disabled={loading}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-brand text-white font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  生成大纲
                </button>
              </div>
            </div>
          )}

          {/* ========== Step 4: 大纲确认 ========== */}
          {step === "outline" && (
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setStep("chat")}
                    className="p-2 rounded-xl hover:bg-surface transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <div>
                    <h2 className="text-xl font-semibold">大纲确认</h2>
                    <p className="text-sm text-text-secondary">
                      {outline ? "检查并确认生成结果" : "AI 正在为您生成大纲..."}
                    </p>
                  </div>
                </div>
                {loading && !outline && (
                  <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {task?.progress_msg}
                  </div>
                )}
              </div>

              {loading && !outline && (
                <div className="space-y-3 p-8 rounded-2xl border border-surface-border bg-surface-card text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-brand/10 text-brand mb-2">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                  <p className="text-text-secondary">{task?.progress_msg || "正在分析主题并生成大纲..."}</p>
                  <div className="w-full h-2 bg-surface rounded-full overflow-hidden max-w-sm mx-auto">
                    <div
                      className="h-full bg-brand transition-all duration-500 rounded-full"
                      style={{ width: `${task?.progress || 10}%` }}
                    />
                  </div>
                </div>
              )}

              {outline && (
                <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
                  <div className="p-6 border-b border-surface-border">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-xl font-semibold">{outline.title}</h3>
                        {outline.subtitle && (
                          <p className="text-sm text-text-secondary mt-1">{outline.subtitle}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-brand/10 text-brand text-xs font-medium shrink-0">
                        <FileText className="w-3.5 h-3.5" />
                        {outline.slides.length} 页
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-sm text-text-secondary">
                      {outline.audience && (
                        <span className="flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" />
                          {outline.audience}
                        </span>
                      )}
                      {outline.purpose && (
                        <span className="flex items-center gap-1">
                          <Target className="w-3.5 h-3.5" />
                          {outline.purpose}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-4 space-y-2 max-h-[50vh] overflow-y-auto">
                    {outline.slides.map((slide) => (
                      <div
                        key={slide.page}
                        className="flex items-start gap-3 p-3 rounded-xl bg-surface hover:bg-surface/80 transition-colors"
                      >
                        <span className="shrink-0 w-7 h-7 flex items-center justify-center text-xs font-medium rounded-lg bg-surface-card border border-surface-border">
                          {slide.page}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{slide.title}</span>
                            {slide.need_image && <ImageIcon className="w-3.5 h-3.5 text-text-tertiary" />}
                          </div>
                          <p className="text-xs text-text-secondary mt-0.5">{slide.one_liner}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-between">
                <button
                  onClick={() => setStep("chat")}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-surface-border hover:bg-surface transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  返回
                </button>
                <div className="flex items-center gap-2">
                  {outline && (
                    <button
                      onClick={async () => {
                        if (!task) return;
                        const o = await generateOutline(task.id);
                        if (o) setOutline(o);
                      }}
                      disabled={loading}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-surface-border hover:bg-surface transition-colors text-sm"
                    >
                      <RotateCcw className="w-4 h-4" />
                      重新生成
                    </button>
                  )}
                  <button
                    onClick={handleConfirmOutline}
                    disabled={loading || !outline}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-brand text-white font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    确认并生成 PPT
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ========== Step 5: 预览编辑 ========== */}
          {step === "preview" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setStep("outline")}
                    className="p-2 rounded-xl hover:bg-surface transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <h2 className="text-xl font-semibold">{task?.title || "PPT 预览"}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => exportPPT(task!.id, "markdown")}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm border border-surface-border hover:bg-surface transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Markdown
                  </button>
                  <button
                    onClick={() => exportPPT(task!.id, "text")}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm border border-surface-border hover:bg-surface transition-colors"
                  >
                    <FileText className="w-4 h-4" />
                    文本
                  </button>
                </div>
              </div>

              {task?.status === "generating_images" && (
                <div className="space-y-1">
                  <div className="w-full h-2 bg-surface rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand transition-all duration-500 rounded-full"
                      style={{ width: `${task.progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-text-secondary text-center">
                    {task.progress_msg} ({task.progress}%)
                  </p>
                </div>
              )}

              {imageJobs.length > 0 && (
                <div className="rounded-xl border border-surface-border bg-surface-card">
                  <button
                    onClick={() => setShowImageJobs((v) => !v)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <ImageIcon className="w-4 h-4" />
                      配图状态
                      <span className="text-xs text-text-secondary">
                        (已生成 {imageJobs.filter((j) => j.status === "completed").length}/{imageJobs.length})
                      </span>
                    </span>
                    <ChevronRight
                      className={`w-4 h-4 text-text-secondary transition-transform ${showImageJobs ? "rotate-90" : ""}`}
                    />
                  </button>
                  {showImageJobs && (
                    <div className="px-4 pb-3 space-y-2">
                      {imageJobs.map((job) => (
                        <div key={job.id} className="flex items-center gap-2 text-sm">
                          <span className="shrink-0 w-6 text-xs text-text-secondary">P{job.page}</span>
                          {job.status === "completed" ? (
                            <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                          ) : job.status === "failed" ? (
                            <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                          ) : (
                            <Loader2 className="w-3.5 h-3.5 text-brand animate-spin shrink-0" />
                          )}
                          <span className="truncate flex-1 text-text-secondary">
                            {job.prompt?.slice(0, 40) || `配图`}...
                          </span>
                          <span
                            className={`shrink-0 text-xs ${
                              job.status === "completed"
                                ? "text-green-500"
                                : job.status === "failed"
                                ? "text-red-500"
                                : "text-brand"
                            }`}
                          >
                            {job.status === "completed" ? "已生成" : job.status === "failed" ? "失败" : "生成中"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2 overflow-x-auto pb-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="p-2 rounded-xl border border-surface-border disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {slides.map((s) => (
                  <button
                    key={s.page}
                    onClick={() => setCurrentPage(s.page)}
                    className={`px-3 py-1.5 rounded-xl text-xs whitespace-nowrap transition-colors ${
                      s.page === currentPage ? "bg-brand text-white" : "bg-surface hover:bg-surface/80"
                    }`}
                  >
                    {s.page}. {s.title.slice(0, 8)}
                    {s.title.length > 8 ? "..." : ""}
                  </button>
                ))}
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="p-2 rounded-xl border border-surface-border disabled:opacity-30 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {currentSlide && (
                <div className="min-h-[400px] rounded-2xl border border-surface-border bg-surface-card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 text-xs rounded-lg border border-surface-border">{currentSlide.type}</span>
                      <span className="px-2 py-0.5 text-xs rounded-lg bg-surface">{currentSlide.layout}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setEditSlide(currentSlide);
                          setShowRewriteDialog(true);
                        }}
                        className="flex items-center gap-1 px-2 py-1 text-sm rounded-lg hover:bg-surface transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        重写
                      </button>
                      {currentSlide.image?.needed && (
                        <button
                          onClick={() => handleRegenImage(currentSlide.page)}
                          className="flex items-center gap-1 px-2 py-1 text-sm rounded-lg hover:bg-surface transition-colors"
                        >
                          <ImageIcon className="w-3 h-3" />
                          换图
                        </button>
                      )}
                    </div>
                  </div>

                  {currentSlide.type === "cover" && (
                    <div className="text-center py-12 space-y-4">
                      {currentSlide.image?.url && (
                        <img src={currentSlide.image.url} alt="cover" className="w-full max-h-48 object-cover rounded-xl mx-auto" />
                      )}
                      <h1 className="text-3xl font-bold">{currentSlide.title}</h1>
                      {currentSlide.subtitle && <p className="text-lg text-text-secondary">{currentSlide.subtitle}</p>}
                    </div>
                  )}

                  {currentSlide.type !== "cover" && currentSlide.type !== "end" && (
                    <div className="space-y-4">
                      {currentSlide.image?.url && (
                        <img src={currentSlide.image.url} alt="slide" className="w-full max-h-40 object-cover rounded-xl" />
                      )}
                      <h2 className="text-2xl font-semibold">{currentSlide.title}</h2>
                      {currentSlide.subtitle && <p className="text-text-secondary">{currentSlide.subtitle}</p>}
                      <ul className="space-y-2">
                        {currentSlide.content.map((item, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-brand mt-2 shrink-0" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {currentSlide.type === "end" && (
                    <div className="text-center py-12">
                      <h2 className="text-2xl font-bold">{currentSlide.title}</h2>
                      {currentSlide.content.length > 0 && <p className="text-text-secondary mt-2">{currentSlide.content[0]}</p>}
                    </div>
                  )}

                  {currentSlide.speaker_notes && (
                    <div className="mt-6 p-3 bg-surface rounded-xl">
                      <p className="text-xs font-medium text-text-secondary mb-1">演讲备注</p>
                      <p className="text-sm text-text-secondary">{currentSlide.speaker_notes}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 重写对话框 */}
          {showRewriteDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="w-full max-w-lg p-6 rounded-2xl bg-surface-card border border-surface-border">
                <h3 className="text-lg font-semibold mb-4">重写第 {editSlide?.page} 页</h3>
                <p className="text-sm text-text-secondary mb-2">当前标题：{editSlide?.title}</p>
                <textarea
                  value={rewriteInstruction}
                  onChange={(e) => setRewriteInstruction(e.target.value)}
                  placeholder="输入修改指令，如：增加具体数据支撑、语气更激励人心"
                  rows={4}
                  className="w-full px-3 py-2 rounded-xl border border-surface-border bg-surface focus:outline-none focus:ring-2 focus:ring-brand/50 resize-none"
                />
                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setShowRewriteDialog(false)} className="px-4 py-2 rounded-xl border border-surface-border hover:bg-surface transition-colors">
                    取消
                  </button>
                  <button
                    onClick={handleRewrite}
                    disabled={loading || !rewriteInstruction.trim()}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                    重写
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 历史记录弹窗（保留备用） */}
          {showHistory && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="w-full max-w-lg p-6 rounded-2xl bg-surface-card border border-surface-border">
                <h3 className="text-lg font-semibold mb-4">历史记录</h3>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {history.length === 0 && <p className="text-sm text-text-secondary text-center py-4">暂无记录</p>}
                  {history.map((h: any) => (
                    <div key={h.id} className="flex items-center justify-between p-3 rounded-xl bg-surface">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{h.title || h.topic}</p>
                        <p className="text-xs text-text-secondary">
                          {h.slide_count}页 · {h.status} · {new Date(h.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => loadPPT(h.id)} className="p-2 rounded-lg hover:bg-surface-card transition-colors">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={async () => {
                            await deletePPT(h.id);
                            loadHistory();
                          }}
                          className="p-2 rounded-lg hover:bg-red-500/10 text-red-500 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end mt-4">
                  <button onClick={() => setShowHistory(false)} className="px-4 py-2 rounded-xl border border-surface-border hover:bg-surface transition-colors">
                    关闭
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
