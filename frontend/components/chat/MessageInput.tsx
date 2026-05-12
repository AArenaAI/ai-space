"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Brain, ChevronDown, Square, Search, Columns2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatModel } from "@/hooks/useChat";

// DeepSeek 模型的思考档位（兼容旧值）
const DEEPSEEK_EFFORTS = ["high", "max"] as const;
// GPT 模型的思考档位
const GPT_EFFORTS = ["light", "standard", "extended", "heavy"] as const;

export type ReasoningEffort = "light" | "standard" | "extended" | "heavy" | "high" | "max";

export interface ReasoningConfig {
  enabled: boolean;
  effort: ReasoningEffort;
}

interface MessageInputProps {
  onSend: (content: string, reasoning: ReasoningConfig, search: boolean) => void;
  onStop: () => void;
  isLoading: boolean;
  compareMode: boolean;
  onToggleCompare: () => void;
  currentModel?: ChatModel;
}

export default function MessageInput({ onSend, onStop, isLoading, compareMode, onToggleCompare, currentModel }: MessageInputProps) {
  const [content, setContent] = useState("");
  const [reasoning, setReasoning] = useState<ReasoningConfig>(() => {
    // 从 localStorage 读取用户上次保存的深度思考配置
    if (typeof window !== "undefined") {
      const savedEnabled = localStorage.getItem("reasoning-enabled");
      const savedEffort = localStorage.getItem("reasoning-effort");
      return {
        enabled: savedEnabled === "true",
        effort: (savedEffort as ReasoningEffort) || "standard",
      };
    }
    return { enabled: false, effort: "standard" };
  });
  const [searchEnabled, setSearchEnabled] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("search-enabled") === "true";
    }
    return false;
  });
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevModelRef = useRef<ChatModel | undefined>(currentModel);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 当打开下拉菜单时，确保当前 effort 对当前模型有效
  useEffect(() => {
    if (!dropdownOpen) return;
    if (!currentModel) return;
    const isDeepSeek = currentModel.provider === "DeepSeek";
    const validEfforts = isDeepSeek ? DEEPSEEK_EFFORTS : GPT_EFFORTS;
    if (!(validEfforts as readonly string[]).includes(reasoning.effort)) {
      const defaultEffort: ReasoningEffort = isDeepSeek ? "high" : "standard";
      setReasoning((prev) => ({ ...prev, effort: defaultEffort }));
      localStorage.setItem("reasoning-effort", defaultEffort);
    }
  }, [dropdownOpen, currentModel]);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [content]);

  // 点击外部关闭下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!content.trim() || isLoading) return;
    onSend(content.trim(), reasoning, searchEnabled);
    setContent("");
    setDropdownOpen(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 如果正在使用输入法组合（IME composition），不处理快捷键
    // macOS Chrome 在 IME 回车确认时 e.key 仍为 "Enter"，必须检测 isComposing
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleStop = (e: React.MouseEvent) => {
    e.preventDefault();
    onStop();
  };

  const toggleReasoning = () => {
    setReasoning((prev) => {
      const next = { ...prev, enabled: !prev.enabled };
      localStorage.setItem("reasoning-enabled", String(next.enabled));
      return next;
    });
  };

  const toggleSearch = () => {
    setSearchEnabled((prev) => {
      const next = !prev;
      localStorage.setItem("search-enabled", String(next));
      return next;
    });
  };

  const setEffort = (effort: ReasoningEffort) => {
    setReasoning({ enabled: true, effort });
    localStorage.setItem("reasoning-effort", effort);
    setDropdownOpen(false);
  };

  const hasContent = content.trim().length > 0;

  // 切换模型时自动重置思考档位到当前模型有效值
  useEffect(() => {
    if (!currentModel) return;
    if (prevModelRef.current === currentModel) return;
    const prevProvider = prevModelRef.current?.provider;
    const currProvider = currentModel.provider;
    prevModelRef.current = currentModel;
    if (prevProvider === currProvider) return; // 同厂商不重置

    // 从 DeepSeek 切到 GPT 等 -> 如果当前档位是 DeepSeek 专用值(high/max)，重置为 standard
    const isDeepSeek = currProvider === "DeepSeek";
    const isGPTLike = !isDeepSeek;
    if (isDeepSeek && (reasoning.effort === "light" || reasoning.effort === "extended" || reasoning.effort === "heavy")) {
      const newEffort: ReasoningEffort = "high";
      setReasoning((prev) => ({ ...prev, effort: newEffort }));
      localStorage.setItem("reasoning-effort", newEffort);
    } else if (isGPTLike && (reasoning.effort === "high" || reasoning.effort === "max")) {
      const newEffort: ReasoningEffort = "standard";
      setReasoning((prev) => ({ ...prev, effort: newEffort }));
      localStorage.setItem("reasoning-effort", newEffort);
    }
  }, [currentModel?.id]);

  const effortLabel = currentModel?.provider === "DeepSeek"
    ? (reasoning.effort === "max" ? "深度" : "")
    : (reasoning.effort === "standard" ? "" : reasoning.effort === "extended" ? "扩展" : reasoning.effort === "heavy" ? "重度" : "省流");

  const effortNames: Record<string, string> = {
    light: "省流",
    standard: "标准",
    extended: "扩展",
    heavy: "重度",
  };

  return (
    <div className="shrink-0 px-4 pb-6 pt-2">
      <form onSubmit={handleSubmit} className="max-w-[800px] mx-auto">
        <div
          className={cn(
            "relative flex flex-col rounded-2xl border transition-all duration-300",
            "bg-surface-card",
            compareMode
              ? "border-amber-500/30 focus-within:border-amber-500/60 focus-within:shadow-[0_0_0_1px_rgba(251,191,36,0.15),0_0_20px_rgba(251,191,36,0.08)]"
              : "border-surface-border focus-within:border-brand/50 focus-within:shadow-[0_0_0_1px_rgba(59,130,246,0.1)]"
          )}
        >
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="问点什么..."
            rows={1}
            className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] outline-none placeholder:text-text-tertiary min-h-[48px] max-h-[200px] leading-relaxed"
          />

          <div className="flex items-center justify-between px-3 pb-3">
            {/* 左侧：联网搜索 + 深度思考 */}
            <div className="flex items-center gap-2">
              {/* 联网搜索按钮 */}
              <button
                type="button"
                onClick={toggleSearch}
                className={cn(
                  "flex items-center gap-1.5 pl-3 pr-3 py-1.5 text-[13px] font-medium rounded-full border transition-all duration-200",
                  searchEnabled
                    ? "bg-blue-500/10 border-blue-500/40 text-blue-400"
                    : "bg-transparent border-surface-border text-text-tertiary hover:text-text-secondary hover:border-text-tertiary/50"
                )}
              >
                <Search className="w-3.5 h-3.5" />
                <span>联网搜索</span>
              </button>

              {/* 深度思考开关 + 下拉 */}
              <div className="relative flex items-center" ref={dropdownRef}>
                <div className={cn(
                  "flex items-center rounded-full border transition-all duration-200 overflow-hidden",
                  reasoning.enabled
                    ? "bg-purple-500/10 border-purple-500/40"
                    : "bg-transparent border-surface-border hover:border-text-tertiary/50"
                )}>
                  <button
                    type="button"
                    onClick={toggleReasoning}
                    className={cn(
                      "flex items-center gap-1.5 pl-3 pr-2 py-1.5 text-[13px] font-medium transition-all duration-200",
                      reasoning.enabled
                        ? "text-purple-400"
                        : "text-text-tertiary hover:text-text-secondary"
                    )}
                  >
                    <Brain className="w-3.5 h-3.5" />
                    <span>深度思考</span>
                    {reasoning.enabled && (
                      <span className="text-[11px] opacity-70 ml-0.5">· {effortLabel}</span>
                    )}
                  </button>
                  <div className={cn(
                    "w-px h-4 transition-colors duration-200",
                    reasoning.enabled ? "bg-purple-500/30" : "bg-surface-border"
                  )} />
                  <button
                    type="button"
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    className={cn(
                      "flex items-center justify-center px-2 py-1.5 text-[13px] transition-all duration-200",
                      reasoning.enabled
                        ? "text-purple-400"
                        : "text-text-tertiary hover:text-text-secondary"
                    )}
                  >
                    <ChevronDown
                      className={cn(
                        "w-3 h-3 transition-transform duration-200",
                        dropdownOpen && "rotate-180"
                      )}
                    />
                  </button>
                </div>

                {/* 下拉浮层 */}
                {dropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setDropdownOpen(false)}
                    />
                    <div className="absolute bottom-full left-0 mb-2 w-32 rounded-xl border border-surface-border bg-surface-elevated shadow-xl z-50 py-1 animate-fade-in">
                      {currentModel?.provider === "DeepSeek" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setEffort("high")}
                            className={cn(
                              "flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors",
                              reasoning.effort === "high"
                                ? "text-purple-400 bg-purple-500/10"
                                : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                            )}
                          >
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                reasoning.effort === "high" ? "bg-purple-400" : "bg-text-tertiary/30"
                              )}
                            />
                            标准
                          </button>
                          <button
                            type="button"
                            onClick={() => setEffort("max")}
                            className={cn(
                              "flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors",
                              reasoning.effort === "max"
                                ? "text-purple-400 bg-purple-500/10"
                                : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                            )}
                          >
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                reasoning.effort === "max" ? "bg-purple-400" : "bg-text-tertiary/30"
                              )}
                            />
                            深度
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setEffort("light")}
                            className={cn(
                              "flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors",
                              reasoning.effort === "light"
                                ? "text-purple-400 bg-purple-500/10"
                                : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                            )}
                          >
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                reasoning.effort === "light" ? "bg-purple-400" : "bg-text-tertiary/30"
                              )}
                            />
                            {effortNames.light}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEffort("standard")}
                            className={cn(
                              "flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors",
                              reasoning.effort === "standard"
                                ? "text-purple-400 bg-purple-500/10"
                                : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                            )}
                          >
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                reasoning.effort === "standard" ? "bg-purple-400" : "bg-text-tertiary/30"
                              )}
                            />
                            {effortNames.standard}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEffort("extended")}
                            className={cn(
                              "flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors",
                              reasoning.effort === "extended"
                                ? "text-purple-400 bg-purple-500/10"
                                : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                            )}
                          >
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                reasoning.effort === "extended" ? "bg-purple-400" : "bg-text-tertiary/30"
                              )}
                            />
                            {effortNames.extended}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEffort("heavy")}
                            className={cn(
                              "flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors",
                              reasoning.effort === "heavy"
                                ? "text-purple-400 bg-purple-500/10"
                                : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                            )}
                          >
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                reasoning.effort === "heavy" ? "bg-purple-400" : "bg-text-tertiary/30"
                              )}
                            />
                            {effortNames.heavy}
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* 对比模式开关 */}
              <button
                type="button"
                onClick={onToggleCompare}
                className={cn(
                  "flex items-center gap-1.5 pl-3 pr-3 py-1.5 text-[13px] font-medium rounded-full border transition-all duration-200",
                  compareMode
                    ? "bg-amber-500/10 border-amber-500/40 text-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.15)]"
                    : "bg-transparent border-surface-border text-text-tertiary hover:text-text-secondary hover:border-text-tertiary/50"
                )}
              >
                <Columns2 className="w-3.5 h-3.5" />
                <span>对比</span>
              </button>
            </div>

            {/* 发送/停止按钮 */}
            {isLoading ? (
              <button
                type="button"
                onClick={handleStop}
                className="flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200 bg-red-500 text-white hover:bg-red-600"
                title="停止生成"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!hasContent}
                className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200",
                  hasContent
                    ? "bg-brand text-white hover:bg-brand-hover"
                    : "bg-surface-elevated text-text-tertiary cursor-not-allowed"
                )}
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* 底部提示 */}
        <p className={cn("text-center text-[11px] mt-2 transition-all duration-300", compareMode ? "text-amber-500/50" : "text-text-tertiary/60")}>
          AI 可能会出现错误，请勿分享敏感信息
        </p>
      </form>
    </div>
  );
}
