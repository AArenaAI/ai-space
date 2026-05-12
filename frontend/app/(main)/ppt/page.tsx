"use client";

import { useState, useEffect, useRef } from "react";
import { usePPT, Slide, Template } from "@/hooks/usePPT";
import { FileText, Loader2, Trash2, Download, Presentation, Copy } from "lucide-react";
import { toast } from "sonner";

const SLIDE_COUNTS = [5, 8, 10, 15];

const TEMPLATE_STYLES: Record<string, { name: string; primaryColor: string; bg: string }> = {
  modern: {
    name: "现代简约",
    primaryColor: "#3B82F6",
    bg: "#FFFFFF",
  },
  business: {
    name: "商务正式",
    primaryColor: "#1E3A5F",
    bg: "#F7FAFC",
  },
  creative: {
    name: "创意活力",
    primaryColor: "#EC4899",
    bg: "#FFF5F7",
  },
  minimal: {
    name: "极简纯净",
    primaryColor: "#000000",
    bg: "#FFFFFF",
  },
};

export default function PPTPage() {
  const { ppts, templates, isGenerating, fetchTemplates, fetchPPTs, generatePPT, deletePPT } = usePPT();
  const [topic, setTopic] = useState("");
  const [slideCount, setSlideCount] = useState(8);
  const [selectedTemplate, setSelectedTemplate] = useState("modern");
  const [generatedSlides, setGeneratedSlides] = useState<Slide[] | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchTemplates();
    fetchPPTs();
  }, [fetchTemplates, fetchPPTs]);

  const handleGenerate = async () => {
    if (!topic.trim()) {
      toast.error("请输入PPT主题");
      return;
    }

    try {
      const data = await generatePPT(topic, slideCount, selectedTemplate);
      setGeneratedSlides(data.slides);
      setShowPreview(true);
      toast.success("PPT生成成功");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成失败");
    }
  };

  // 导出为Markdown
  const exportToMarkdown = () => {
    if (!generatedSlides) return;

    let md = `# ${topic}\n\n`;
    generatedSlides.forEach((slide, index) => {
      md += `## ${slide.title}\n`;
      if (slide.subtitle) {
        md += `*${slide.subtitle}*\n`;
      }
      if (slide.content && slide.content.length > 0) {
        slide.content.forEach((item) => {
          md += `- ${item}\n`;
        });
      }
      md += "\n";
    });

    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${topic.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_")}.md`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("导出Markdown成功");
  };

  // 复制大纲
  const copyOutline = () => {
    if (!generatedSlides) return;

    let text = `${topic}\n\n`;
    generatedSlides.forEach((slide, index) => {
      text += `${index + 1}. ${slide.title}\n`;
      if (slide.content && slide.content.length > 0) {
        slide.content.forEach((item) => {
          text += `   - ${item}\n`;
        });
      }
    });

    navigator.clipboard.writeText(text);
    toast.success("已复制到剪贴板");
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定删除这个PPT吗？")) return;
    try {
      await deletePPT(id);
      toast.success("删除成功");
    } catch {
      toast.error("删除失败");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const lines = content.split("\n").filter((line) => line.trim());

        const slides: Slide[] = [];
        let currentSlide: Slide | null = null;

        lines.forEach((line) => {
          if (line.startsWith("# ") || line.startsWith("## ")) {
            if (currentSlide) slides.push(currentSlide);
            currentSlide = {
              title: line.replace(/^#+\s*/, ""),
              content: [],
            };
          } else if (currentSlide && line.trim()) {
            currentSlide.content.push(line.replace(/^[-*]\s*/, ""));
          }
        });

        if (currentSlide) slides.push(currentSlide);

        if (slides.length > 0) {
          setGeneratedSlides(slides);
          setShowPreview(true);
          toast.success("文件导入成功");
        } else {
          toast.error("无法解析文件内容");
        }
      } catch {
        toast.error("文件解析失败");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* 顶部栏 */}
      <header className="shrink-0 h-12 flex items-center justify-between px-4 border-b border-surface-border">
        <div className="flex items-center gap-2">
          <Presentation className="w-5 h-5 text-text-primary" />
          <span className="text-sm font-semibold text-text-primary">PPT生成</span>
        </div>
      </header>

      {/* 主内容区 */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* 生成区域 */}
          <div className="bg-surface-card rounded-lg border border-surface-border p-6">
            <h2 className="text-lg font-medium text-text-primary mb-4">创建新PPT</h2>

            {/* 主题输入 */}
            <div className="mb-4">
              <label className="block text-sm text-text-secondary mb-2">PPT主题</label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="例如：人工智能发展趋势、2025年工作计划..."
                className="w-full p-3 bg-surface border border-surface-border rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand"
              />
            </div>

            {/* 页数选择 */}
            <div className="mb-4">
              <label className="block text-sm text-text-secondary mb-2">页数</label>
              <div className="flex gap-2">
                {SLIDE_COUNTS.map((count) => (
                  <button
                    key={count}
                    onClick={() => setSlideCount(count)}
                    className={`px-4 py-2 rounded-lg border text-sm transition-colors ${
                      slideCount === count
                        ? "bg-brand text-white border-brand"
                        : "bg-surface border-surface-border text-text-secondary hover:border-brand/50"
                    }`}
                  >
                    {count}页
                  </button>
                ))}
              </div>
            </div>

            {/* 模板选择 */}
            <div className="mb-4">
              <label className="block text-sm text-text-secondary mb-2">模板风格</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Object.entries(TEMPLATE_STYLES).map(([key, template]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedTemplate(key)}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      selectedTemplate === key
                        ? "border-brand bg-brand/5"
                        : "border-surface-border hover:border-brand/50"
                    }`}
                  >
                    <div
                      className="w-full h-12 rounded mb-2"
                      style={{ backgroundColor: template.primaryColor }}
                    />
                    <p className="text-sm font-medium text-text-primary">{template.name}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-3">
              <button
                onClick={handleGenerate}
                disabled={isGenerating || !topic.trim()}
                className="flex-1 py-3 bg-brand text-white rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-brand/90 transition-colors"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <Presentation className="w-4 h-4" />
                    生成PPT大纲
                  </>
                )}
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-3 border border-surface-border text-text-secondary rounded-lg hover:border-brand/50 transition-colors"
              >
                <FileText className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 预览区域 */}
          {showPreview && generatedSlides && (
            <div className="bg-surface-card rounded-lg border border-surface-border p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-text-primary">预览</h3>
                <div className="flex gap-2">
                  <button
                    onClick={copyOutline}
                    className="px-3 py-2 border border-surface-border text-text-secondary rounded-lg text-sm flex items-center gap-2 hover:border-brand/50 transition-colors"
                  >
                    <Copy className="w-4 h-4" />
                    复制大纲
                  </button>
                  <button
                    onClick={exportToMarkdown}
                    className="px-3 py-2 bg-brand text-white rounded-lg text-sm flex items-center gap-2 hover:bg-brand/90"
                  >
                    <Download className="w-4 h-4" />
                    下载Markdown
                  </button>
                </div>
              </div>

              <div className="space-y-4 max-h-96 overflow-y-auto">
                {generatedSlides.map((slide, index) => (
                  <div
                    key={index}
                    className="p-4 bg-surface rounded-lg border border-surface-border"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium text-white"
                        style={{ backgroundColor: TEMPLATE_STYLES[selectedTemplate].primaryColor }}
                      >
                        {index + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-text-primary mb-1">{slide.title}</h4>
                        {slide.subtitle && (
                          <p className="text-sm text-text-secondary mb-2">{slide.subtitle}</p>
                        )}
                        {slide.content && slide.content.length > 0 && (
                          <ul className="text-sm text-text-secondary space-y-1">
                            {slide.content.map((item, i) => (
                              <li key={i} className="flex items-start gap-2">
                                <span style={{ color: TEMPLATE_STYLES[selectedTemplate].primaryColor }}>•</span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 历史记录 */}
          {ppts.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-text-secondary mb-4">
                历史记录 ({ppts.length})
              </h3>
              <div className="space-y-2">
                {ppts.map((ppt) => (
                  <div
                    key={ppt.id}
                    className="p-4 bg-surface-card rounded-lg border border-surface-border flex items-center justify-between hover:border-brand/50 transition-colors"
                  >
                    <div>
                      <p className="font-medium text-text-primary">{ppt.topic}</p>
                      <p className="text-xs text-text-tertiary mt-1">
                        {TEMPLATE_STYLES[ppt.template]?.name || ppt.template} · {ppt.slide_count}页 ·{" "}
                        {new Date(ppt.created_at).toLocaleString()}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDelete(ppt.id)}
                      className="p-2 text-text-tertiary hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
