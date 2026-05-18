"use client";

import { useState, useEffect, useCallback } from "react";
import { usePPT, PPTConfig, Template, Outline, FullSlide, PPTImageJob } from "@/hooks/usePPT";
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
  Palette,
  Settings,
  Eye,
  Trash2,
  AlertCircle,
} from "lucide-react";

type Step = "template" | "config" | "outline" | "preview";

export default function PPTPage() {
  const {
    templates,
    task,
    outline,
    slides,
    imageJobs,
    loading,
    error,
    fetchTemplates,
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

  const [step, setStep] = useState<Step>("template");
  const [config, setConfig] = useState<PPTConfig>({
    topic: "",
    templateId: "modern",
    slideCount: 8,
    language: "zh-CN",
    audience: "",
    purpose: "",
    withImages: "key_slides",
    withNotes: true,
    qualityMode: "standard",
  });
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [editSlide, setEditSlide] = useState<FullSlide | null>(null);
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [showRewriteDialog, setShowRewriteDialog] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [history, setHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showImageJobs, setShowImageJobs] = useState(false);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(t);
    }
  }, [error, setError]);

  // 自动查询配图任务状态
  useEffect(() => {
    if (step === "preview" && task) {
      getImageJobs(task.id);
      const iv = setInterval(() => {
        getImageJobs(task.id);
      }, 5000);
      return () => clearInterval(iv);
    }
  }, [step, task, getImageJobs]);

  const handleCreate = useCallback(async () => {
    if (!config.topic.trim()) {
      setError("请输入 PPT 主题");
      return;
    }
    const id = await createTask(config);
    if (id) {
      setStep("outline");
      await generateOutline(id);
    }
  }, [config, createTask, generateOutline, setError]);

  const handleConfirmOutline = useCallback(async () => {
    if (!task) return;
    stopPolling(); // 先停止 outline 阶段的旧轮询
    const data = await confirmOutline(task.id, outline || undefined);
    if (data?.slides) {
      setStep("preview"); // 成功返回后再切换到 preview
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

  const loadHistory = useCallback(async () => {
    const ppts = await listPPTs();
    setHistory(ppts);
    setShowHistory(true);
  }, [listPPTs]);

  const loadPPT = useCallback(
    async (id: number) => {
      await getPPT(id);
      setShowHistory(false);
      setStep("preview");
      setCurrentPage(1);
    },
    [getPPT]
  );

  const currentSlide = slides.find((s) => s.page === currentPage);
  const totalPages = slides.length;

  const stepItems = [
    { key: "template" as Step, label: "选择模板", icon: Palette },
    { key: "config" as Step, label: "配置参数", icon: Settings },
    { key: "outline" as Step, label: "大纲确认", icon: FileText },
    { key: "preview" as Step, label: "预览编辑", icon: Eye },
  ];

  return (
    <div className="container mx-auto py-6 px-4 max-w-5xl">
      {/* 步骤指示器 */}
      <div className="flex items-center gap-2 mb-8 flex-wrap">
        {stepItems.map((s, i) => {
          const Icon = s.icon;
          const isActive = step === s.key;
          const isDone =
            stepItems.findIndex((x) => x.key === step) >
            stepItems.findIndex((x) => x.key === s.key);
          return (
            <div key={s.key} className="flex items-center gap-2">
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                  isActive
                    ? "bg-[var(--brand)] text-white"
                    : isDone
                    ? "bg-[var(--brand)]/10 text-[var(--brand)]"
                    : "bg-[var(--surface)] text-[var(--text-secondary)]"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{s.label}</span>
                {isDone && <Check className="w-3 h-3" />}
              </div>
              {i < 3 && (
                <ChevronRight className="w-4 h-4 text-[var(--text-secondary)]" />
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 text-red-500 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* ========== 模板选择 ========== */}
      {step === "template" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">选择模板</h2>
            <button
              onClick={loadHistory}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm border border-[var(--surface-border)] hover:bg-[var(--surface)] transition-colors"
            >
              <FileText className="w-4 h-4" />
              历史记录
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {templates.map((t) => (
              <div
                key={t.id}
                onClick={() => {
                  setSelectedTemplate(t);
                  setConfig((c) => ({ ...c, templateId: t.id }));
                }}
                className={`cursor-pointer rounded-xl border transition-all hover:shadow-md ${
                  selectedTemplate?.id === t.id
                    ? "border-[var(--brand)] ring-2 ring-[var(--brand)]/20"
                    : "border-[var(--surface-border)]"
                }`}
              >
                <div
                  className="h-24 rounded-t-xl"
                  style={{
                    background: `linear-gradient(135deg, ${t.primaryColor}22, ${t.primaryColor}44)`,
                  }}
                />
                <div className="p-4">
                  <h3 className="font-medium">{t.name}</h3>
                  <p className="text-xs text-[var(--text-secondary)] mt-1">{t.category}</p>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-2">
                    {t.description}
                  </p>
                  <div className="flex items-center gap-2 mt-3">
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: t.primaryColor }}
                    />
                    <span className="text-xs text-[var(--text-secondary)]">{t.preview}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <button
              disabled={!selectedTemplate}
              onClick={() => setStep("config")}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand)] text-white disabled:opacity-50"
            >
              下一步 <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ========== 配置参数 ========== */}
      {step === "config" && (
        <div className="space-y-6 max-w-2xl mx-auto">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setStep("template")}
              className="p-2 rounded-lg hover:bg-[var(--surface)]"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <h2 className="text-xl font-semibold">配置参数</h2>
          </div>

          <div className="space-y-4 p-6 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-card)]">
            <div>
              <label className="text-sm font-medium">主题 / 标题</label>
              <input
                value={config.topic}
                onChange={(e) => setConfig((c) => ({ ...c, topic: e.target.value }))}
                placeholder="输入 PPT 主题，如“AI 时代的教育变革”"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-[var(--surface-border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/50"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">页数</label>
                <select
                  value={config.slideCount}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, slideCount: parseInt(e.target.value) }))
                  }
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-[var(--surface-border)] bg-[var(--background)]"
                >
                  {[5, 6, 7, 8, 10, 12, 15, 20].map((n) => (
                    <option key={n} value={n}>
                      {n} 页
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">语言</label>
                <select
                  value={config.language}
                  onChange={(e) => setConfig((c) => ({ ...c, language: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-[var(--surface-border)] bg-[var(--background)]"
                >
                  <option value="zh-CN">中文</option>
                  <option value="en-US">English</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">受众（可选）</label>
              <input
                value={config.audience}
                onChange={(e) => setConfig((c) => ({ ...c, audience: e.target.value }))}
                placeholder="如：企业管理层、学生、投资人"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-[var(--surface-border)] bg-[var(--background)]"
              />
            </div>

            <div>
              <label className="text-sm font-medium">用途（可选）</label>
              <input
                value={config.purpose}
                onChange={(e) => setConfig((c) => ({ ...c, purpose: e.target.value }))}
                placeholder="如：工作汇报、宣讲、培训、客户提案"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-[var(--surface-border)] bg-[var(--background)]"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">配图策略</label>
                <select
                  value={config.withImages}
                  onChange={(e) => setConfig((c) => ({ ...c, withImages: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-[var(--surface-border)] bg-[var(--background)]"
                >
                  <option value="none">不生成图片</option>
                  <option value="cover">仅封面</option>
                  <option value="key_slides">关键页配图</option>
                  <option value="all">全部配图</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">质量模式</label>
                <select
                  value={config.qualityMode}
                  onChange={(e) => setConfig((c) => ({ ...c, qualityMode: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-[var(--surface-border)] bg-[var(--background)]"
                >
                  <option value="fast">快速</option>
                  <option value="standard">标准</option>
                  <option value="premium">高级</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="withNotes"
                checked={config.withNotes}
                onChange={(e) => setConfig((c) => ({ ...c, withNotes: e.target.checked }))}
                className="rounded"
              />
              <label htmlFor="withNotes" className="text-sm">
                生成演讲者备注
              </label>
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep("template")}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--surface-border)] hover:bg-[var(--surface)]"
            >
              <ChevronLeft className="w-4 h-4" />返回
            </button>
            <button
              onClick={handleCreate}
              disabled={loading || !config.topic.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand)] text-white disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4" />
              )}
              生成大纲
            </button>
          </div>
        </div>
      )}

      {/* ========== 大纲确认 ========== */}
      {step === "outline" && (
        <div className="space-y-6 max-w-3xl mx-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">大纲确认</h2>
            {loading && (
              <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <Loader2 className="w-4 h-4 animate-spin" />
                {task?.progress_msg}
              </div>
            )}
          </div>

          {task && task.status !== "outline_ready" && task.status !== "completed" && (
            <div className="space-y-2">
              <div className="w-full h-2 bg-[var(--surface)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--brand)] transition-all"
                  style={{ width: `${task.progress}%` }}
                />
              </div>
              <p className="text-xs text-[var(--text-secondary)] text-center">
                {task.progress_msg}
              </p>
            </div>
          )}

          {outline && (
            <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-card)] max-h-[60vh] overflow-y-auto">
              <div className="p-4 border-b border-[var(--surface-border)]">
                <h3 className="text-lg font-semibold">{outline.title}</h3>
                {outline.subtitle && (
                  <p className="text-sm text-[var(--text-secondary)]">{outline.subtitle}</p>
                )}
              </div>
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {outline.audience && (
                    <div>
                      <span className="text-[var(--text-secondary)]">受众：</span>
                      {outline.audience}
                    </div>
                  )}
                  {outline.purpose && (
                    <div>
                      <span className="text-[var(--text-secondary)]">用途：</span>
                      {outline.purpose}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  {outline.slides.map((slide) => (
                    <div
                      key={slide.page}
                      className="flex items-start gap-3 p-3 rounded-lg bg-[var(--background)]"
                    >
                      <span className="shrink-0 mt-0.5 px-2 py-0.5 text-xs rounded bg-[var(--surface)]">
                        {slide.page}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{slide.title}</span>
                          {slide.need_image && (
                            <ImageIcon className="w-3 h-3 text-[var(--text-secondary)]" />
                          )}
                        </div>
                        <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                          {slide.one_liner}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-between">
            <button
              onClick={() => setStep("config")}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--surface-border)] hover:bg-[var(--surface)]"
            >
              <ChevronLeft className="w-4 h-4" />返回
            </button>
            <button
              onClick={handleConfirmOutline}
              disabled={loading || !outline}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand)] text-white disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              确认并生成 PPT
            </button>
          </div>
        </div>
      )}

      {/* ========== 预览编辑 ========== */}
      {step === "preview" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setStep("outline")}
                className="p-2 rounded-lg hover:bg-[var(--surface)]"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <h2 className="text-xl font-semibold">
                {task?.title || "PPT 预览"}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => exportPPT(task!.id, "markdown")}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm border border-[var(--surface-border)] hover:bg-[var(--surface)]"
              >
                <Download className="w-4 h-4" />
                Markdown
              </button>
              <button
                onClick={() => exportPPT(task!.id, "text")}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm border border-[var(--surface-border)] hover:bg-[var(--surface)]"
              >
                <FileText className="w-4 h-4" />
                文本
              </button>
            </div>
          </div>

          {/* 配图生成进度 */}
          {task?.status === "generating_images" && (
            <div className="space-y-1">
              <div className="w-full h-2 bg-[var(--surface)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--brand)] transition-all duration-500"
                  style={{ width: `${task.progress}%` }}
                />
              </div>
              <p className="text-xs text-[var(--text-secondary)] text-center">
                {task.progress_msg} ({task.progress}%)
              </p>
            </div>
          )}

          {/* 配图状态汇总 */}
          {imageJobs.length > 0 && (
            <div className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-card)]">
              <button
                onClick={() => setShowImageJobs((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <ImageIcon className="w-4 h-4" />
                  配图状态
                  <span className="text-xs text-[var(--text-secondary)]">
                    (已生成 {imageJobs.filter((j) => j.status === "completed").length}/
                    {imageJobs.length})
                  </span>
                </span>
                <ChevronRight
                  className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${
                    showImageJobs ? "rotate-90" : ""
                  }`}
                />
              </button>
              {showImageJobs && (
                <div className="px-4 pb-3 space-y-2">
                  {imageJobs.map((job) => (
                    <div
                      key={job.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span className="shrink-0 w-6 text-xs text-[var(--text-secondary)]">
                        P{job.page}
                      </span>
                      {job.status === "completed" ? (
                        <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      ) : job.status === "failed" ? (
                        <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                      ) : (
                        <Loader2 className="w-3.5 h-3.5 text-[var(--brand)] animate-spin shrink-0" />
                      )}
                      <span className="truncate flex-1 text-[var(--text-secondary)]">
                        {job.prompt?.slice(0, 40) || `配图`}...
                      </span>
                      <span
                        className={`shrink-0 text-xs ${
                          job.status === "completed"
                            ? "text-green-500"
                            : job.status === "failed"
                            ? "text-red-500"
                            : "text-[var(--brand)]"
                        }`}
                      >
                        {job.status === "completed"
                          ? "已生成"
                          : job.status === "failed"
                          ? "失败"
                          : "生成中"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 幻灯片导航 */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="p-2 rounded-lg border border-[var(--surface-border)] disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {slides.map((s) => (
              <button
                key={s.page}
                onClick={() => setCurrentPage(s.page)}
                className={`px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors ${
                  s.page === currentPage
                    ? "bg-[var(--brand)] text-white"
                    : "bg-[var(--surface)] hover:bg-[var(--surface)]/80"
                }`}
              >
                {s.page}. {s.title.slice(0, 8)}
                {s.title.length > 8 ? "..." : ""}
              </button>
            ))}
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="p-2 rounded-lg border border-[var(--surface-border)] disabled:opacity-30"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* 当前页面 */}
          {currentSlide && (
            <div className="min-h-[400px] rounded-xl border border-[var(--surface-border)] bg-[var(--surface-card)] p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 text-xs rounded border border-[var(--surface-border)]">
                    {currentSlide.type}
                  </span>
                  <span className="px-2 py-0.5 text-xs rounded bg-[var(--surface)]">
                    {currentSlide.layout}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setEditSlide(currentSlide);
                      setShowRewriteDialog(true);
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-sm rounded hover:bg-[var(--surface)]"
                  >
                    <RotateCcw className="w-3 h-3" />
                    重写
                  </button>
                  {currentSlide.image?.needed && (
                    <button
                      onClick={() => handleRegenImage(currentSlide.page)}
                      className="flex items-center gap-1 px-2 py-1 text-sm rounded hover:bg-[var(--surface)]"
                    >
                      <ImageIcon className="w-3 h-3" />
                      换图
                    </button>
                  )}
                </div>
              </div>

              {/* 封面样式 */}
              {currentSlide.type === "cover" && (
                <div className="text-center py-12 space-y-4">
                  {currentSlide.image?.url && (
                    <img
                      src={currentSlide.image.url}
                      alt="cover"
                      className="w-full max-h-48 object-cover rounded-lg mx-auto"
                    />
                  )}
                  <h1 className="text-3xl font-bold">{currentSlide.title}</h1>
                  {currentSlide.subtitle && (
                    <p className="text-lg text-[var(--text-secondary)]">
                      {currentSlide.subtitle}
                    </p>
                  )}
                </div>
              )}

              {/* 正文样式 */}
              {currentSlide.type !== "cover" && currentSlide.type !== "end" && (
                <div className="space-y-4">
                  {currentSlide.image?.url && (
                    <img
                      src={currentSlide.image.url}
                      alt="slide"
                      className="w-full max-h-40 object-cover rounded-lg"
                    />
                  )}
                  <h2 className="text-2xl font-semibold">{currentSlide.title}</h2>
                  {currentSlide.subtitle && (
                    <p className="text-[var(--text-secondary)]">{currentSlide.subtitle}</p>
                  )}
                  <ul className="space-y-2">
                    {currentSlide.content.map((item, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--brand)] mt-2 shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 结束页 */}
              {currentSlide.type === "end" && (
                <div className="text-center py-12">
                  <h2 className="text-2xl font-bold">{currentSlide.title}</h2>
                  {currentSlide.content.length > 0 && (
                    <p className="text-[var(--text-secondary)] mt-2">
                      {currentSlide.content[0]}
                    </p>
                  )}
                </div>
              )}

              {/* 演讲备注 */}
              {currentSlide.speaker_notes && (
                <div className="mt-6 p-3 bg-[var(--background)] rounded-lg">
                  <p className="text-xs font-medium text-[var(--text-secondary)] mb-1">
                    演讲备注
                  </p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    {currentSlide.speaker_notes}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 重写对话框 */}
      {showRewriteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg p-6 rounded-xl bg-[var(--surface-card)] border border-[var(--surface-border)]">
            <h3 className="text-lg font-semibold mb-4">重写第 {editSlide?.page} 页</h3>
            <p className="text-sm text-[var(--text-secondary)] mb-2">
              当前标题：{editSlide?.title}
            </p>
            <textarea
              value={rewriteInstruction}
              onChange={(e) => setRewriteInstruction(e.target.value)}
              placeholder="输入修改指令，如：“增加具体数据支撑”、“语气更激励人心”"
              rows={4}
              className="w-full px-3 py-2 rounded-lg border border-[var(--surface-border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/50"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowRewriteDialog(false)}
                className="px-4 py-2 rounded-lg border border-[var(--surface-border)] hover:bg-[var(--surface)]"
              >
                取消
              </button>
              <button
                onClick={handleRewrite}
                disabled={loading || !rewriteInstruction.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand)] text-white disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RotateCcw className="w-4 h-4" />
                )}
                重写
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 历史记录对话框 */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg p-6 rounded-xl bg-[var(--surface-card)] border border-[var(--surface-border)]">
            <h3 className="text-lg font-semibold mb-4">历史记录</h3>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {history.length === 0 && (
                <p className="text-sm text-[var(--text-secondary)] text-center py-4">
                  暂无记录
                </p>
              )}
              {history.map((h: any) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-[var(--background)]"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{h.title || h.topic}</p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {h.slide_count}页 · {h.status} · {new Date(h.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => loadPPT(h.id)}
                      className="p-2 rounded hover:bg-[var(--surface)]"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={async () => {
                        await deletePPT(h.id);
                        loadHistory();
                      }}
                      className="p-2 rounded hover:bg-red-500/10 text-red-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setShowHistory(false)}
                className="px-4 py-2 rounded-lg border border-[var(--surface-border)] hover:bg-[var(--surface)]"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
