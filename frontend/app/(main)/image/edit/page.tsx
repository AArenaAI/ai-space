"use client";

import { useState, useRef, useEffect } from "react";
import { Upload, Loader2, Sparkles, Eraser, Download, RotateCcw, ImagePlus, ArrowRight, Wand2, ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import BeforeAfterSlider from "@/components/ui/BeforeAfterSlider";

const API_BASE_URL = "";

/* 示例：展示原图 vs 处理后效果 */
const EXAMPLES = {
  "remove-bg": [
    {
      before: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=600&h=400&fit=crop",
      after: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=600&h=400&fit=crop&bg=fff",
      label: "人像",
    },
    {
      before: "https://images.unsplash.com/photo-1517849845537-4d257902454a?w=600&h=400&fit=crop",
      after: "https://images.unsplash.com/photo-1517849845537-4d257902454a?w=600&h=400&fit=crop&bg=fff",
      label: "宠物",
    },
    {
      before: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&h=400&fit=crop",
      after: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&h=400&fit=crop&bg=fff",
      label: "商品",
    },
    {
      before: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&h=400&fit=crop",
      after: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&h=400&fit=crop&bg=fff",
      label: "证件照",
    },
  ],
  "replace-bg": [
    {
      before: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&h=400&fit=crop",
      after: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600&h=400&fit=crop",
      label: "海滩",
    },
    {
      before: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&h=400&fit=crop",
      after: "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=600&h=400&fit=crop",
      label: "山脉",
    },
    {
      before: "https://images.unsplash.com/photo-1509631179647-0177331693ae?w=600&h=400&fit=crop",
      after: "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=600&h=400&fit=crop",
      label: "城市",
    },
    {
      before: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&h=400&fit=crop",
      after: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=600&h=400&fit=crop",
      label: "自然",
    },
  ],
};

export default function ImageEditPage() {
  const [editMode, setEditMode] = useState<"remove-bg" | "replace-bg">("remove-bg");
  const [sourceUrl, setSourceUrl] = useState("");
  const [replacePrompt, setReplacePrompt] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    if (mode === "replace-bg") setEditMode("replace-bg");
    else setEditMode("remove-bg");
  }, []);

  const switchMode = (mode: "remove-bg" | "replace-bg") => {
    setEditMode(mode);
    setResult(null);
    setSourceUrl("");
    setReplacePrompt("");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("mode", mode);
      window.history.replaceState({}, "", url.toString());
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }
    try {
      const reader = new FileReader();
      reader.onload = () => {
        setSourceUrl(reader.result as string);
        setResult(null);
        toast.success("图片已选择");
      };
      reader.onerror = () => toast.error("读取图片失败");
      reader.readAsDataURL(file);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "读取图片失败");
    }
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    handleFileSelect({ target: { files: dt.files } } as any);
  };

  const handleEdit = async () => {
    if (!sourceUrl) {
      toast.error("请先上传或选择图片");
      return;
    }
    if (editMode === "replace-bg" && !replacePrompt.trim()) {
      toast.error("请描述新背景");
      return;
    }
    setIsEditing(true);
    setResult(null);
    const token = localStorage.getItem("token");
    try {
      // 先上传 base64 图片到文件服务器，拿到 public_id
      const base64Resp = await fetch(sourceUrl);
      const imageBlob = await base64Resp.blob();
      const formData = new FormData();
      formData.append("file", imageBlob, "edit-image.png");

      const uploadResp = await fetch(`${API_BASE_URL}/api/files/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!uploadResp.ok) {
        const uploadErr = await uploadResp.json().catch(() => ({}));
        throw new Error(uploadErr.error || "上传图片失败");
      }
      const uploadData = await uploadResp.json();

      // 用 public_id 提交编辑
      const body: Record<string, any> = {
        image_url: uploadData.public_id,
        edit_mode: editMode,
      };
      if (editMode === "replace-bg") body.prompt = replacePrompt.trim();

      const res = await fetch(`${API_BASE_URL}/api/images/edit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "编辑失败");
      }
      const data = await res.json();
      setResult(data.image_url);
      toast.success(editMode === "remove-bg" ? "背景已移除" : "背景已替换");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "编辑失败");
    } finally {
      setIsEditing(false);
    }
  };

  const handleDownload = async () => {
    if (!result) return;
    try {
      const response = await fetch(result);
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `aispace-edit-${Date.now()}.png`;
      link.click();
      toast.success("下载已开始");
    } catch {
      toast.error("下载失败");
    }
  };

  const handleReset = () => {
    setSourceUrl("");
    setReplacePrompt("");
    setResult(null);
  };

  const useExample = (before: string) => {
    setSourceUrl(before);
    setResult(null);
    toast.success("已选择示例图片");
  };

  const examples = EXAMPLES[editMode];

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "#f5f5f5" }}>
      {/* 顶部模式切换 & 标题 */}
      <header className="shrink-0 h-auto flex flex-col items-center justify-center py-4 border-b gap-1" style={{ borderColor: "#eaeaea", backgroundColor: "#f5f5f7" }}>
        {/* 标题 + 副标题 */}
        <div className="text-center mb-1">
          <h1 className="text-xl font-bold" style={{ color: "#333" }}>
            {editMode === "remove-bg" ? "AI Background Removal" : "AI Background Replacement"}
          </h1>
          <p className="text-xs mt-1" style={{ color: "#999" }}>
            {editMode === "remove-bg"
              ? "Remove image backgrounds instantly with AI"
              : "Replace image backgrounds with AI-generated scenes"}
          </p>
        </div>
        <div className="flex items-center rounded-full p-1" style={{ backgroundColor: "rgba(0,0,0,0.04)" }}>
          <button
            onClick={() => switchMode("remove-bg")}
            className={cn(
              "flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium transition-all duration-200",
              editMode === "remove-bg"
                ? "text-white shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            )}
            style={editMode === "remove-bg" ? { backgroundColor: "#c8b6ff" } : {}}
          >
            <Eraser className="w-4 h-4" />
            移除背景
          </button>
          <button
            onClick={() => switchMode("replace-bg")}
            className={cn(
              "flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium transition-all duration-200",
              editMode === "replace-bg"
                ? "text-white shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            )}
            style={editMode === "replace-bg" ? { backgroundColor: "#c8b6ff" } : {}}
          >
            <Sparkles className="w-4 h-4" />
            替换背景
          </button>
        </div>
      </header>

      {/* 主工作区 */}
      <div className="flex-1 overflow-auto p-8 md:p-10" style={{ backgroundColor: "#f5f5f7" }}>
        <div className="max-w-6xl mx-auto space-y-10">
          {!result ? (
            <div className="space-y-10">
              {/* 中央大画布上传区 */}
              {!sourceUrl ? (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "relative flex flex-col items-center justify-center transition-all duration-300 cursor-pointer mx-auto",
                    dragOver && "scale-[1.02]"
                  )}
                  style={{
                    width: "clamp(520px, 82vw, 1100px)",
                    minHeight: "620px",
                    maxHeight: "700px",
                    borderRadius: "20px",
                    border: "1px solid #f0f0f0",
                    backgroundColor: "#ffffff",
                    boxShadow: "0 10px 40px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.02)",
                  }}
                >
                  {/* 多层毛玻璃上传图标 */}
                  <div
                    className="flex items-center justify-center mb-6"
                    style={{
                      width: "128px",
                      height: "128px",
                      borderRadius: "32px",
                      background: "linear-gradient(135deg, rgba(200,182,255,0.30) 0%, rgba(200,182,255,0.06) 100%)",
                      backdropFilter: "blur(12px)",
                      WebkitBackdropFilter: "blur(12px)",
                      border: "1px solid rgba(200,182,255,0.18)",
                      boxShadow: "0 8px 32px rgba(200,182,255,0.12)",
                    }}
                  >
                    <Upload className="w-12 h-12" style={{ color: "#c8b6ff" }} />
                  </div>

                  {/* 主文字 */}
                  <p className="text-xl font-semibold mb-3" style={{ color: "#333" }}>
                    {editMode === "remove-bg" ? "点击或拖动图片至此处" : "点击或拖动图片至此处"}
                  </p>

                  {/* 辅助文字 */}
                  <p className="text-sm" style={{ color: "#aaa" }}>
                    支持 PNG、JPG、WebP 格式，单张不超过 20MB
                  </p>

                  {/* Try sample 按钮 */}
                  <div className="flex items-center gap-3 mt-8">
                    <span className="text-xs" style={{ color: "#ccc" }}>或者</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        useExample(examples[0].before);
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all duration-200 hover:-translate-y-0.5"
                      style={{
                        backgroundColor: "rgba(200,182,255,0.08)",
                        color: "#c8b6ff",
                        border: "1px solid rgba(200,182,255,0.15)",
                      }}
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      试用示例图片
                    </button>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                </div>
              ) : (
                <div className="space-y-5">
                  {/* 已选图片预览 */}
                  <div
                    className="rounded-2xl overflow-hidden bg-white"
                    style={{
                      boxShadow: "0 10px 30px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.02)",
                    }}
                  >
                    <img src={sourceUrl} alt="源图" className="w-full max-h-[400px] object-contain" style={{ backgroundColor: "#fafafa" }} />
                  </div>

                  {/* 替换背景 prompt */}
                  {editMode === "replace-bg" && (
                    <div
                      className="rounded-xl p-4 bg-white"
                      style={{
                        border: "1px solid #eaeaea",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                      }}
                    >
                      <label className="block text-xs font-medium mb-2" style={{ color: "#888" }}>
                        描述新背景
                      </label>
                      <textarea
                        value={replacePrompt}
                        onChange={(e) => setReplacePrompt(e.target.value)}
                        placeholder="例如：一个阳光明媚的海滩，有棕榈树和蓝天"
                        disabled={isEditing}
                        className="w-full h-20 p-3 rounded-lg resize-none focus:outline-none text-sm leading-relaxed"
                        style={{
                          backgroundColor: "#f8f8f8",
                          border: "1px solid #eaeaea",
                          color: "#444",
                        }}
                      />
                    </div>
                  )}

                  {/* 确认按钮 */}
                  <div className="flex justify-center">
                    <button
                      onClick={handleEdit}
                      disabled={isEditing || (editMode === "replace-bg" && !replacePrompt.trim())}
                      className={cn(
                        "flex items-center justify-center gap-2 px-8 py-3 rounded-full text-sm font-semibold transition-all duration-200 shadow-sm",
                        isEditing || (editMode === "replace-bg" && !replacePrompt.trim())
                          ? "opacity-50 cursor-not-allowed"
                          : "hover:opacity-90 hover:shadow-md"
                      )}
                      style={{
                        backgroundColor: "#c8b6ff",
                        color: "#fff",
                        boxShadow: "0 2px 8px rgba(200,182,255,0.35)",
                      }}
                    >
                      {isEditing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          处理中...
                        </>
                      ) : editMode === "remove-bg" ? (
                        <>
                          <Eraser className="w-4 h-4" />
                          移除背景
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          替换背景
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* 底部示例区域 — 抬高视觉层级 */}
              <div className="pt-6">
                <div className="text-center mb-6">
                  <h3 className="text-sm font-semibold" style={{ color: "#555" }}>
                    {editMode === "remove-bg" ? "效果预览" : "效果预览"}
                  </h3>
                  <p className="text-xs mt-1" style={{ color: "#bbb" }}>
                    {editMode === "remove-bg" ? "原图 → AI 移除背景" : "原图 → AI 替换背景"}
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-6">
                  {examples.map((ex) => (
                    <button
                      key={ex.label}
                      onClick={() => useExample(ex.before)}
                      className="group text-left overflow-hidden transition-all duration-200 hover:-translate-y-1"
                      style={{
                        width: "200px",
                        minHeight: "130px",
                        backgroundColor: "#fff",
                        border: "1px solid #eee",
                        borderRadius: "14px",
                        boxShadow: "0 6px 24px rgba(0,0,0,0.04), 0 1px 4px rgba(0,0,0,0.02)",
                      }}
                    >
                      {/* Before/After 双图对比 */}
                      <div className="relative flex items-center p-3" style={{ backgroundColor: "#fafafa", minHeight: "90px" }}>
                        {/* 原图 */}
                        <div className="flex-1">
                          <img
                            src={ex.before}
                            alt="原图"
                            className="w-full rounded-lg object-cover"
                            style={{ aspectRatio: "1/1", backgroundColor: "#eee", height: "72px" }}
                          />
                          <div className="text-[9px] mt-1 text-center" style={{ color: "#bbb" }}>原图</div>
                        </div>
                        {/* 紫色渐变箭头 + sparkle */}
                        <div
                          className="flex items-center justify-center"
                          style={{
                            width: "28px",
                            height: "28px",
                            borderRadius: "50%",
                            background: "linear-gradient(135deg, #c8b6ff 0%, #a78bfa 100%)",
                            margin: "0 4px",
                            flexShrink: 0,
                            position: "relative",
                          }}
                        >
                          <ArrowLeftRight className="w-3 h-3 text-white" />
                        </div>
                        {/* 处理后 */}
                        <div className="flex-1">
                          <img
                            src={ex.after}
                            alt="处理后"
                            className="w-full rounded-lg object-cover"
                            style={{
                              aspectRatio: "1/1",
                              height: "72px",
                              backgroundImage:
                                "linear-gradient(45deg, #e8e8e8 25%, transparent 25%), linear-gradient(-45deg, #e8e8e8 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e8e8e8 75%), linear-gradient(-45deg, transparent 75%, #e8e8e8 75%)",
                              backgroundSize: "8px 8px",
                              backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0px",
                            }}
                          />
                          <div className="text-[9px] mt-1 text-center font-medium" style={{ color: "#c8b6ff" }}>
                            {editMode === "remove-bg" ? "去背后" : "替换后"}
                          </div>
                        </div>
                      </div>
                      {/* 标签 */}
                      <div className="px-3 py-2 flex items-center justify-between">
                        <span className="text-xs font-medium" style={{ color: "#777" }}>{ex.label}</span>
                        <span className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1" style={{ color: "#c8b6ff" }}>
                          <Wand2 className="w-3 h-3" />
                          试用
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* 结果展示 */
            <div className="space-y-6">
              {/* Before/After 滑动对比 */}
              <div
                className="rounded-2xl overflow-hidden bg-white"
                style={{
                  boxShadow: "0 10px 30px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.02)",
                }}
              >
                <BeforeAfterSlider
                  beforeImage={sourceUrl}
                  afterImage={result}
                  beforeLabel="原始"
                  afterLabel={editMode === "remove-bg" ? "已移除" : "已替换"}
                />
              </div>

              {/* 操作按钮 */}
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-semibold text-white transition-all duration-200 hover:shadow-md"
                  style={{
                    backgroundColor: "#c8b6ff",
                    boxShadow: "0 2px 8px rgba(200,182,255,0.35)",
                  }}
                >
                  <Download className="w-4 h-4" />
                  下载图片
                </button>
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-medium transition-all duration-200"
                  style={{
                    backgroundColor: "#fff",
                    border: "1px solid #eaeaea",
                    color: "#777",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                  }}
                >
                  <RotateCcw className="w-4 h-4" />
                  重新上传
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
